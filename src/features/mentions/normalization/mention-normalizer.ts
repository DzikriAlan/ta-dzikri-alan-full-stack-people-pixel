import { postMentionRecordSchema, type PostMentionRecord } from '../validation/mention.validation.js';
import type { NormalizedMention } from '../types/mention.js';
import { computeFingerprint } from './fingerprint.js';
import { normalizeCount } from './number.js';
import { parsePublishedAt } from './date.js';
import { normalizeSourceField } from './source.js';
import { normalizeText } from './text.js';
import { normalizeUrl } from './url.js';

export interface NormalizationFailure {
  index: number;
  reason: string;
}

export type NormalizationResult =
  | { ok: true; mention: NormalizedMention }
  | { ok: false; reason: string };

function firstOf<T>(...values: (T | null | undefined)[]): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

export function normalizeMention(input: unknown): NormalizationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'Record must be a JSON object' };
  }

  const parsed = postMentionRecordSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      reason: issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'Invalid record',
    };
  }

  const record: PostMentionRecord = parsed.data;

  const source = normalizeSourceField(
    firstOf(record.source, record.source_name, record.sourceName, record.publisher),
  );
  if (source === null) {
    return { ok: false, reason: 'source is required and must contain at least one alphanumeric character' };
  }

  const title = normalizeText(firstOf(record.title, record.headline));
  const content = normalizeText(
    firstOf(record.content, record.body, record.text, record.description),
  );

  if (title === null && content === null) {
    return { ok: false, reason: 'record must contain a title or content' };
  }

  const url = normalizeUrl(firstOf(record.url, record.link, record.permalink));

  const publishedInput = firstOf(
    record.published_at,
    record.publishedAt,
    record.published_date,
    record.date,
    record.created_at,
  );
  const publishedAt = parsePublishedAt(publishedInput);

  const publishedAtRaw =
    publishedAt === null && publishedInput !== null ? String(publishedInput) : null;

  const engagement = normalizeCount(
    firstOf(record.engagement, record.engagement_count, record.reach, record.views),
  );

  const fingerprint = computeFingerprint({
    source: source.source,
    url: url?.url ?? null,
    title,
    content,
  });

  return {
    ok: true,
    mention: {
      fingerprint: fingerprint.value,
      fingerprintStrategy: fingerprint.strategy,
      source: source.source,
      sourceRaw: source.sourceRaw,
      title,
      content,
      url: url?.url ?? null,
      urlRaw: url?.urlRaw ?? null,
      publishedAt,
      publishedAtRaw,
      author: normalizeText(firstOf(record.author, record.author_name)),
      engagement,
      raw: input,
    },
  };
}
