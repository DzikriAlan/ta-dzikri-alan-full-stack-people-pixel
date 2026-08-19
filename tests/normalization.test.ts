import { describe, expect, it } from 'vitest';
import { normalizeText, stripHtml, decodeHtmlEntities } from '../src/features/mentions/normalization/text.js';
import { normalizeSource } from '../src/features/mentions/normalization/source.js';
import { normalizeUrl } from '../src/features/mentions/normalization/url.js';
import {
  parsePublishedAt,
  AMBIGUOUS_SLASH_DATE_ORDER,
} from '../src/features/mentions/normalization/date.js';
import { normalizeCount } from '../src/features/mentions/normalization/number.js';
import { normalizeMention } from '../src/features/mentions/normalization/mention-normalizer.js';

describe('HTML normalization', () => {
  it('flattens markup to plain text with word boundaries preserved', () => {
    expect(stripHtml('<p>First</p><p>Second</p>')).toBe('First Second');
  });

  it('drops script and style contents rather than inlining them', () => {
    expect(stripHtml('<div>Hi<script>alert("x")</script></div>')).toBe('Hi');
    expect(stripHtml('<style>.a{color:red}</style>Body')).toBe('Body');
  });

  it('decodes named and numeric entities', () => {
    expect(decodeHtmlEntities('Tom &amp; Jerry &#39;s &#x2014; end')).toBe("Tom & Jerry 's — end");
  });

  it('collapses whitespace and maps empty markup to null', () => {
    expect(normalizeText('  a\n\n  b  ')).toBe('a b');
    expect(normalizeText('<p>   </p>')).toBeNull();
    expect(normalizeText('')).toBeNull();
    expect(normalizeText(null)).toBeNull();
  });

  it('leaves meaningful casing and punctuation intact', () => {
    expect(normalizeText('Rp1.000.000 "deal" — SIGNED!')).toBe('Rp1.000.000 "deal" — SIGNED!');
  });
});

describe('source normalization', () => {
  it('folds casing, spacing and domain forms onto one key', () => {
    const expected = 'thejakartapost';
    for (const variant of [
      'The Jakarta Post',
      'the jakarta post',
      '  THE   JAKARTA POST  ',
      'thejakartapost.com',
      'www.thejakartapost.com',
      'https://www.thejakartapost.com/news',
    ]) {
      expect(normalizeSource(variant)).toBe(expected);
    }
  });

  it('keeps genuinely different outlets apart', () => {
    expect(normalizeSource('Kompas')).not.toBe(normalizeSource('Tempo'));
    expect(normalizeSource('Detik')).toBe('detik');
  });
});

describe('URL canonicalization', () => {
  it('removes tracking parameters, fragments and trailing slashes', () => {
    const a = normalizeUrl('https://www.example.com/story/?utm_source=x&id=7#top');
    const b = normalizeUrl('https://example.com/story?id=7');
    expect(a?.url).toBe(b?.url);
  });

  it('sorts remaining query parameters so order does not matter', () => {
    expect(normalizeUrl('https://e.com/a?b=2&a=1')?.url).toBe(
      normalizeUrl('https://e.com/a?a=1&b=2')?.url,
    );
  });

  it('preserves path case, which is server-significant', () => {
    expect(normalizeUrl('https://e.com/Story')?.url).not.toBe(normalizeUrl('https://e.com/story')?.url);
  });

  it('rejects non-http values instead of guessing', () => {
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('ftp://e.com/a')).toBeNull();
    expect(normalizeUrl('/relative/path')).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
  });
});

