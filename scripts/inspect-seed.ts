import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeMention } from '../src/features/mentions/normalization/mention-normalizer.js';
import { parsePublishedAt } from '../src/features/mentions/normalization/date.js';
import { looksLikeHtml } from '../src/features/mentions/normalization/text.js';

const seedPath = path.resolve(process.argv[2] ?? 'seed_mentions.json');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function report(title: string, entries: [string, number][], limit = 40): void {
  console.log(`\n== ${title} ==`);
  if (entries.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const [key, count] of entries.slice(0, limit)) {
    console.log(`  ${String(count).padStart(5)}  ${key}`);
  }
  if (entries.length > limit) console.log(`  ... and ${entries.length - limit} more`);
}

async function main(): Promise<void> {
  const raw = await readFile(seedPath, 'utf8').catch(() => {
    throw new Error(`Could not read ${seedPath}`);
  });
  const parsed: unknown = JSON.parse(raw);
  const records: unknown[] = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.mentions)
      ? parsed.mentions
      : [];

  console.log(`Records: ${records.length}`);

  const keyCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const sourceSpellings = new Map<string, number>();
  const unparsableDates = new Map<string, number>();
  const dateFieldsSeen = new Map<string, number>();
  let htmlBodies = 0;
  let numericStrings = 0;
  let missingDates = 0;

  const DATE_KEYS = ['published_at', 'publishedAt', 'published_date', 'date', 'created_at'];
  const SOURCE_KEYS = ['source', 'source_name', 'sourceName', 'publisher'];

  for (const record of records) {
    if (!isRecord(record)) {
      bump(typeCounts, `non-object: ${Array.isArray(record) ? 'array' : typeof record}`);
      continue;
    }
    for (const [key, value] of Object.entries(record)) {
      bump(keyCounts, key);
      bump(typeCounts, `${key}: ${value === null ? 'null' : typeof value}`);
      if (typeof value === 'string' && /^\s*\d[\d,]*\s*$/.test(value)) numericStrings += 1;
      if (typeof value === 'string' && looksLikeHtml(value)) htmlBodies += 1;
      if (SOURCE_KEYS.includes(key) && typeof value === 'string') bump(sourceSpellings, value);
      if (DATE_KEYS.includes(key)) {
        bump(dateFieldsSeen, key);
        if (value === null || value === '') missingDates += 1;
        else if (parsePublishedAt(value) === null) bump(unparsableDates, JSON.stringify(value));
      }
    }
  }

  report('Field frequency', [...keyCounts.entries()].sort((a, b) => b[1] - a[1]));
  report('Value types', [...typeCounts.entries()].sort((a, b) => b[1] - a[1]));
  report('Date fields present', [...dateFieldsSeen.entries()].sort((a, b) => b[1] - a[1]));
  report(
    'DATE VALUES THE PARSER REJECTS (each one needs a rule or a documented null)',
    [...unparsableDates.entries()].sort((a, b) => b[1] - a[1]),
  );

  const folded = new Map<string, Set<string>>();
  for (const spelling of sourceSpellings.keys()) {
    const result = normalizeMention({ source: spelling, title: 'x' });
    if (!result.ok) continue;
    const key = result.mention.source;
    const set = folded.get(key) ?? new Set<string>();
    set.add(spelling);
    folded.set(key, set);
  }
  console.log('\n== Source folding (verify none of these merges are wrong) ==');
  for (const [key, spellings] of [...folded.entries()].sort()) {
    console.log(`  ${key}  <-  ${[...spellings].join(' | ')}`);
  }

  const fingerprints = new Map<string, number>();
  let rejected = 0;
  const strategies = new Map<string, number>();
  for (const record of records) {
    const result = normalizeMention(record);
    if (!result.ok) {
      rejected += 1;
      continue;
    }
    bump(strategies, result.mention.fingerprintStrategy);
    bump(fingerprints, result.mention.fingerprint.toString('base64'));
  }
  const collapsed = [...fingerprints.values()].filter((count) => count > 1);

  console.log('\n== Summary ==');
  console.log(`  records                 : ${records.length}`);
  console.log(`  rejected by normalizer  : ${rejected}`);
  console.log(`  distinct fingerprints   : ${fingerprints.size}`);
  console.log(`  fingerprint groups >1   : ${collapsed.length}`);
  console.log(`  rows collapsed as dupes : ${collapsed.reduce((sum, n) => sum + n - 1, 0)}`);
  console.log(`  fingerprint strategies  : ${JSON.stringify(Object.fromEntries(strategies))}`);
  console.log(`  missing/empty dates     : ${missingDates}`);
  console.log(`  string values with HTML : ${htmlBodies}`);
  console.log(`  numeric-looking strings : ${numericStrings}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
