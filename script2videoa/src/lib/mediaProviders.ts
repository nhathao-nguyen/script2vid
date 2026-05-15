import { AspectRatio, MediaAsset, MediaProvider, MediaSearchRequest, MediaType, RiskFlag } from '../types';
import { buildAttributionText, classifyLicense, stripHtml } from './licenseGate';

const PEXELS_PHOTO_URL = 'https://api.pexels.com/v1/search';
const PEXELS_VIDEO_URL = 'https://api.pexels.com/videos/search';
const PIXABAY_IMAGE_URL = 'https://pixabay.com/api/';
const PIXABAY_VIDEO_URL = 'https://pixabay.com/api/videos/';
const WIKIMEDIA_API_URL = 'https://commons.wikimedia.org/w/api.php';
const OPENVERSE_IMAGE_URL = 'https://api.openverse.engineering/v1/images/';
const NASA_SEARCH_URL = 'https://images-api.nasa.gov/search';

function stableId(parts: Array<string | number | undefined>) {
  return parts.filter(part => part !== undefined && part !== '').join(':').replace(/\s+/g, '_');
}

function inferRiskFlags(text: string): RiskFlag[] {
  const lower = text.toLowerCase();
  const flags: RiskFlag[] = [];

  if (/\b(person|people|portrait|face|man|woman|child|president|minister|official)\b/.test(lower)) flags.push('person');
  if (/\b(logo|seal|insignia|emblem)\b/.test(lower)) flags.push('logo');
  if (/\b(trademark|brand|branded)\b/.test(lower)) flags.push('trademark');
  if (/\b(map|cartography|boundary|borders)\b/.test(lower)) flags.push('map');
  if (/\b(news|event|war|conflict|protest|disaster|election)\b/.test(lower)) flags.push('news_event');
  if (/\b(government|federal|agency|nasa|white house|department)\b/.test(lower)) flags.push('government');
  if (/\b(united nations|un |who|world bank|unesco|unicef)\b/.test(lower)) flags.push('international_org');

  return [...new Set(flags)];
}

function makeAsset(input: Omit<MediaAsset, 'license' | 'licenseStatus' | 'riskFlags' | 'attributionText' | 'blockedReasons'> & {
  licenseName: string;
  licenseUrl: string;
  riskText?: string;
  riskFlags?: RiskFlag[];
}): MediaAsset {
  const attributionText = buildAttributionText({
    title: input.title,
    creator: input.creator,
    sourceUrl: input.sourceUrl,
    licenseName: input.licenseName,
    licenseUrl: input.licenseUrl,
  });
  const decision = classifyLicense({
    provider: input.provider,
    licenseName: input.licenseName,
    licenseUrl: input.licenseUrl,
    sourceUrl: input.sourceUrl,
    creator: input.creator,
    title: input.title,
    attributionText,
    riskFlags: [...new Set([...(input.riskFlags || []), ...inferRiskFlags(input.riskText || `${input.title} ${input.creator}`)])],
  });

  return {
    ...input,
    license: decision.license,
    licenseStatus: decision.licenseStatus,
    riskFlags: decision.riskFlags,
    attributionText: decision.attributionText,
    blockedReasons: decision.blockedReasons,
  };
}

function pexelsOrientation(aspectRatio: AspectRatio) {
  return aspectRatio === 'square' ? 'square' : aspectRatio;
}

