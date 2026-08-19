const INT32_MAX = 2_147_483_647;

// Indonesian and English shorthand used in social engagement counters.
const SUFFIX_MULTIPLIERS: Readonly<Record<string, number>> = {
  k: 1_000,
  rb: 1_000,
  ribu: 1_000,
  jt: 1_000_000,
  juta: 1_000_000,
};

const GROUPED_COMMA = /^\d{1,3}(,\d{3})+$/;
const GROUPED_DOT = /^\d{1,3}(\.\d{3})+$/;
const GROUPED_SPACE = /^\d{1,3}( \d{3})+$/;

// "1.2K", "1,2 rb", "3jt" — one optional decimal place before the multiplier.
const SUFFIXED = /^(\d+)(?:[.,](\d+))?\s*(k|rb|ribu|jt|juta)$/i;

function clamp(value: number): number | null {
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value <= INT32_MAX ? value : null;
}

export function normalizeCount(input: unknown): number | null {
  if (typeof input === 'number') {
    return Number.isInteger(input) ? clamp(input) : null;
  }
  if (typeof input !== 'string') return null;

  const value = input.trim();
  if (value.length === 0) return null;

  const suffixed = SUFFIXED.exec(value);
  if (suffixed) {
    const multiplier = SUFFIX_MULTIPLIERS[suffixed[3]!.toLowerCase()]!;
    const fraction = suffixed[2] ?? '';
    // Scale the decimal digits by the multiplier rather than using floating point,
    // so "1,25 jt" stays exactly 1_250_000.
    const scaledFraction =
      fraction.length === 0
        ? 0
        : Math.round((Number(fraction) / 10 ** fraction.length) * multiplier);
    return clamp(Number(suffixed[1]) * multiplier + scaledFraction);
  }

  // A bare run of digits, or digits grouped by one consistent thousands separator.
  // Only one grouping style may appear, so "1.240,5" (a decimal) is rejected rather
  // than silently truncated.
  if (
    !/^\d+$/.test(value) &&
    !GROUPED_COMMA.test(value) &&
    !GROUPED_DOT.test(value) &&
    !GROUPED_SPACE.test(value)
  ) {
    return null;
  }

  return clamp(Number.parseInt(value.replace(/[,. ]/g, ''), 10));
}
