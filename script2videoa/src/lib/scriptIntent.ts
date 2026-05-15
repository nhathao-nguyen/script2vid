import { MediaProvider, MediaType, ScriptSegment } from '../types';

const REAL_WORLD_TERMS = [
  'president',
  'prime minister',
  'politician',
  'election',
  'white house',
  'congress',
  'court',
  'war',
  'protest',
  'speech',
  'interview',
  'news',
  'map',
  'document',
  'archive',
  'historical',
];

export type SearchIntent = ScriptSegment['search_intent'];

function stripTrailingContext(value: string) {
  return value
    .replace(/\s+(announced|said|says|speaks|spoke|speaking|walks|walked|meets|met|visits|visited|during|at|in|on|with|and|about|from|to)\b.*$/i, '')
    .trim();
}

export function extractEntityNames(text: string): string[] {
  const found = new Set<string>();

  const quotedEntityPattern = /["“”']([A-Z][A-Za-zÀ-ỹ'.-]+(?:\s+[A-Z][A-Za-zÀ-ỹ'.-]+){0,4})["“”']/g;
  for (const match of text.matchAll(quotedEntityPattern)) {
    found.add(stripTrailingContext(match[1]));
  }

  const titleNamePattern = /\b(?:President|Former President|Prime Minister|Senator|Governor|Mayor|Minister|Secretary|General|Mr\.|Ms\.|Mrs\.|Dr\.)\s+([A-Z][A-Za-zÀ-ỹ'.-]+(?:\s+[A-Z][A-Za-zÀ-ỹ'.-]+){0,4})\b/g;
  for (const match of text.matchAll(titleNamePattern)) {
    found.add(stripTrailingContext(match[1]));
  }

  const capitalizedPhrasePattern = /\b([A-Z][A-Za-zÀ-ỹ'.-]+(?:\s+[A-Z][A-Za-zÀ-ỹ'.-]+){1,4})\b/g;
  for (const match of text.matchAll(capitalizedPhrasePattern)) {
    const candidate = stripTrailingContext(match[1]);
    const words = candidate.split(/\s+/);
    if (words.length >= 2 && words.every(word => word.length > 1)) {
      found.add(candidate);
    }
  }

  return [...found]
    .map(entity => entity.replace(/[.,;:!?]+$/g, '').trim())
    .filter(Boolean);
}

export function inferSearchIntent(text: string, entityNames: string[] = []): SearchIntent {
  const normalized = text.toLowerCase();

  if (entityNames.length > 0) return 'real_person';
  if (REAL_WORLD_TERMS.some(term => normalized.includes(term))) {
    if (normalized.includes('map')) return 'place';
    if (normalized.includes('document') || normalized.includes('archive') || normalized.includes('historical')) return 'documentary';
    return 'real_event';
  }
  if (normalized.includes('abstract') || normalized.includes('symbolic') || normalized.includes('metaphor')) return 'abstract';
  return 'stock';
}

export function providerPriorityForIntent(intent: SearchIntent, mediaType: MediaType): MediaProvider[] {
  if (intent === 'real_person' || intent === 'real_event' || intent === 'documentary') {
    return mediaType === 'video'
      ? ['government', 'wikimedia', 'pexels', 'pixabay']
      : ['wikimedia', 'government', 'openverse', 'pexels', 'pixabay'];
  }

  if (intent === 'place') {
    return ['wikimedia', 'government', 'openverse', 'pexels', 'pixabay'];
  }

  return mediaType === 'video'
    ? ['pexels', 'pixabay', 'government']
    : ['pexels', 'pixabay', 'wikimedia', 'openverse', 'government'];
}

export function normalizeMediaTypeForIntent(mediaType: MediaType, intent: SearchIntent, text: string): MediaType {
  const lower = text.toLowerCase();
  const explicitMotion = /\b(video|footage|clip|walking|running|drone|moving|speech|speaking|interview|crowd|protest)\b/.test(lower);

  if ((intent === 'real_person' || intent === 'real_event' || intent === 'documentary') && !explicitMotion) {
    return 'image';
  }

  return mediaType;
}

export function buildIntentQueries(baseQueries: string[], summary: string, entityNames: string[], intent: SearchIntent) {
  const queries = baseQueries.length > 0 ? [...baseQueries] : [summary];

  if (entityNames.length === 0) return queries;

  const entityQueries = entityNames.flatMap(entity => {
    if (intent === 'real_person') {
      return [
        `${entity} portrait`,
        `${entity} speech`,
        `${entity} official photo`,
        `${entity} Wikimedia Commons`,
      ];
    }
    return [`${entity} ${summary}`, `${entity} documentary`, `${entity} archive photo`];
  });

  return [...entityQueries, ...queries.filter(query => entityNames.some(entity => query.toLowerCase().includes(entity.toLowerCase()))), ...queries]
    .filter((query, index, arr) => query && arr.findIndex(other => other.toLowerCase() === query.toLowerCase()) === index);
}
