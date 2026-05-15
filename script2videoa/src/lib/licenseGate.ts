import { LicenseStatus, MediaAsset, MediaLicense, MediaProvider, RiskFlag } from '../types';

const PEXELS_LICENSE_URL = 'https://www.pexels.com/license/';
const PIXABAY_LICENSE_URL = 'https://pixabay.com/service/license-summary/';
const CC0_LICENSE_URL = 'https://creativecommons.org/public-domain/cc0/';

interface LicenseGateInput {
  provider: MediaProvider;
  licenseName?: string;
  licenseUrl?: string;
  sourceUrl?: string;
  creator?: string;
  title?: string;
  attributionText?: string;
  riskFlags?: RiskFlag[];
}

export interface LicenseGateDecision {
  license: MediaLicense;
  licenseStatus: LicenseStatus;
  riskFlags: RiskFlag[];
  attributionText: string;
  blockedReasons: string[];
}

const nowIso = () => new Date().toISOString();

export function stripHtml(value?: string) {
  return (value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasRequiredAttributionFields(input: LicenseGateInput) {
  return Boolean(input.creator && input.title && input.sourceUrl && input.licenseUrl && input.attributionText);
}

function makeLicense(input: LicenseGateInput, overrides: Partial<MediaLicense> = {}): MediaLicense {
  return {
    name: input.licenseName || 'Unknown',
    url: input.licenseUrl || '',
    commercialUseAllowed: false,
    requiresAttribution: false,
    requiresShareAlike: false,
    allowsDerivatives: false,
    verifiedAt: nowIso(),
    ...overrides,
  };
}

export function buildAttributionText(input: Pick<LicenseGateInput, 'title' | 'creator' | 'sourceUrl' | 'licenseName' | 'licenseUrl'>) {
  const title = input.title || 'Untitled media';
  const creator = input.creator || 'Unknown creator';
  const source = input.sourceUrl || '';
  const licenseName = input.licenseName || 'Unknown license';
  const licenseUrl = input.licenseUrl || '';

  return `"${title}" by ${creator}. Source: ${source}. License: ${licenseName}${licenseUrl ? ` (${licenseUrl})` : ''}.`;
}

export function classifyLicense(input: LicenseGateInput): LicenseGateDecision {
  const provider = input.provider;
  const rawName = input.licenseName || '';
  const normalized = rawName.toLowerCase();
  const riskFlags = [...new Set(input.riskFlags || [])];
  const attributionText = input.attributionText || buildAttributionText(input);
  const blockedReasons: string[] = [];

  if (provider === 'pexels') {
    return {
      license: makeLicense(input, {
        name: 'Pexels License',
        url: PEXELS_LICENSE_URL,
        commercialUseAllowed: true,
        allowsDerivatives: true,
      }),
      licenseStatus: 'approved',
      riskFlags,
      attributionText,
      blockedReasons,
    };
  }

  if (provider === 'pixabay') {
    return {
      license: makeLicense(input, {
        name: 'Pixabay Content License',
        url: PIXABAY_LICENSE_URL,
        commercialUseAllowed: true,
        allowsDerivatives: true,
      }),
      licenseStatus: 'approved',
      riskFlags,
      attributionText,
      blockedReasons,
    };
  }

  if (provider === 'openverse') {
    return {
      license: makeLicense(input, {
        commercialUseAllowed: false,
        requiresAttribution: normalized.includes('by'),
        requiresShareAlike: normalized.includes('sa'),
        allowsDerivatives: !normalized.includes('nd'),
      }),
      licenseStatus: 'review_required',
      riskFlags: [...new Set<RiskFlag>([...riskFlags, 'openverse_unverified'])],
      attributionText,
      blockedReasons: ['Openverse license metadata must be verified at the original source before monetized use.'],
    };
  }

  if (provider === 'google_unverified') {
    return {
      license: makeLicense(input),
      licenseStatus: 'review_required',
      riskFlags,
      attributionText,
      blockedReasons: ['Google Images scraping does not provide reliable license metadata.'],
    };
  }

  if (normalized.includes('noncommercial') || /\bnc\b/.test(normalized)) {
    blockedReasons.push('NonCommercial licenses are not accepted for monetized YouTube use.');
  }

  if (normalized.includes('no derivatives') || normalized.includes('noderivatives') || /\bnd\b/.test(normalized)) {
    blockedReasons.push('NoDerivatives licenses are not accepted because video editing creates derivatives.');
  }

  if (normalized.includes('all rights reserved')) {
    blockedReasons.push('All rights reserved assets are not reusable without explicit permission.');
  }

  if (!rawName || normalized.includes('unknown') || normalized.includes('unspecified')) {
    blockedReasons.push('License is missing or unknown.');
  }

  if (normalized.includes('gfdl') || normalized.includes('gnu free documentation')) {
    blockedReasons.push('GFDL assets require redistribution conditions that are not safe for this workflow.');
  }

  if (blockedReasons.length > 0) {
    return {
      license: makeLicense(input, {
        commercialUseAllowed: false,
        requiresAttribution: normalized.includes('by'),
        requiresShareAlike: normalized.includes('sa'),
        allowsDerivatives: false,
      }),
      licenseStatus: 'rejected',
      riskFlags,
      attributionText,
      blockedReasons,
    };
  }

  if (
    normalized.includes('cc0') ||
    normalized.includes('public domain') ||
    normalized.includes('public domain mark') ||
    normalized.includes('pdm')
  ) {
    return {
      license: makeLicense(input, {
        name: rawName || 'Public Domain',
        url: input.licenseUrl || CC0_LICENSE_URL,
        commercialUseAllowed: true,
        allowsDerivatives: true,
      }),
      licenseStatus: 'approved',
      riskFlags,
      attributionText,
      blockedReasons,
    };
  }

  if (normalized.includes('cc by-sa') || normalized.includes('creative commons attribution-sharealike')) {
    return {
      license: makeLicense(input, {
        commercialUseAllowed: true,
        requiresAttribution: true,
        requiresShareAlike: true,
        allowsDerivatives: true,
      }),
      licenseStatus: 'review_required',
      riskFlags,
      attributionText,
      blockedReasons: ['ShareAlike reuse requires manual review before export.'],
    };
  }

  if (normalized.includes('cc by') || normalized.includes('creative commons attribution')) {
    if (!hasRequiredAttributionFields({ ...input, attributionText })) {
      return {
        license: makeLicense(input, {
          commercialUseAllowed: true,
          requiresAttribution: true,
          allowsDerivatives: true,
        }),
        licenseStatus: 'rejected',
        riskFlags,
        attributionText,
        blockedReasons: ['CC BY asset is missing title, creator, source URL, license URL, or attribution text.'],
      };
    }

    return {
      license: makeLicense(input, {
        commercialUseAllowed: true,
        requiresAttribution: true,
        allowsDerivatives: true,
      }),
      licenseStatus: 'attribution_required',
      riskFlags,
      attributionText,
      blockedReasons,
    };
  }

  if (provider === 'government') {
    return {
      license: makeLicense(input, {
        commercialUseAllowed: false,
        allowsDerivatives: true,
      }),
      licenseStatus: 'review_required',
      riskFlags: [...new Set<RiskFlag>([...riskFlags, 'government'])],
      attributionText,
      blockedReasons: ['Government or international organization source requires manual verification.'],
    };
  }

  return {
    license: makeLicense(input),
    licenseStatus: 'rejected',
    riskFlags,
    attributionText,
    blockedReasons: ['No accepted commercial-use license rule matched this asset.'],
  };
}

export function isAssetExportable(asset: MediaAsset) {
  return asset.licenseStatus === 'approved' ||
    asset.licenseStatus === 'attribution_required' ||
    (asset.licenseStatus === 'review_required' && asset.isManuallyVerified);
}

export function shouldAutoSelect(asset: MediaAsset) {
  return asset.licenseStatus === 'approved' || asset.licenseStatus === 'attribution_required';
}
