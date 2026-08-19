import type { Database } from '../../../db/client.js';
import { normalizeMention } from '../normalization/mention-normalizer.js';
import {
  getMentionCountMissingDate,
  getMentionCountsByDay,
  getMentionCountsBySource,
  getMentions,
  postMentions,
} from '../repositories/mention.repository.js';
import type {
  IngestionReport,
  MentionListResponse,
  MentionStatsResponse,
  NormalizedMention,
  RejectedRecord,
  StatsGroupBy,
} from '../types/mention.js';
import type { GetMentionsQuery } from '../validation/mention.validation.js';

const MAX_REPORTED_ERRORS = 50;

async function insertAtomically(
  db: Database,
  mentions: readonly NormalizedMention[],
): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const inserted = await postMentions(client, mentions);
    await client.query('COMMIT');
    return inserted;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function storeMentions(
  db: Database,
  records: readonly unknown[],
): Promise<IngestionReport> {
  const errors: RejectedRecord[] = [];
  const normalized: NormalizedMention[] = [];

  for (const [index, record] of records.entries()) {
    const result = normalizeMention(record);
    if (result.ok) {
      normalized.push(result.mention);
    } else if (errors.length < MAX_REPORTED_ERRORS) {
      errors.push({ index, reason: result.reason });
    }
  }

  const rejected = records.length - normalized.length;

  const unique = new Map<string, NormalizedMention>();
  for (const mention of normalized) {
    const key = mention.fingerprint.toString('base64');
    if (!unique.has(key)) unique.set(key, mention);
  }
  const withinBatch = normalized.length - unique.size;

  const toInsert = [...unique.values()];
  const inserted = toInsert.length > 0 ? await insertAtomically(db, toInsert) : 0;
  const alreadyStored = toInsert.length - inserted;

  return {
    received: records.length,
    accepted: normalized.length,
    rejected,
    inserted,
    duplicates: withinBatch + alreadyStored,
    duplicate_breakdown: { within_batch: withinBatch, already_stored: alreadyStored },
    errors,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

export async function fetchMentions(
  db: Database,
  query: GetMentionsQuery,
): Promise<MentionListResponse> {
  const offset = (query.page - 1) * query.page_size;

  const { rows, total } = await getMentions(
    db,
    {
      q: query.q === undefined ? null : escapeLikePattern(query.q),
      source: query.source ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
    },
    { limit: query.page_size, offset },
  );

  const totalPages = total === 0 ? 0 : Math.ceil(total / query.page_size);

  return {
    data: rows,
    pagination: {
      page: query.page,
      page_size: query.page_size,
      total,
      total_pages: totalPages,
      has_next: query.page < totalPages,
      has_previous: query.page > 1 && total > 0,
    },
  };
}

export async function fetchMentionStats(
  db: Database,
  groupBy: StatsGroupBy,
): Promise<MentionStatsResponse> {
  if (groupBy === 'source') {
    return { group_by: 'source', data: await getMentionCountsBySource(db) };
  }

  const [data, missing] = await Promise.all([
    getMentionCountsByDay(db),
    getMentionCountMissingDate(db),
  ]);
  return { group_by: 'day', data, missing_published_at: missing };
}
