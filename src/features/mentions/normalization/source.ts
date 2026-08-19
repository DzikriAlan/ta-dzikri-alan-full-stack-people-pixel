import { collapseWhitespace, normalizeText } from './text.js';

export function normalizeSource(value: string): string {
  const trimmed = collapseWhitespace(value);
  const withoutScheme = trimmed.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  const withoutWww = withoutScheme.replace(/^www\./i, '');

  const domainLike = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(withoutWww);
  const label = domainLike ? (withoutWww.split('/')[0] ?? '').split('.')[0] ?? '' : withoutWww;

  return label.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface NormalizedSource {
  source: string;
  sourceRaw: string;
}

export function normalizeSourceField(value: string | null | undefined): NormalizedSource | null {
  const raw = normalizeText(value);
  if (raw === null) return null;
  const source = normalizeSource(raw);
  if (source.length === 0) return null;
  return { source, sourceRaw: raw };
}
