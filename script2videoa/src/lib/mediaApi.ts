import { MediaAsset, MediaSearchRequest } from '../types';

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
  const payload = await postJson<{ items: MediaAsset[] }>('/api/media/search', request);
  return Array.isArray(payload.items) ? payload.items : [];
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
