import { collapseWhitespace } from './text.js';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'source',
  'spm',
]);

export interface NormalizedUrl {
  url: string;
  urlRaw: string;
}

export function normalizeUrl(value: string | null | undefined): NormalizedUrl | null {
  if (value == null) return null;
  const raw = collapseWhitespace(value);
  if (raw.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  parsed.hostname = parsed.hostname.replace(/^www\./i, '');
  parsed.hash = '';

  const kept = [...parsed.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  parsed.search = '';
  for (const [key, entryValue] of kept) parsed.searchParams.append(key, entryValue);

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return { url: parsed.toString(), urlRaw: raw };
}
