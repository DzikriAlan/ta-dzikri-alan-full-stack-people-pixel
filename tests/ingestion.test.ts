import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countRows, createTestContext, truncateMentions, type TestContext } from './helpers/test-app.js';

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/messy-mentions.json',
);

let ctx: TestContext;
let seed: unknown[];

beforeAll(async () => {
  ctx = await createTestContext();
  seed = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown[];
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await truncateMentions(ctx.db);
});

function ingest(payload: unknown) {
  return ctx.app.inject({
    method: 'POST',
    url: '/internal/mentions/bulk',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  });
}

describe('POST /internal/mentions/bulk', () => {
  it('ingests the dataset and reports what happened to every record', async () => {
    const response = await ingest(seed);
    expect(response.statusCode).toBe(200);

    const report = response.json();
    expect(report.received).toBe(seed.length);
    expect(report.accepted + report.rejected).toBe(report.received);
    expect(report.inserted + report.duplicates).toBe(report.accepted);
    expect(await countRows(ctx.db)).toBe(report.inserted);
  });

  it('rejects unidentifiable records instead of inventing values for them', async () => {
    const report = (await ingest(seed)).json();
    expect(report.rejected).toBe(2);

    const reasons: string[] = report.errors.map((e: { reason: string }) => e.reason);
    expect(reasons.some((r) => r.includes('source'))).toBe(true);
    expect(reasons.some((r) => r.includes('title or content'))).toBe(true);
    expect(report.errors.every((e: { index: number }) => Number.isInteger(e.index))).toBe(true);
  });

  it('IS IDEMPOTENT: re-ingesting the same dataset adds no rows', async () => {
    const first = (await ingest(seed)).json();
    const countAfterFirst = await countRows(ctx.db);
    expect(countAfterFirst).toBeGreaterThan(0);
    expect(first.duplicate_breakdown.already_stored).toBe(0);

    const second = (await ingest(seed)).json();
    const countAfterSecond = await countRows(ctx.db);

    expect(countAfterSecond).toBe(countAfterFirst);
    expect(second.inserted).toBe(0);
    expect(second.duplicate_breakdown.already_stored).toBe(first.inserted);

    await ingest(seed);
    expect(await countRows(ctx.db)).toBe(countAfterFirst);
  });

  it('collapses duplicates that appear twice inside a single request', async () => {
    const report = (await ingest(seed)).json();
    expect(report.duplicate_breakdown.within_batch).toBeGreaterThan(0);
    expect(report.duplicate_breakdown.already_stored).toBe(0);
  });

  it('treats the same article as one mention despite tracking params and source spelling', async () => {
    await ingest([seed[0], seed[1]]);
    const { rows } = await ctx.db.query<{ count: number }>(
      "SELECT count(*)::bigint AS count FROM mentions WHERE url LIKE '%2024/03/15/digital%'",
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('deduplicates URL-less social posts by source and content', async () => {
    await ingest([seed[6], seed[7]]);
    const { rows } = await ctx.db.query<{ count: number }>(
      "SELECT count(*)::bigint AS count FROM mentions WHERE source = 'twitter'",
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('survives concurrent submissions of the same batch without duplicating rows', async () => {
    const baseline = (await ingest(seed)).json().inserted;
    expect(baseline).toBeGreaterThan(0);
    await truncateMentions(ctx.db);

    const responses = await Promise.all([ingest(seed), ingest(seed), ingest(seed), ingest(seed)]);
    for (const response of responses) expect(response.statusCode).toBe(200);

    expect(await countRows(ctx.db)).toBe(baseline);
    const totalInserted = responses.reduce((sum, r) => sum + r.json().inserted, 0);
    expect(totalInserted).toBe(baseline);
  });

  it('stores normalized values, keeping the original record in raw', async () => {
    await ingest([seed[0]]);
    const { rows } = await ctx.db.query(
      'SELECT source, source_raw, title, content, url, published_at, engagement, raw FROM mentions',
    );
    const row = rows[0];
    expect(row.source).toBe('kompas');
    expect(row.source_raw).toBe('Kompas.com');
    expect(row.content).toBe('Pertumbuhan ekonomi digital tercatat naik.');
    expect(row.content).not.toContain('<');
    expect(row.content).not.toContain('track()');
    expect(row.url).not.toContain('utm_source');
    expect(row.engagement).toBe(1240);
    expect(row.published_at.toISOString()).toBe('2024-03-15T08:30:00.000Z');
    expect(row.raw.content).toContain('<b>');
  });

  it('stores a missing date as NULL and never as a guessed day', async () => {
    await ingest([seed[8], seed[9]]);
    const { rows } = await ctx.db.query<{ published_at: Date | null; published_at_raw: string | null }>(
      'SELECT published_at, published_at_raw FROM mentions ORDER BY id',
    );
    expect(rows.every((r) => r.published_at === null)).toBe(true);
    expect(rows.map((r) => r.published_at_raw).filter(Boolean)).toEqual(['sometime last week']);
  });

  it('accepts the wrapped body shape as well as a bare array', async () => {
    const response = await ingest({ mentions: [seed[0]] });
    expect(response.statusCode).toBe(200);
    expect(response.json().inserted).toBe(1);
  });

  it('rejects malformed request bodies with a 4xx and no internal detail', async () => {
    const notAnArray = await ingest({ foo: 'bar' });
    expect(notAnArray.statusCode).toBe(400);
    expect(notAnArray.json().error.code).toBe('VALIDATION_ERROR');

    const malformed = await ctx.app.inject({
      method: 'POST',
      url: '/internal/mentions/bulk',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(malformed.json())).not.toMatch(/INSERT|postgres|password|at Object/i);
  });

  it('rejects a non-JSON content type with 415', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/mentions/bulk',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('accepts an empty batch without failing', async () => {
    const response = await ingest([]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ received: 0, inserted: 0, duplicates: 0 });
  });
});
