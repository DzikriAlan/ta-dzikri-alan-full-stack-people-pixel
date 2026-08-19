import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, truncateMentions, type TestContext } from './helpers/test-app.js';

let ctx: TestContext;

const dataset = [
  { source: 'Kompas.com', title: 'A', content: 'x', url: 'https://kompas.com/a', published_at: '2024-03-15T10:00:00Z' },
  { source: 'KOMPAS', title: 'B', content: 'x', url: 'https://kompas.com/b', published_at: '2024-03-15T23:59:00Z' },
  { source: 'kompas', title: 'C', content: 'x', url: 'https://kompas.com/c', published_at: '2024-03-14T00:00:00Z' },
  { source: 'Tempo.co', title: 'D', content: 'x', url: 'https://tempo.co/d', published_at: '2024-03-14T12:00:00Z' },
  { source: 'Detik', title: 'E', content: 'x', url: 'https://detik.com/e', published_at: null },
  { source: 'Detik', title: 'F', content: 'x', url: 'https://detik.com/f', published_at: 'not a date' },
];

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await truncateMentions(ctx.db);
  await ctx.app.inject({
    method: 'POST',
    url: '/internal/mentions/bulk',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(dataset),
  });
});

const get = (url: string) => ctx.app.inject({ method: 'GET', url });

describe('GET /mentions/stats', () => {
  it('counts by normalized source, folding spelling variants together', async () => {
    const body = (await get('/mentions/stats?group_by=source')).json();
    expect(body.group_by).toBe('source');

    const counts = Object.fromEntries(
      body.data.map((b: { group: string; count: number }) => [b.group, b.count]),
    );
    expect(counts).toEqual({ kompas: 3, tempo: 1, detik: 2 });
    expect(body.data.reduce((sum: number, b: { count: number }) => sum + b.count, 0)).toBe(6);
  });

  it('exposes a readable label alongside the normalized key', async () => {
    const body = (await get('/mentions/stats?group_by=source')).json();
    const kompas = body.data.find((b: { group: string }) => b.group === 'kompas');
    expect(typeof kompas.label).toBe('string');
    expect(kompas.label.toLowerCase()).toContain('kompas');
  });

  it('orders sources by descending count', async () => {
    const counts = (await get('/mentions/stats?group_by=source'))
      .json()
      .data.map((b: { count: number }) => b.count);
    expect(counts).toEqual([...counts].sort((a: number, b: number) => b - a));
  });

  it('counts by UTC calendar day', async () => {
    const body = (await get('/mentions/stats?group_by=day')).json();
    expect(body.group_by).toBe('day');
    expect(body.data).toEqual([
      { group: '2024-03-14', count: 2 },
      { group: '2024-03-15', count: 2 },
    ]);
  });

  it('reports undated mentions separately instead of assigning them a day', async () => {
    const body = (await get('/mentions/stats?group_by=day')).json();
    expect(body.missing_published_at).toBe(2);

    const dayTotal = body.data.reduce((sum: number, b: { count: number }) => sum + b.count, 0);
    expect(dayTotal + body.missing_published_at).toBe(6);
    expect(body.data.every((b: { group: string }) => /^\d{4}-\d{2}-\d{2}$/.test(b.group))).toBe(true);
  });

  it('omits the missing-date counter for group_by=source', async () => {
    const body = (await get('/mentions/stats?group_by=source')).json();
    expect(body.missing_published_at).toBeUndefined();
  });

  it('rejects unsupported or missing group_by with a 400', async () => {
    for (const url of [
      '/mentions/stats',
      '/mentions/stats?group_by=',
      '/mentions/stats?group_by=week',
      '/mentions/stats?group_by=author',
      '/mentions/stats?group_by=source&group_by_extra=1',
    ]) {
      const response = await get(url);
      expect(response.statusCode, `expected 400 for ${url}`).toBe(400);
      expect(response.json().error.code).toBe('INVALID_QUERY_PARAMETERS');
    }
  });

  it('returns empty groupings on an empty table rather than failing', async () => {
    await truncateMentions(ctx.db);
    expect((await get('/mentions/stats?group_by=source')).json().data).toEqual([]);
    const day = (await get('/mentions/stats?group_by=day')).json();
    expect(day.data).toEqual([]);
    expect(day.missing_published_at).toBe(0);
  });
});
