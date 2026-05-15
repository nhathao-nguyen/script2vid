



import { GoogleGenAI } from '@google/genai';

const GEMINI_MODEL = 'gemini-3-flash-preview';

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stringifyError(error: unknown) {
  try {
    return JSON.stringify(error).toLowerCase();
  } catch {
    return String(error).toLowerCase();
  }
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 6): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorStr = stringifyError(error);
      const isRateLimit =
        errorStr.includes('429') ||
        errorStr.includes('rate_limit') ||
        errorStr.includes('resource_exhausted') ||
        errorStr.includes('quota') ||
        error?.status === 429 ||
        error?.code === 429;

      if (isRateLimit && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 5000 + Math.random() * 2000 + 5000;
        console.warn(`Gemini rate limit. Retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

async function generateGeminiText(prompt: string, responseMimeType?: string) {
  return callWithRetry(async () => {
    const request: any = {
      model: GEMINI_MODEL,
      contents: prompt,
    };

    if (responseMimeType) {
      request.config = { responseMimeType };
    }

    const response = await getGeminiClient().models.generateContent(request);
    return response.text || '';
  });
}

function tryFixJson(jsonStr: string): string {
  let fixed = jsonStr.trim();
  const stack: string[] = [];

  for (let i = 0; i < fixed.length; i++) {
    if (fixed[i] === '{') stack.push('}');
    else if (fixed[i] === '[') stack.push(']');
    else if ((fixed[i] === '}' || fixed[i] === ']') && stack.at(-1) === fixed[i]) stack.pop();
  }

  while (stack.length > 0) fixed += stack.pop();
  return fixed;
}

function parseGeminiJson<T>(text: string): T {
  let jsonString = text.trim();
  if (jsonString.startsWith('```json')) {
    jsonString = jsonString.slice(7);
  } else if (jsonString.startsWith('```')) {
    jsonString = jsonString.slice(3);
  }
  if (jsonString.endsWith('```')) {
    jsonString = jsonString.slice(0, -3);
  }
  jsonString = jsonString.trim();

  try {
    return JSON.parse(jsonString);
  } catch (error) {
    try {
      return JSON.parse(tryFixJson(jsonString));
    } catch (fallbackError) {
      console.error('Failed to parse JSON:', jsonString.substring(0, 200) + '...');
      throw error;
    }
  }
}

function normalizeForCoverage(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitByWordLength(unit: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const word of unit.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitLongUnit(unit: string, maxLength = 320): string[] {
  if (unit.length <= maxLength) return [unit];

  const parts = unit
    .split(/(?<=[,;:])\s+|\s+-\s+/)
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return splitByWordLength(unit, maxLength);
  }

  const chunks: string[] = [];
  let current = '';

  for (const part of parts) {
    const next = current ? `${current} ${part}` : part;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = part;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(...(current.length > maxLength ? splitByWordLength(current, maxLength) : [current]));
  }

  return chunks;
}

function splitScriptLocally(script: string): string[] {
  return script
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?\u2026])\s+|\n+/)
    .map(unit => unit.trim())
    .filter(unit => unit.length > 2)
    .flatMap(unit => splitLongUnit(unit));
}

function hasScriptCoverage(script: string, segments: string[]): boolean {
  const normalizedScript = normalizeForCoverage(script);
  const normalizedSegments = normalizeForCoverage(segments.join(' '));
  const words = normalizedScript.split(' ').filter(Boolean);

  if (words.length === 0 || normalizedSegments.length === 0) return false;

  const probeSize = Math.min(8, words.length);
  const firstProbe = words.slice(0, probeSize).join(' ');
  const lastProbe = words.slice(-probeSize).join(' ');
  const lengthCoverage = normalizedSegments.length >= normalizedScript.length * 0.75;

  return normalizedSegments.includes(firstProbe) &&
    normalizedSegments.includes(lastProbe) &&
    lengthCoverage;
}

export async function getGlobalContext(script: string, targetRegion?: string): Promise<string> {
  const prompt = `
Task: Analyze script for "Cinematic North Star".
Output: mood, theme, style, environment (<100 words).

### TARGET REGION PRIORITY RULE ###
${targetRegion ? `
- TARGET REGION = ${targetRegion}
- This is the PRIMARY visual anchor. All ethnicity, architecture, and cultural context MUST align with this.
` : '- No explicit target region. Infer from script context and named entities.'}

STRICT VISUAL GROUNDING RULES:
1. NO HARDCODING: Do not assume any default country.
2. CONSISTENCY: Every scene must follow the same geographic logic.
3. VISUAL GEO-ALIGNMENT: All environment and character descriptions must reflect the target region.

Script: ${script}
`;

  try {
    const text = await generateGeminiText(prompt);
    return text || 'Cinematic storytelling.';
  } catch (error) {
    console.error('Gemini Context Error:', error);
    throw error;
  }
}

