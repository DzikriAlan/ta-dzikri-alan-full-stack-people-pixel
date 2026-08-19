import type { Queryable } from '../../../db/client.js';
import type {
  DayCountRow,
  MentionResource,
  MentionSearchFilters,
  MentionSearchPage,
  MentionSearchResult,
  NormalizedMention,
  SourceCountRow,
} from '../types/mention.js';

const COLUMNS = [
  'fingerprint',
  'source',
  'source_raw',
  'title',
  'content',
  'url',
  'url_raw',
  'published_at',
  'published_at_raw',
  'author',
  'engagement',
  'raw',
] as const;

const INSERT_CHUNK_SIZE = 500;

const ORDER_BY = 'ORDER BY published_at DESC NULLS LAST, id DESC';

function toValues(mention: NormalizedMention): unknown[] {
  return [
    mention.fingerprint,
    mention.source,
    mention.sourceRaw,
    mention.title,
    mention.content,
    mention.url,
    mention.urlRaw,
    mention.publishedAt,
    mention.publishedAtRaw,
    mention.author,
    mention.engagement,
    JSON.stringify(mention.raw),
  ];
}

export async function postMentions(
  db: Queryable,
  mentions: readonly NormalizedMention[],
): Promise<number> {
  let inserted = 0;

  for (let offset = 0; offset < mentions.length; offset += INSERT_CHUNK_SIZE) {
    const chunk = mentions.slice(offset, offset + INSERT_CHUNK_SIZE);

    const placeholders = chunk
      .map(
        (_, row) =>
          `(${COLUMNS.map((_column, column) => `$${row * COLUMNS.length + column + 1}`).join(', ')})`,
      )
      .join(', ');

    const sql = `
      INSERT INTO mentions (${COLUMNS.join(', ')})
      VALUES ${placeholders}
      ON CONFLICT (fingerprint) DO NOTHING
      RETURNING id
    `;

    const result = await db.query(sql, chunk.flatMap(toValues));
    inserted += result.rowCount ?? 0;
  }

  return inserted;
}

interface WhereClause {
  sql: string;
  values: unknown[];
}

function buildWhere(filters: MentionSearchFilters): WhereClause {
  const conditions: string[] = [];
  const values: unknown[] = [];

  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filters.q !== null) {
    const pattern = bind(`%${filters.q}%`);
    conditions.push(`(title ILIKE ${pattern} OR content ILIKE ${pattern})`);
  }

  if (filters.source !== null) {
    conditions.push(`source = ${bind(filters.source)}`);
  }

  if (filters.from !== null) {
    conditions.push(`published_at >= ${bind(filters.from)}`);
  }
  if (filters.to !== null) {
    conditions.push(`published_at < ${bind(filters.to)}`);
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

interface MentionRow {
  id: number;
  source: string;
  source_raw: string;
  title: string | null;
  content: string | null;
  url: string | null;
  published_at: Date | null;
  author: string | null;
  engagement: number | null;
  created_at: Date;
}

function toResource(row: MentionRow): MentionResource {
  return {
    id: row.id,
    source: row.source,
    source_raw: row.source_raw,
    title: row.title,
    content: row.content,
    url: row.url,
    published_at: row.published_at?.toISOString() ?? null,
    author: row.author,
    engagement: row.engagement,
    created_at: row.created_at.toISOString(),
  };
}

export async function getMentions(
  db: Queryable,
  filters: MentionSearchFilters,
  page: MentionSearchPage,
): Promise<MentionSearchResult> {
  const where = buildWhere(filters);

  const rowsSql = `
    SELECT id, source, source_raw, title, content, url, published_at, author, engagement, created_at
    FROM mentions
    ${where.sql}
    ${ORDER_BY}
    LIMIT $${where.values.length + 1}
    OFFSET $${where.values.length + 2}
  `;

  const countSql = `SELECT count(*)::bigint AS total FROM mentions ${where.sql}`;

  const [rowsResult, countResult] = await Promise.all([
    db.query<MentionRow>(rowsSql, [...where.values, page.limit, page.offset]),
    db.query<{ total: number }>(countSql, where.values),
  ]);

  return {
    rows: rowsResult.rows.map(toResource),
    total: countResult.rows[0]?.total ?? 0,
  };
}

export async function getMentionCountsBySource(db: Queryable): Promise<SourceCountRow[]> {
  const { rows } = await db.query<SourceCountRow>(`
    SELECT source AS "group", min(source_raw) AS label, count(*)::bigint AS count
    FROM mentions
    GROUP BY source
    ORDER BY count DESC, source ASC
  `);
  return rows;
}

export async function getMentionCountsByDay(db: Queryable): Promise<DayCountRow[]> {
  const { rows } = await db.query<DayCountRow>(`
    SELECT to_char(date_trunc('day', published_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "group",
           count(*)::bigint AS count
    FROM mentions
    WHERE published_at IS NOT NULL
    GROUP BY 1
    ORDER BY 1 ASC
  `);
  return rows;
}

export async function getMentionCountMissingDate(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    'SELECT count(*)::bigint AS count FROM mentions WHERE published_at IS NULL',
  );
  return rows[0]?.count ?? 0;
}
