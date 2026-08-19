export function normalizeCount(input: unknown): number | null {
  if (typeof input === 'number') {
    return Number.isInteger(input) && input >= 0 ? input : null;
  }
  if (typeof input !== 'string') return null;

  const value = input.trim();
  if (value.length === 0) return null;

  if (!/^\d+$/.test(value) && !/^\d{1,3}(,\d{3})+$/.test(value)) return null;

  const parsed = Number.parseInt(value.replace(/,/g, ''), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed <= 2_147_483_647 ? parsed : null;
}