export async function splitScriptIntoSentences(script: string, context: string): Promise<string[]> {
  const prompt = `
Task: Split the following script into individual sentences or semantic units for visual processing.
STRICT RULES:
1. DO NOT summarize, paraphrase, or omit ANY part of the original script.
2. Capture EVERY single word from the beginning to the end.
3. Every element in the array must be a coherent segment that can be visualized as a scene.
4. If a sentence is very long, split it at natural pauses (commas, conjunctions).
5. Output MUST be a pure JSON array of strings.

Context: ${context}
Script to split:
${script}
`;

  try {
    const text = await generateGeminiText(prompt, 'application/json');
    const result = parseGeminiJson<unknown>(text);
    if (!Array.isArray(result)) throw new Error('Gemini split result is not an array');
    const geminiSentences = result.map(String).map(s => s.trim()).filter(Boolean);
    if (hasScriptCoverage(script, geminiSentences)) {
      return geminiSentences;
    }

    const localSentences = splitScriptLocally(script);
    console.warn('Gemini split did not cover the full script. Falling back to local split.', {
      geminiCount: geminiSentences.length,
      localCount: localSentences.length,
    });
    return localSentences.length > 0 ? localSentences : geminiSentences;
  } catch (error) {
    console.error('Splitting Error:', error);
    return splitScriptLocally(script);
  }
}

export async function analyzeSentence(
  sentence: string,
  sentenceId: number,
  context: string,
  languageMode: string,
  targetRegion?: string
): Promise<any> {
  const searchLanguageRule = languageMode === 'original'
    ? '- MEDIA QUERIES: Prefer the original script language when it improves search relevance; keep named places and cultural terms intact.'
    : '- MEDIA QUERIES: Write all media_queries in clear English for broad stock-media search coverage.';

  const prompt = `
Task: Analyze the following sentence and break it into one or more visual scenes.
Sentence #${sentenceId}: "${sentence}"

GLOBAL CONTEXT: ${context}

### TARGET REGION PRIORITY RULE ###
${targetRegion ? `
- TARGET REGION = ${targetRegion}
- This is the PRIMARY visual anchor. All ethnicity, architecture, and cultural context MUST align with this.
- characters -> must match local population of ${targetRegion}.
- architecture/streets -> must match ${targetRegion} local style.
- signage/text in visuals -> use ${targetRegion} local language.
` : '- No explicit target region. Infer from script context and named entities.'}

### MEDIA RETRIEVAL ARCHITECTURE: SEMANTIC INTENT ###
Your responsibility is strictly:
1. SEMANTIC ANALYSIS: Understand the core meaning, emotion, and narrative of the scene.
2. CINEMATIC REASONING: Decide the camera work, lighting, and composition.
3. KEYWORD GENERATION (SEARCH INTENT):
   - Provide "media_queries" as a list of 3-5 high-quality, SEMANTIC-RICH keywords.
   - Keywords MUST be context-aware, geo-aware (using the Target Region), and cinematic-aware.
   - AVOID generic terms. Use descriptive cinematic language (e.g., "cinematic wide shot of Hanoi old quarter at sunset" instead of "Vietnam street").
   - NO HALLUCINATION: Do not assume media exists or provide fake URLs.
${searchLanguageRule}
   - For real people, politicians, celebrities, organizations, real events, maps, or historical references, queries MUST include the exact entity name.
   - For any named public figure, use real-person/documentary queries such as "[exact name] portrait", "[exact name] speech", "[exact name] official photo", not generic nature or symbolic footage.
   - Do not replace named entities with metaphors, landscapes, moods, or generic stock footage.

RULES:
- If the sentence describes multiple distinct visual actions or changes, create multiple scenes.
- You MUST create AT LEAST ONE scene for the sentence, even if it is short or abstract. The "scenes" array MUST NOT be empty.
- Decide if VIDEO (motion) or IMAGE (static) is better based on the action described.
- If the scene depends on a real person, exact event, document, map, or factual archive, prefer IMAGE unless the sentence explicitly needs motion.
- STICK TO THE ORIGINAL TEXT. DO NOT SUMMARIZE.

Output Format (STRICT JSON):
{
  "sentence_id": ${sentenceId},
  "sentence_text": "${sentence.replace(/"/g, '\\"')}",
  "vietnamese_translation": "Dịch toàn bộ câu sang tiếng Việt (mượt mà, tự nhiên)",
  "scenes": [{
    "scene_id": number,
    "visual_target": "vs_${sentenceId}_sceneindex",
    "scene_summary": "English summary for LLM context",
    "visual_meaning": "The core visual focus of this scene",
    "emotion": "Mood (e.g., Hopeful, Tense, Peaceful)",
    "style": "Cinematic/Natural/Abstract/Documentary",
    "media_type": "video" | "image",
    "search_intent": "stock" | "real_person" | "real_event" | "place" | "documentary" | "abstract",
    "entity_names": ["exact named person/place/org/event if present"],
    "keywords": ["semantic keyword 1", "semantic keyword 2"],
    "media_queries": ["contextual search query with regional grounding", "cinematic search query 2"],
    "camera_style": "Shot type (e.g., High Angle, Extreme Close Up)",
    "visual_description": "Detailed visual intention including ethnicity, environment, and focal point"
  }],
  "export_file": "${sentenceId}.txt"
}
`;

  try {
    const text = await generateGeminiText(prompt, 'application/json');
    return parseGeminiJson<unknown>(text);
  } catch (error) {
    console.error('Gemini Analyze Error:', error);
    throw error;
  }
}
