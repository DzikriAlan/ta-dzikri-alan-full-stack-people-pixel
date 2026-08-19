import type { Mention, StatsBucket } from '@/lib/api';

export function StatBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'accent' | 'warn';
}) {
  const cls = tone === 'accent' ? 'stat is-accent' : tone === 'warn' ? 'stat is-warn' : 'stat';
  return (
    <div className={cls}>
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}

export function BarChart({ buckets, alt = false }: { buckets: StatsBucket[]; alt?: boolean }) {
  if (buckets.length === 0) return <div className="empty">No data</div>;
  const max = Math.max(...buckets.map((b) => b.count));

  return (
    <div className="bars">
      {buckets.map((bucket) => (
        <div className="bar-row" key={bucket.group}>
          <div className="bar-label" title={bucket.label ?? bucket.group}>
            {bucket.label ?? bucket.group}
          </div>
          <div className="bar-track">
            <div
              className={alt ? 'bar-fill is-alt' : 'bar-fill'}
              style={{ width: `${Math.round((bucket.count / max) * 100)}%` }}
            />
          </div>
          <div className="bar-count">{bucket.count}</div>
        </div>
      ))}
    </div>
  );
}

function formatDate(value: string | null): React.ReactNode {
  if (value === null) return <span className="nodate">No date</span>;
  return new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function snippet(text: string | null): string {
  if (!text) return '';
  return text.length > 110 ? `${text.slice(0, 110)}…` : text;
}

export function MentionsTable({ mentions }: { mentions: Mention[] }) {
  if (mentions.length === 0) {
    return <div className="empty">No mentions match these filters</div>;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th style={{ width: 130 }}>Source</th>
            <th>Mention</th>
            <th style={{ width: 170 }}>Published</th>
            <th style={{ width: 100 }}>Engagement</th>
          </tr>
        </thead>
        <tbody>
          {mentions.map((mention) => (
            <tr key={mention.id}>
              <td>
                <span className="src-tag">{mention.source}</span>
              </td>
              <td>
                <strong>
                  {mention.url ? (
                    <a href={mention.url} target="_blank" rel="noreferrer">
                      {mention.title ?? '(untitled)'}
                    </a>
                  ) : (
                    (mention.title ?? '(untitled)')
                  )}
                </strong>
                <div className="snippet">{snippet(mention.content)}</div>
              </td>
              <td>{formatDate(mention.published_at)}</td>
              <td>{mention.engagement ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