function pixabayOrientation(aspectRatio: AspectRatio) {
  return aspectRatio === 'portrait' ? 'vertical' : aspectRatio === 'landscape' ? 'horizontal' : 'all';
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Provider request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export function mapPexelsPhoto(raw: any): MediaAsset {
  return makeAsset({
    id: stableId(['pexels', 'image', raw.id]),
    provider: 'pexels',
    mediaType: 'image',
    width: raw.width,
    height: raw.height,
    sourceUrl: raw.url,
    downloadUrl: raw.src?.original || raw.src?.large2x || raw.src?.large || raw.url,
    previewUrl: raw.src?.large || raw.src?.medium || raw.src?.original || raw.url,
    creator: raw.photographer || 'Pexels contributor',
    title: raw.alt || `Pexels photo ${raw.id}`,
    licenseName: 'Pexels License',
    licenseUrl: 'https://www.pexels.com/license/',
    riskText: `${raw.alt || ''} ${raw.photographer || ''}`,
  });
}

export function mapPexelsVideo(raw: any): MediaAsset {
  const videoFiles = Array.isArray(raw.video_files) ? raw.video_files : [];
  const preferred = videoFiles.find((file: any) => file.quality === 'sd') || videoFiles[0];
  return makeAsset({
    id: stableId(['pexels', 'video', raw.id]),
    provider: 'pexels',
    mediaType: 'video',
    width: raw.width,
    height: raw.height,
    duration: raw.duration,
    sourceUrl: raw.url,
    downloadUrl: preferred?.link || raw.image || raw.url,
    previewUrl: raw.image || preferred?.link || raw.url,
    creator: raw.user?.name || 'Pexels contributor',
    title: `Pexels video ${raw.id}`,
    licenseName: 'Pexels License',
    licenseUrl: 'https://www.pexels.com/license/',
    videoFiles: videoFiles.map((file: any) => ({
      link: file.link,
      width: file.width,
      height: file.height,
      quality: file.quality,
    })),
    riskText: `${raw.url || ''} ${raw.user?.name || ''}`,
  });
}

export function mapPixabayImage(raw: any): MediaAsset {
  return makeAsset({
    id: stableId(['pixabay', 'image', raw.id]),
    provider: 'pixabay',
    mediaType: 'image',
    width: raw.imageWidth,
    height: raw.imageHeight,
    sourceUrl: raw.pageURL,
    downloadUrl: raw.largeImageURL || raw.webformatURL || raw.previewURL || raw.pageURL,
    previewUrl: raw.webformatURL || raw.previewURL || raw.largeImageURL || raw.pageURL,
    creator: raw.user || 'Pixabay contributor',
    title: raw.tags || `Pixabay image ${raw.id}`,
    licenseName: 'Pixabay Content License',
    licenseUrl: 'https://pixabay.com/service/license-summary/',
    riskText: `${raw.tags || ''} ${raw.user || ''}`,
  });
}

export function mapPixabayVideo(raw: any): MediaAsset {
  const videos = raw.videos || {};
  const preferred = videos.medium || videos.small || videos.large || videos.tiny;
  const thumbnail = preferred?.thumbnail || videos.small?.thumbnail || videos.tiny?.thumbnail || videos.large?.thumbnail || raw.userImageURL || '';
  return makeAsset({
    id: stableId(['pixabay', 'video', raw.id]),
    provider: 'pixabay',
    mediaType: 'video',
    width: preferred?.width,
    height: preferred?.height,
    duration: raw.duration,
    sourceUrl: raw.pageURL,
    downloadUrl: preferred?.url || raw.pageURL,
    previewUrl: thumbnail,
    creator: raw.user || 'Pixabay contributor',
    title: raw.tags || `Pixabay video ${raw.id}`,
    licenseName: 'Pixabay Content License',
    licenseUrl: 'https://pixabay.com/service/license-summary/',
    videoFiles: Object.entries(videos).map(([quality, file]: [string, any]) => ({
      link: file.url,
      width: file.width,
      height: file.height,
      quality,
    })),
    riskText: `${raw.tags || ''} ${raw.user || ''}`,
  });
}

export function mapWikimediaPage(page: any): MediaAsset | null {
  const imageInfo = page.imageinfo?.[0];
  if (!imageInfo?.url) return null;

  const meta = imageInfo.extmetadata || {};
  const title = stripHtml(meta.ObjectName?.value) || stripHtml(page.title || '').replace(/^File:/i, '') || `Wikimedia file ${page.pageid}`;
  const creator = stripHtml(meta.Artist?.value || meta.Credit?.value) || 'Wikimedia Commons contributor';
  const licenseName = stripHtml(meta.LicenseShortName?.value || meta.UsageTerms?.value) || 'Unknown';
  const licenseUrl = stripHtml(meta.LicenseUrl?.value) || imageInfo.descriptionurl || '';
  const sourceUrl = imageInfo.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || '')}`;

  return makeAsset({
    id: stableId(['wikimedia', page.pageid]),
    provider: 'wikimedia',
    mediaType: imageInfo.mime?.startsWith('video/') ? 'video' : 'image',
    width: imageInfo.width,
    height: imageInfo.height,
    sourceUrl,
    downloadUrl: imageInfo.url,
    previewUrl: imageInfo.thumburl || imageInfo.url,
    creator,
    title,
    licenseName,
    licenseUrl,
    riskText: `${title} ${creator} ${stripHtml(meta.ImageDescription?.value)} ${stripHtml(meta.Categories?.value)}`,
  });
}

export function mapOpenverseImage(raw: any): MediaAsset {
  const licenseName = [raw.license, raw.license_version].filter(Boolean).join(' ').toUpperCase() || 'Unknown';
  return makeAsset({
    id: stableId(['openverse', raw.id]),
    provider: 'openverse',
    mediaType: 'image',
    width: raw.width,
    height: raw.height,
    sourceUrl: raw.foreign_landing_url || raw.url,
    downloadUrl: raw.url,
    previewUrl: raw.thumbnail || raw.url,
    creator: raw.creator || 'Unknown creator',
    title: raw.title || `Openverse image ${raw.id}`,
    licenseName,
    licenseUrl: raw.license_url || '',
    riskFlags: ['openverse_unverified'],
    riskText: `${raw.title || ''} ${raw.creator || ''} ${raw.tags?.map((tag: any) => tag.name).join(' ') || ''}`,
  });
}

export function mapNasaItem(raw: any): MediaAsset | null {
  const data = raw.data?.[0];
  const preview = raw.links?.find((link: any) => link.render === 'image')?.href || raw.links?.[0]?.href;
  if (!data || !preview) return null;

  const nasaId = data.nasa_id || data.title;
  return makeAsset({
    id: stableId(['government', 'nasa', nasaId]),
    provider: 'government',
    mediaType: data.media_type === 'video' ? 'video' : 'image',
    sourceUrl: `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`,
    downloadUrl: preview,
    previewUrl: preview,
    creator: data.center ? `NASA ${data.center}` : 'NASA',
    title: data.title || `NASA media ${nasaId}`,
    licenseName: 'NASA Media Usage Guidelines',
    licenseUrl: 'https://www.nasa.gov/multimedia/guidelines/index.html',
    riskFlags: ['government'],
    riskText: `${data.title || ''} ${data.description || ''} NASA government logo insignia`,
  });
}

export async function searchPexelsAssets(
  query: string,
  mediaType: MediaType,
  aspectRatio: AspectRatio,
  apiKey?: string,
  perProvider = 8
): Promise<MediaAsset[]> {
  if (!apiKey) return [];

  if (mediaType === 'video') {
    const params = new URLSearchParams({
      query,
      orientation: pexelsOrientation(aspectRatio),
      per_page: String(perProvider),
    });
    const data = await fetchJson<any>(`${PEXELS_VIDEO_URL}?${params}`, {
      headers: { Authorization: apiKey },
    });
    return (data.videos || []).map(mapPexelsVideo);
  }

  const params = new URLSearchParams({
    query,
    orientation: pexelsOrientation(aspectRatio),
    per_page: String(perProvider),
  });
  const data = await fetchJson<any>(`${PEXELS_PHOTO_URL}?${params}`, {
    headers: { Authorization: apiKey },
  });
  return (data.photos || []).map(mapPexelsPhoto);
}

export async function searchPixabayAssets(
  query: string,
  mediaType: MediaType,
  aspectRatio: AspectRatio,
  apiKey?: string,
  perProvider = 8
): Promise<MediaAsset[]> {
  if (!apiKey) return [];

  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    per_page: String(perProvider),
    safesearch: 'true',
  });

  if (mediaType === 'video') {
    const data = await fetchJson<any>(`${PIXABAY_VIDEO_URL}?${params}`);
    return (data.hits || []).map(mapPixabayVideo);
  }

  params.set('image_type', 'photo');
  params.set('orientation', pixabayOrientation(aspectRatio));
  const data = await fetchJson<any>(`${PIXABAY_IMAGE_URL}?${params}`);
  return (data.hits || []).map(mapPixabayImage);
}

export async function searchWikimediaAssets(query: string, mediaType: MediaType, perProvider = 8): Promise<MediaAsset[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: String(perProvider * 2),
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '800',
    format: 'json',
    origin: '*',
  });
  const data = await fetchJson<any>(`${WIKIMEDIA_API_URL}?${params}`);
  const pages = Object.values(data.query?.pages || {});
  return pages
    .map(mapWikimediaPage)
    .filter((asset): asset is MediaAsset => Boolean(asset))
    .filter(asset => asset.mediaType === mediaType)
    .slice(0, perProvider);
}

export async function searchOpenverseAssets(query: string, mediaType: MediaType, perProvider = 8): Promise<MediaAsset[]> {
  if (mediaType !== 'image') return [];
  const params = new URLSearchParams({
    q: query,
    page_size: String(perProvider),
  });
  const data = await fetchJson<any>(`${OPENVERSE_IMAGE_URL}?${params}`);
  return (data.results || []).map(mapOpenverseImage);
}

export async function searchGovernmentAssets(query: string, mediaType: MediaType, perProvider = 8): Promise<MediaAsset[]> {
  const params = new URLSearchParams({
    q: query,
    media_type: mediaType,
  });
  const data = await fetchJson<any>(`${NASA_SEARCH_URL}?${params}`);
  return (data.collection?.items || [])
    .map(mapNasaItem)
    .filter((asset: MediaAsset | null): asset is MediaAsset => Boolean(asset))
    .slice(0, perProvider);
}

export async function searchMediaProvider(
  provider: MediaProvider,
  request: MediaSearchRequest,
  serverKeys: { pexels?: string; pixabay?: string } = {}
): Promise<MediaAsset[]> {
  const apiKeys = {
    pexels: request.apiKeys?.pexels || serverKeys.pexels,
    pixabay: request.apiKeys?.pixabay || serverKeys.pixabay,
  };
  const perProvider = request.perProvider || 8;

  if (provider === 'pexels') {
    return searchPexelsAssets(request.query, request.mediaType, request.aspectRatio, apiKeys.pexels, perProvider);
  }
  if (provider === 'pixabay') {
    return searchPixabayAssets(request.query, request.mediaType, request.aspectRatio, apiKeys.pixabay, perProvider);
  }
  if (provider === 'wikimedia') {
    return searchWikimediaAssets(request.query, request.mediaType, perProvider);
  }
  if (provider === 'openverse') {
    return searchOpenverseAssets(request.query, request.mediaType, perProvider);
  }
  if (provider === 'government') {
    return searchGovernmentAssets(request.query, request.mediaType, perProvider);
  }

  return [];
}

export async function searchMediaAssets(
  request: MediaSearchRequest,
  serverKeys: { pexels?: string; pixabay?: string } = {}
): Promise<MediaAsset[]> {
  const providers = request.providers.filter(provider => provider !== 'google_unverified');
  const settled = await Promise.allSettled(
    providers.map(provider => searchMediaProvider(provider, request, serverKeys))
  );

  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
