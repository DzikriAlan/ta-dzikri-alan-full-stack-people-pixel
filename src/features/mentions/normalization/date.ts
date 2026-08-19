import { collapseWhitespace } from './text.js';

export const AMBIGUOUS_SLASH_DATE_ORDER: 'day-first' | 'month-first' = 'day-first';

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

// English and Indonesian month names (including the pre-1972 Indonesian
// spellings "Peb"/"Nop" that still appear in archived article metadata).
const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1, january: 1, januari: 1,
  feb: 2, february: 2, februari: 2, peb: 2, pebruari: 2,
  mar: 3, march: 3, maret: 3,
  apr: 4, april: 4,
  may: 5, mei: 5,
  jun: 6, june: 6, juni: 6,
  jul: 7, july: 7, juli: 7,
  aug: 8, august: 8, agu: 8, ags: 8, agt: 8, agustus: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, okt: 10, oktober: 10,
  nov: 11, november: 11, nop: 11, nopember: 11,
  dec: 12, december: 12, des: 12, desember: 12,
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

// Indonesian outlets routinely stamp a local timezone label instead of a numeric
// offset ("15 Maret 2024 08:30 WIB"). Dropping the label would silently store the
// local wall-clock time as UTC and shift the article up to nine hours.
const LOCAL_TIMEZONE_OFFSETS: Readonly<Record<string, number>> = {
  wib: 7 * 60,
  wita: 8 * 60,
  wit: 9 * 60,
};

const LOCAL_TIMEZONE_SUFFIX = /\s+(wib|wita|wit)$/i;

export function parsePublishedAt(input: unknown): Date | null {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) || !inRange(input) ? null : input;
  }
  if (typeof input === 'number') return parseEpoch(input);
  if (typeof input !== 'string') return null;

  const collapsed = collapseWhitespace(input);
  if (collapsed.length === 0) return null;

  const tzMatch = LOCAL_TIMEZONE_SUFFIX.exec(collapsed);
  const tzOffsetMinutes = tzMatch ? (LOCAL_TIMEZONE_OFFSETS[tzMatch[1]!.toLowerCase()] ?? null) : null;
  const value = tzMatch ? collapsed.slice(0, tzMatch.index) : collapsed;
  if (value.length === 0) return null;

  // Shifts a wall-clock reading into UTC when the string carried a local label.
  const applyTz = (date: Date | null): Date | null => {
    if (date === null || tzOffsetMinutes === null) return date;
    const shifted = new Date(date.getTime() - tzOffsetMinutes * 60_000);
    return inRange(shifted) ? shifted : null;
  };

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
    if (!offset) return applyTz(base);
    if (offset === 'Z') return base;

    const sign = offset.startsWith('-') ? -1 : 1;
    const digits = offset.slice(1).replace(':', '');
    const offsetMinutes =
      sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
    const shifted = new Date(base.getTime() - offsetMinutes * 60_000);
    return inRange(shifted) ? shifted : null;
  }

  const ymdSlash = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(value);
  if (ymdSlash) {
    return applyTz(utc(Number(ymdSlash[1]), Number(ymdSlash[2]), Number(ymdSlash[3])));
  }

  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = Number(slash[3]);
    if (first > 12 && second <= 12) return applyTz(utc(year, second, first));
    if (second > 12 && first <= 12) return applyTz(utc(year, first, second));
    return applyTz(
      AMBIGUOUS_SLASH_DATE_ORDER === 'day-first'
        ? utc(year, second, first)
        : utc(year, first, second),
    );
  }

  // Optional trailing wall-clock time, e.g. "15 Maret 2024 08:30" or "... 08.30.15".
  const TIME_TAIL = String.raw`(?:[\s,]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?`;

  const dayMonthName = new RegExp(
    String.raw`^(\d{1,2})\s+([a-zA-Z]+),?\s+(\d{4})` + TIME_TAIL + '$',
  ).exec(value);
  if (dayMonthName) {
    const month = MONTH_NAMES[(dayMonthName[2] ?? '').toLowerCase()];
    if (month === undefined) return null;
    return applyTz(
      utc(
        Number(dayMonthName[3]), month, Number(dayMonthName[1]),
        Number(dayMonthName[4] ?? 0), Number(dayMonthName[5] ?? 0), Number(dayMonthName[6] ?? 0),
      ),
    );
  }

  const monthNameDay = new RegExp(
    String.raw`^([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{4})` + TIME_TAIL + '$',
  ).exec(value);
  if (monthNameDay) {
    const month = MONTH_NAMES[(monthNameDay[1] ?? '').toLowerCase()];
    if (month === undefined) return null;
    return applyTz(
      utc(
        Number(monthNameDay[3]), month, Number(monthNameDay[2]),
        Number(monthNameDay[4] ?? 0), Number(monthNameDay[5] ?? 0), Number(monthNameDay[6] ?? 0),
      ),
    );
  }

  if (/^[a-zA-Z]{3},\s/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime()) && inRange(parsed)) return parsed;
  }

  return null;
}
