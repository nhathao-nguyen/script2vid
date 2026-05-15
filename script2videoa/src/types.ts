export type AspectRatio = 'landscape' | 'portrait' | 'square';
export type SearchLanguage = 'original' | 'english';
export type MediaType = 'image' | 'video';
export type MediaProvider = 'pexels' | 'pixabay' | 'wikimedia' | 'openverse' | 'government' | 'google_unverified';
export type LicenseStatus = 'approved' | 'attribution_required' | 'review_required' | 'rejected';
export type RiskFlag =
  | 'person'
  | 'logo'
  | 'trademark'
  | 'map'
  | 'news_event'
  | 'government'
  | 'international_org'
  | 'openverse_unverified';

export interface MediaLicense {
  name: string;
  url: string;
  commercialUseAllowed: boolean;
  requiresAttribution: boolean;
  requiresShareAlike: boolean;
  allowsDerivatives: boolean;
  verifiedAt: string;
}

export interface MediaAsset {
  id: string;
  provider: MediaProvider;
  mediaType: MediaType;
  width?: number;
  height?: number;
  duration?: number;
  sourceUrl: string;
  downloadUrl: string;
  previewUrl: string;
  creator: string;
  title: string;
  license: MediaLicense;
  licenseStatus: LicenseStatus;
  riskFlags: RiskFlag[];
  attributionText: string;
  reviewNotes?: string;
  blockedReasons: string[];
  isManuallyVerified?: boolean;
  videoFiles?: { link: string; width?: number; height?: number; quality?: string }[];
}

export interface MediaSearchRequest {
  query: string;
  mediaType: MediaType;
  aspectRatio: AspectRatio;
  providers: MediaProvider[];
  perProvider?: number;
  apiKeys?: {
    pexels?: string;
    pixabay?: string;
  };
}

export interface ScriptSegment {
  id: string;
  sentence_id: number;
  scene_count: number;
  scene_text: string;
  vietnamese_translation: string;
  scene_summary: string;
  visual_meaning: string;
  camera_style: string;
  emotion: string;
  style: string;
  media_type: MediaType;
  keywords: string[];
  media_queries: string[];
  visual_description: string;
  selection_required: boolean;
  export_file: string;
  search_intent: 'stock' | 'real_person' | 'real_event' | 'place' | 'documentary' | 'abstract';
  entity_names: string[];
  provider_priority: MediaProvider[];
  
  // Results
  options: MediaAsset[];
  selectedAssetId?: string;
  status: 'idle' | 'processing' | 'searching' | 'completed' | 'error';
  error?: string;
}

export interface AppSettings {
  pexelsApiKey: string;
  pixabayApiKey: string;
  language: SearchLanguage;
  aspectRatio: AspectRatio;
  targetRegion: string;
}
