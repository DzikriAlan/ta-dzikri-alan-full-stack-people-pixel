import type { FingerprintStrategy } from '../normalization/fingerprint.js';

export interface NormalizedMention {
  fingerprint: Buffer;
  fingerprintStrategy: FingerprintStrategy;
  source: string;
  sourceRaw: string;
  title: string | null;
  content: string | null;
  url: string | null;
  urlRaw: string | null;
  publishedAt: Date | null;
  publishedAtRaw: string | null;
  author: string | null;
  engagement: number | null;
  raw: unknown;
}

export interface MentionResource {
  id: number;
  source: string;
  source_raw: string;
  title: string | null;
  content: string | null;
  url: string | null;
  published_at: string | null;
  author: string | null;
  engagement: number | null;
  created_at: string;
}

export interface MentionSearchFilters {
  q: string | null;
  source: string | null;
  from: Date | null;
  to: Date | null;
}

export interface MentionSearchPage {
  limit: number;
  offset: number;
}

export interface MentionSearchResult {
  rows: MentionResource[];
  total: number;
}

export interface SourceCountRow {
  group: string;
  label: string;
  count: number;
}

export interface DayCountRow {
  group: string;
  count: number;
}

export interface PaginationMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface MentionListResponse {
  data: MentionResource[];
  pagination: PaginationMeta;
}

export type StatsGroupBy = 'source' | 'day';

export interface StatsBucket {
  group: string;
  label?: string;
  count: number;
}

export interface MentionStatsResponse {
  group_by: StatsGroupBy;
  data: StatsBucket[];
  missing_published_at?: number;
}

export interface RejectedRecord {
  index: number;
  reason: string;
}

export interface IngestionReport {
  received: number;
  accepted: number;
  rejected: number;
  inserted: number;
  duplicates: number;
  duplicate_breakdown: {
    within_batch: number;
    already_stored: number;
  };
  errors: RejectedRecord[];
}
