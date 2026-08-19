import { collapseWhitespace } from './text.js';

export const AMBIGUOUS_SLASH_DATE_ORDER: 'day-first' | 'month-first' = 'day-first';

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export interface ParsedDate {
  date: Date;
}

function utc(year: number, month: number, day: number, h = 0, m = 0, s = 0, ms = 0): Date | null {
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (h > 23 || m > 59 || s > 60) return null;
  const date = new Date(Date.UTC(year, month - 1, day, h, m, s, ms));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

function inRange(date: Date): boolean {
  const year = date.getUTCFullYear();
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

function parseEpoch(value: number): Date | null {
  if (!Number.isFinite(value)) return null;
  const ms = Math.abs(value) >= 1e11 ? value : value * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) || !inRange(date) ? null : date;
}

export function parsePublishedAt(input: unknown): Date | null {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) || !inRange(input) ? null : input;
  }
  if (typeof input === 'number') return parseEpoch(input);
  if (typeof input !== 'string') return null;

  const value = collapseWhitespace(input);
  if (value.length === 0) return null;

  if (/^-?\d{9,14}$/.test(value)) return parseEpoch(Number(value));

  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,6}))?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      value,
    );
  if (iso) {
    const [, y, mo, d, h, mi, s, frac, offset] = iso;
    const base = utc(
      Number(y), Number(mo), Number(d),
      Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0),
      frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0,
    );
    if (base === null) return null;
    if (!offset || offset === 'Z') return base;

    const sign = offset.startsWith('-') ? -1 : 1;
    const digits = offset.slice(1).replace(':', '');
    const offsetMinutes =
      sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
    const shifted = new Date(base.getTime() - offsetMinutes * 60_000);
    return inRange(shifted) ? shifted : null;
  }

  const ymdSlash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
  if (ymdSlash) {
    return utc(Number(ymdSlash[1]), Number(ymdSlash[2]), Number(ymdSlash[3]));
  }

  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = Number(slash[3]);
    if (first > 12 && second <= 12) return utc(year, second, first);
    if (second > 12 && first <= 12) return utc(year, first, second);
    return AMBIGUOUS_SLASH_DATE_ORDER === 'day-first'
      ? utc(year, second, first)
      : utc(year, first, second);
  }

  const dayMonthName = /^(\d{1,2})\s+([a-zA-Z]+),?\s+(\d{4})$/.exec(value);
  if (dayMonthName) {
    const month = MONTH_NAMES[(dayMonthName[2] ?? '').toLowerCase()];
    if (month) return utc(Number(dayMonthName[3]), month, Number(dayMonthName[1]));
    return null;
  }

  const monthNameDay = /^([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(value);
  if (monthNameDay) {
    const month = MONTH_NAMES[(monthNameDay[1] ?? '').toLowerCase()];
    if (month) return utc(Number(monthNameDay[3]), month, Number(monthNameDay[2]));
    return null;
  }

  if (/^[a-zA-Z]{3},\s/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime()) && inRange(parsed)) return parsed;
  }

  return null;
}