describe('date parsing', () => {
  const iso = (value: unknown) => parsePublishedAt(value)?.toISOString() ?? null;

  it('parses ISO 8601 with and without offsets', () => {
    expect(iso('2024-03-15T08:30:00Z')).toBe('2024-03-15T08:30:00.000Z');
    expect(iso('2024-03-15T15:30:00+07:00')).toBe('2024-03-15T08:30:00.000Z');
    expect(iso('2024-03-15T08:30:00.250Z')).toBe('2024-03-15T08:30:00.250Z');
  });

  it('treats naive timestamps and bare dates as UTC', () => {
    expect(iso('2024-03-15 08:30:00')).toBe('2024-03-15T08:30:00.000Z');
    expect(iso('2024-03-15')).toBe('2024-03-15T00:00:00.000Z');
  });

  it('parses slash, month-name and RFC 2822 forms', () => {
    expect(iso('2024/03/15')).toBe('2024-03-15T00:00:00.000Z');
    expect(iso('15 March 2024')).toBe('2024-03-15T00:00:00.000Z');
    expect(iso('March 15, 2024')).toBe('2024-03-15T00:00:00.000Z');
    expect(iso('Fri, 15 Mar 2024 08:30:00 GMT')).toBe('2024-03-15T08:30:00.000Z');
  });

  it('resolves slash-date order from the value when it is unambiguous', () => {
    expect(iso('25/03/2024')).toBe('2024-03-25T00:00:00.000Z');
    expect(iso('03/25/2024')).toBe('2024-03-25T00:00:00.000Z');
  });

  it('applies the documented default only when the value is truly ambiguous', () => {
    const expected =
      AMBIGUOUS_SLASH_DATE_ORDER === 'day-first'
        ? '2024-03-04T00:00:00.000Z' // 4 March
        : '2024-04-03T00:00:00.000Z'; // 3 April
    expect(iso('04/03/2024')).toBe(expected);
  });

  it('parses epoch seconds and milliseconds', () => {
    expect(iso(1710491400)).toBe('2024-03-15T08:30:00.000Z');
    expect(iso('1710491400000')).toBe('2024-03-15T08:30:00.000Z');
  });

  it('returns null for missing or unparsable values instead of inventing a date', () => {
    for (const bad of [null, undefined, '', 'yesterday', 'N/A', '2024-02-31', '1799-01-01', {}]) {
      expect(parsePublishedAt(bad)).toBeNull();
    }
  });
});

describe('numeric strings', () => {
  it('converts values that are entirely numeric', () => {
    expect(normalizeCount('1234')).toBe(1234);
    expect(normalizeCount('1,234')).toBe(1234);
    expect(normalizeCount(88)).toBe(88);
    expect(normalizeCount('0')).toBe(0);
  });

  it('refuses to guess at anything else, and never coerces to zero', () => {
    for (const bad of ['1.2k', 'about 500', 'N/A', '', '12.5', '-5', null, undefined, {}]) {
      expect(normalizeCount(bad)).toBeNull();
    }
  });
});

describe('record-level normalization', () => {
  const base = { source: 'Kompas.com', title: 'Judul', url: 'https://kompas.com/a' };

  it('normalizes a messy record end to end', () => {
    const result = normalizeMention({
      source: '  KOMPAS.com ',
      title: 'Harga &amp; Pasar',
      content: '<p>Isi <b>berita</b></p><script>x()</script>',
      url: 'https://www.kompas.com/read/123/?utm_campaign=fb#share',
      published_at: '15/03/2024',
      views: '2,500',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mention.source).toBe('kompas');
    expect(result.mention.sourceRaw).toBe('KOMPAS.com');
    expect(result.mention.title).toBe('Harga & Pasar');
    expect(result.mention.content).toBe('Isi berita');
    expect(result.mention.url).toBe('https://kompas.com/read/123');
    expect(result.mention.publishedAt?.toISOString()).toBe('2024-03-15T00:00:00.000Z');
    expect(result.mention.engagement).toBe(2500);
  });

  it('records a missing date as null and keeps an unparsable one for diagnosis', () => {
    const missing = normalizeMention({ ...base, published_at: null });
    expect(missing.ok && missing.mention.publishedAt).toBeNull();
    expect(missing.ok && missing.mention.publishedAtRaw).toBeNull();

    const broken = normalizeMention({ ...base, published_at: 'sometime last week' });
    expect(broken.ok && broken.mention.publishedAt).toBeNull();
    expect(broken.ok && broken.mention.publishedAtRaw).toBe('sometime last week');
  });

  it('rejects records that cannot be identified rather than inventing fields', () => {
    expect(normalizeMention({ title: 'no source' }).ok).toBe(false);
    expect(normalizeMention({ source: '!!!', title: 'x' }).ok).toBe(false);
    expect(normalizeMention({ source: 'Kompas' }).ok).toBe(false);
    expect(normalizeMention('a string').ok).toBe(false);
    expect(normalizeMention(null).ok).toBe(false);
  });

  it('accepts field-name aliases and preserves unknown fields in raw', () => {
    const result = normalizeMention({
      sourceName: 'Tempo',
      headline: 'Judul',
      body: 'Isi',
      link: 'https://tempo.co/x',
      publishedAt: '2024-03-15',
      sentiment_score: 0.8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mention.source).toBe('tempo');
    expect(result.mention.title).toBe('Judul');
    expect(result.mention.raw).toMatchObject({ sentiment_score: 0.8 });
  });

  it('is deterministic: the same input always yields the same fingerprint', () => {
    const record = { ...base, content: 'Isi' };
    const a = normalizeMention(record);
    const b = normalizeMention(record);
    expect(a.ok && b.ok && a.mention.fingerprint.equals(b.mention.fingerprint)).toBe(true);
  });
});
