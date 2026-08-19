import { createHash } from 'node:crypto';

export type FingerprintStrategy = 'url' | 'content';

export interface Fingerprint {
  value: Buffer;
  strategy: FingerprintStrategy;
}

const SEP = String.fromCharCode(31);

function schemeless(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

function comparisonForm(value: string | null): string {
  if (value === null) return '';
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const CONTENT_PREFIX_LENGTH = 500;

export interface FingerprintInput {
  source: string;
  url: string | null;
  title: string | null;
  content: string | null;
}

export function computeFingerprint(input: FingerprintInput): Fingerprint {
  const strategy: FingerprintStrategy = input.url !== null ? 'url' : 'content';

  const parts =
    input.url !== null
      ? ['v1', 'url', schemeless(input.url)]
      : [
          'v1',
          'content',
          input.source,
          comparisonForm(input.title),
          comparisonForm(input.content).slice(0, CONTENT_PREFIX_LENGTH),
        ];

  const value = createHash('sha256').update(parts.join(SEP), 'utf8').digest();
  return { value, strategy };
}
