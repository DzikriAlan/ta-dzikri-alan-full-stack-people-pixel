import {
  ApiUnavailableError,
  buildQuery,
  getDayStats,
  getMentions,
  getSourceStats,
  type StatsBucket,
} from '@/lib/api';
import { BarChart, MentionsTable, StatBlock } from './components';

const PAGE_SIZE = 10;

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = one(params.q);
  const source = one(params.source);
  const from = one(params.from);
  const to = one(params.to);
  const page = Math.max(1, Number.parseInt(one(params.page) || '1', 10) || 1);

  let mentions, sourceStats, dayStats;
  try {
    [mentions, sourceStats, dayStats] = await Promise.all([
      getMentions(buildQuery({ q, source, from, to, page }, PAGE_SIZE)),
      getSourceStats(),
      getDayStats(),
    ]);
  } catch (error) {
    const message =
      error instanceof ApiUnavailableError ? error.message : 'Unexpected error loading data.';
    return (
      <main className="wrap">
        <header className="masthead">
          <h1>Media Monitoring</h1>
          <p>Mentions dashboard</p>
        </header>
        <div className="notice">
          <h2>Cannot load data</h2>
          <p style={{ margin: 0 }}>{message}</p>
          <p className="footnote">
            Start the backend (<code>npm run dev</code> in the project root) and reload.
          </p>
        </div>
      </main>
    );
  }

  const totalAllSources = sourceStats.data.reduce((sum, b) => sum + b.count, 0);
  const missingDates = dayStats.missing_published_at ?? 0;
  const recentDays: StatsBucket[] = dayStats.data.slice(-14);

  const link = (nextPage: number) => {
    const search = new URLSearchParams();
    if (q) search.set('q', q);
    if (source) search.set('source', source);
    if (from) search.set('from', from);
    if (to) search.set('to', to);
    search.set('page', String(nextPage));
    return `/?${search.toString()}`;
  };

  return (
    <main className="wrap">
      <header className="masthead">
        <h1>Media Monitoring</h1>
        <p>
          Read-only mentions dashboard · live data from GET /mentions and /mentions/stats
        </p>
      </header>

      <section className="stats">
        <StatBlock label="Total mentions" value={totalAllSources} tone="accent" />
        <StatBlock label="Matching filters" value={mentions.pagination.total} />
        <StatBlock label="Distinct sources" value={sourceStats.data.length} />
        <StatBlock
          label="No publication date"
          value={missingDates}
          tone={missingDates > 0 ? 'warn' : undefined}
        />
      </section>

      <form className="panel" method="GET" action="/">
        <h2>Filters</h2>
        <div className="controls">
          <div className="field">
            <label htmlFor="q">Keyword</label>
            <input id="q" name="q" defaultValue={q} placeholder="title or content" />
          </div>
          <div className="field">
            <label htmlFor="source">Source</label>
            <select id="source" name="source" defaultValue={source}>
              <option value="">All sources</option>
              {sourceStats.data.map((bucket) => (
                <option key={bucket.group} value={bucket.group}>
                  {bucket.label ?? bucket.group} ({bucket.count})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="from">From</label>
            <input id="from" name="from" type="date" defaultValue={from} />
          </div>
          <div className="field">
            <label htmlFor="to">To</label>
            <input id="to" name="to" type="date" defaultValue={to} />
          </div>
          <div className="field">
            <button className="btn" type="submit">
              Apply
            </button>
          </div>
          <div className="field">
            <a className="btn is-plain" href="/">
              Reset
            </a>
          </div>
        </div>
      </form>

      <section className="cols">
        <div className="panel">
          <h2>Mentions by source</h2>
          <BarChart buckets={sourceStats.data} />
        </div>
        <div className="panel">
          <h2>Mentions by day (UTC)</h2>
          <BarChart buckets={recentDays} alt />
          {missingDates > 0 && (
            <p className="footnote">
              {missingDates} mention{missingDates === 1 ? '' : 's'} have no publication date and are
              excluded from this chart rather than assigned to a day.
            </p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>
          Mentions — page {mentions.pagination.page} of {mentions.pagination.total_pages || 1}
        </h2>
        <MentionsTable mentions={mentions.data} />

        <div className="pager">
          <span className="meta">
            {mentions.pagination.total} result{mentions.pagination.total === 1 ? '' : 's'} · showing{' '}
            {mentions.data.length} per page
          </span>
          <span style={{ display: 'flex', gap: 10 }}>
            <a
              className="btn is-plain"
              href={link(page - 1)}
              aria-disabled={!mentions.pagination.has_previous}
            >
              ← Prev
            </a>
            <a className="btn" href={link(page + 1)} aria-disabled={!mentions.pagination.has_next}>
              Next →
            </a>
          </span>
        </div>
      </section>
    </main>
  );
}
