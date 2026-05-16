import { MediaAsset, MediaSearchRequest } from '../types';

let queue: (() => void)[] = [];
let activeCount = 0;
// Limit to 3 concurrent requests to avoid server/API rate limiting
const MAX_CONCURRENT = 3;

async function enqueue(): Promise<void> {
  if (activeCount >= MAX_CONCURRENT) {
    await new Promise<void>(resolve => queue.push(resolve));
  }
  activeCount++;
}

function dequeue(): void {
  activeCount--;
  if (queue.length > 0) {
    const next = queue.shift();
    if (next) next();
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with ${response.status}`);
  }

  return payload as T;
}

export async function searchLicensedMedia(request: MediaSearchRequest): Promise<MediaAsset[]> {
  await enqueue();
  try {
    const payload = await postJson<{ items: MediaAsset[] }>('/api/media/search', request);
    return Array.isArray(payload.items) ? payload.items : [];
  } finally {
    dequeue();
  }
}

export async function verifyMediaAsset(asset: MediaAsset): Promise<MediaAsset> {
  const payload = await postJson<{ asset: MediaAsset }>('/api/media/verify-license', { asset });
  return payload.asset;
}

export async function downloadMediaBlob(asset: MediaAsset): Promise<Response> {
  const response = await fetch('/api/media/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: asset.downloadUrl }),
  });

  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}`);
  }

  return response;
}
