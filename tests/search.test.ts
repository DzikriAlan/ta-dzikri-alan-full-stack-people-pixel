import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, truncateMentions, type TestContext } from './helpers/test-app.js';
import { MAX_PAGE_SIZE } from '../src/features/mentions/validation/mention.validation.js';

let ctx: TestContext;

const dataset = [
  { source: 'Kompas', title: 'Ekonomi digital tumbuh', content: 'Sektor teknologi menguat', url: 'https://kompas.com/a1', published_at: '2024-03-15T10:00:00Z' },
  { source: 'Kompas', title: 'Pasar modal stabil', content: 'Indeks bergerak datar', url: 'https://kompas.com/a2', published_at: '2024-03-15T10:00:00Z' },
  { source: 'Kompas', title: 'Ekspor naik', content: 'Kinerja EKONOMI membaik', url: 'https://kompas.com/a3', published_at: '2024-03-14T09:00:00Z' },
  { source: 'Tempo', title: 'Investasi asing', content: 'Aliran modal masuk', url: 'https://tempo.co/b1', published_at: '2024-03-13T08:00:00Z' },
  { source: 'Tempo', title: 'Kebijakan baru', content: 'Aturan pajak berubah', url: 'https://tempo.co/b2', published_at: '2024-03-12T08:00:00Z' },
  { source: 'Detik', title: 'Tanpa tanggal', content: 'Berita tanpa tanggal terbit', url: 'https://detik.com/c1', published_at: null },
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

describe('GET /mentions', () => {
  it('returns every mention with pagination metadata by default', async () => {
    const body = (await get('/mentions')).json();
    expect(body.data).toHaveLength(6);
    expect(body.pagination).toMatchObject({
      page: 1, page_size: 20, total: 6, total_pages: 1, has_next: false, has_previous: false,
    });
  });

  it('searches title and content case-insensitively', async () => {
    const byTitle = (await get('/mentions?q=ekonomi')).json();
    expect(byTitle.pagination.total).toBe(2);

    const byContent = (await get('/mentions?q=INDEKS')).json();
    expect(byContent.pagination.total).toBe(1);
    expect(byContent.data[0].title).toBe('Pasar modal stabil');
  });

  it('treats LIKE wildcards in q as literal characters', async () => {
    const body = (await get('/mentions?q=%25')).json();
    expect(body.pagination.total).toBe(0);
  });

  it('filters by normalized source, accepting any spelling of it', async () => {
    for (const value of ['Kompas', 'kompas', 'KOMPAS.com']) {
      const body = (await get(`/mentions?source=${encodeURIComponent(value)}`)).json();
      expect(body.pagination.total).toBe(3);
      expect(body.data.every((m: { source: string }) => m.source === 'kompas')).toBe(true);
    }
  });

  it('applies from and to as an inclusive day range', async () => {
    const from = (await get('/mentions?from=2024-03-14')).json();
    expect(from.pagination.total).toBe(3);

    const to = (await get('/mentions?to=2024-03-13')).json();
    expect(to.pagination.total).toBe(2);

    const range = (await get('/mentions?from=2024-03-15&to=2024-03-15')).json();
    expect(range.pagination.total).toBe(2);
  });

  it('excludes undated mentions from date-filtered results', async () => {
    const filtered = (await get('/mentions?from=2024-01-01')).json();
    expect(filtered.data.some((m: { published_at: string | null }) => m.published_at === null)).toBe(false);
    expect(filtered.pagination.total).toBe(5);
  });

  it('combines filters', async () => {
    const body = (await get('/mentions?q=ekonomi&source=kompas&from=2024-03-15')).json();
    expect(body.pagination.total).toBe(1);
    expect(body.data[0].title).toBe('Ekonomi digital tumbuh');
  });

  it('orders by published_at DESC with undated mentions last', async () => {
    const body = (await get('/mentions')).json();
    const dates = body.data.map((m: { published_at: string | null }) => m.published_at);
    expect(dates[dates.length - 1]).toBeNull();

    const dated = dates.filter((d: string | null) => d !== null) as string[];
    expect([...dated].sort().reverse()).toEqual(dated);
  });

  it('breaks published_at ties by id DESC, so ordering is total', async () => {
    const body = (await get('/mentions?from=2024-03-15&to=2024-03-15')).json();
    const ids = body.data.map((m: { id: number }) => m.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  it('paginates without overlapping or dropping rows', async () => {
    const seen: number[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const body = (await get(`/mentions?page=${page}&page_size=2`)).json();
      expect(body.data).toHaveLength(2);
      expect(body.pagination).toMatchObject({ page, page_size: 2, total: 6, total_pages: 3 });
      seen.push(...body.data.map((m: { id: number }) => m.id));
    }
    expect(new Set(seen).size).toBe(6);

    const last = (await get('/mentions?page=3&page_size=2')).json();
    expect(last.pagination.has_next).toBe(false);
    expect(last.pagination.has_previous).toBe(true);
  });

  it('accepts page_size exactly at the documented maximum', async () => {
    const response = await get(`/mentions?page_size=${MAX_PAGE_SIZE}`);
    expect(response.statusCode).toBe(200);
    expect(response.json().pagination.page_size).toBe(MAX_PAGE_SIZE);
  });

  it('returns an empty page rather than an error past the last page', async () => {
    const body = (await get('/mentions?page=99&page_size=2')).json();
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(6);
  });

  it('rejects invalid query parameters with a useful 400', async () => {
    const cases = [
      '/mentions?page=0',
      '/mentions?page=-1',
      '/mentions?page=abc',
      '/mentions?page_size=0',
      `/mentions?page_size=${MAX_PAGE_SIZE + 1}`,
      '/mentions?from=not-a-date',
      '/mentions?to=32/13/2024',
      '/mentions?from=2024-03-15&to=2024-03-01',
      '/mentions?q=',
      '/mentions?source=',
      '/mentions?unknown_param=1',
    ];
    for (const url of cases) {
      const response = await get(url);
      expect(response.statusCode, `expected 400 for ${url}`).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_QUERY_PARAMETERS');
      expect(Array.isArray(body.error.details)).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(/SELECT|ILIKE|postgres|password/i);
    }
  });
});
