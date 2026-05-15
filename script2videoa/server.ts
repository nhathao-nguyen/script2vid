import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';
import { classifyLicense } from './src/lib/licenseGate';
import { searchMediaAssets } from './src/lib/mediaProviders';
import type { MediaAsset, MediaProvider, MediaSearchRequest, MediaType } from './src/types';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let geminiClient = null;
let geminiClientKey = null;

function getGeminiClient() {
  let apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    console.warn('GEMINI_API_KEY is missing, proceeding anyway. Keys may be injected differently.');
  } else {
    apiKey = apiKey.replace(/^["']|["']$/g, '').trim();
  }

  if (!geminiClient || geminiClientKey !== apiKey) {
    geminiClient = new GoogleGenAI({ apiKey: apiKey || '' });
    geminiClientKey = apiKey;
  }

  return geminiClient;
}

function getErrorMessage(error) {
  let message = error instanceof Error ? error.message : String(error || '');
  try {
    if (message.startsWith('{') && message.includes('"error"')) {
      const parsed = JSON.parse(message);
      if (parsed.error && parsed.error.message) {
        message = parsed.error.message;
      }
    }
  } catch (e) {}

  const normalized = message.toLowerCase();
  
  if (normalized.includes('api key not valid')) {
    return 'API key not valid. Please configure a valid Gemini API key in the AI Studio Secrets panel.';
  }

  return message || 'Unexpected server error';
}


const DEFAULT_IMAGE_PROVIDERS: MediaProvider[] = ['pexels', 'pixabay', 'wikimedia', 'openverse', 'government'];
const DEFAULT_VIDEO_PROVIDERS: MediaProvider[] = ['pexels', 'pixabay', 'government'];

function parseProviders(value: unknown, mediaType: MediaType): MediaProvider[] {
  const allowed = new Set<MediaProvider>(['pexels', 'pixabay', 'wikimedia', 'openverse', 'government', 'google_unverified']);
  if (!Array.isArray(value)) {
    return mediaType === 'video' ? DEFAULT_VIDEO_PROVIDERS : DEFAULT_IMAGE_PROVIDERS;
  }

  const providers = value.filter((provider): provider is MediaProvider => allowed.has(provider));
  return providers.length > 0 ? providers : (mediaType === 'video' ? DEFAULT_VIDEO_PROVIDERS : DEFAULT_IMAGE_PROVIDERS);
}

function normalizeMediaSearchRequest(body: any): MediaSearchRequest {
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  const mediaType: MediaType = body?.mediaType === 'video' ? 'video' : 'image';

  if (!query) {
    throw new Error('Query is required');
  }

  return {
    query,
    mediaType,
    aspectRatio: body?.aspectRatio === 'portrait' || body?.aspectRatio === 'square' ? body.aspectRatio : 'landscape',
    providers: parseProviders(body?.providers, mediaType),
    perProvider: Number(body?.perProvider) || 8,
    apiKeys: {
      pexels: typeof body?.apiKeys?.pexels === 'string' ? body.apiKeys.pexels : undefined,
      pixabay: typeof body?.apiKeys?.pixabay === 'string' ? body.apiKeys.pixabay : undefined,
    },
  };
}

function reclassifyAsset(asset: MediaAsset): MediaAsset {
  const decision = classifyLicense({
    provider: asset.provider,
    licenseName: asset.license.name,
    licenseUrl: asset.license.url,
    sourceUrl: asset.sourceUrl,
    creator: asset.creator,
    title: asset.title,
    attributionText: asset.attributionText,
    riskFlags: asset.riskFlags,
  });

  return {
    ...asset,
    license: decision.license,
    licenseStatus: decision.licenseStatus,
    riskFlags: decision.riskFlags,
    attributionText: decision.attributionText,
    blockedReasons: decision.blockedReasons,
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  

  app.post('/api/media/search', async (req, res) => {
    try {
      const request = normalizeMediaSearchRequest(req.body);
      const items = await searchMediaAssets(request, {
        pexels: process.env.PEXELS_API_KEY,
        pixabay: process.env.PIXABAY_API_KEY,
      });
      res.json({ items });
    } catch (error) {
      console.error('Media Search Error:', error);
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.post('/api/media/verify-license', async (req, res) => {
    const asset = req.body?.asset as MediaAsset | undefined;
    if (!asset?.id || !asset?.provider) {
      return res.status(400).json({ error: 'Asset is required' });
    }

    try {
      res.json({ asset: reclassifyAsset(asset) });
    } catch (error) {
      console.error('License Verify Error:', error);
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.post('/api/media/download', async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url : '';
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Valid media URL is required' });
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 LicenseSafeMediaPipeline/1.0',
        },
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: `Download failed: ${response.statusText}` });
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const arrayBuffer = await response.arrayBuffer();
      res.setHeader('Content-Type', contentType);
      res.send(Buffer.from(arrayBuffer));
    } catch (error) {
      console.error('Media Download Error:', error);
      res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  // Google Images Scraper Endpoint
  app.get('/api/image-search', async (req, res) => {
    const { q, num = 5 } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Query is required' });
    }

    try {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q as string)}&tbm=isch`;

      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/',
        },
      });

      const $ = cheerio.load(response.data);
      const images: any[] = [];

      $('img').each((i, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        const alt = $(el).attr('alt') || '';

        if (src && src.startsWith('http') && !src.includes('gstatic.com/favicon') && !src.includes('googlelogo')) {
          images.push({
            id: Date.now() + i,
            url: src,
            alt,
            source: 'Google Images',
          });
        }
      });

      $('script').each((i, el) => {
        const content = $(el).html() || '';
        if (content.includes('AF_initDataCallback') && content.includes('ds:1')) {
          try {
            const urls = content.match(/https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)/g);
            if (urls) {
              urls.forEach((url, j) => {
                if (!url.includes('gstatic.com') && !url.includes('google.com')) {
                  images.push({
                    id: Date.now() + i + j + 500,
                    url,
                    alt: q as string,
                    source: 'Google Images',
                  });
                }
              });
            }
          } catch {
            // Ignore best-effort scraper parse errors.
          }
        }
      });

      if (images.length < 2) {
        $('a[href^="/imgres"]').each((i, el) => {
          const img = $(el).find('img');
          const src = img.attr('src') || img.attr('data-src');
          if (src && src.startsWith('http')) {
            images.push({
              id: Date.now() + i + 100,
              url: src,
              alt: img.attr('alt') || '',
              source: 'Google Images',
            });
          }
        });
      }

      const uniqueImages = Array.from(new Map(images.map(img => [img.url, img])).values());

      res.json({
        items: uniqueImages.slice(0, Number(num)).map(img => ({
          id: img.id,
          width: 1920,
          height: 1080,
          url: img.url,
          photographer: img.source,
          photographer_url: 'https://images.google.com',
          src: {
            original: img.url,
            large2x: img.url,
            large: img.url,
            medium: img.url,
            small: img.url,
            portrait: img.url,
            landscape: img.url,
            tiny: img.url,
          },
          alt: img.alt,
        })),
      });
    } catch (error: any) {
      console.error('Scraping Error:', error.message);
      res.status(500).json({ error: 'Failed to fetch images' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
