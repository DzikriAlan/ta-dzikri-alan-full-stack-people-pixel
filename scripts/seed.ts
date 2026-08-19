import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/client.js';
import { storeMentions } from '../src/features/mentions/services/mention.service.js';

const seedPath = path.resolve(process.argv[2] ?? 'seed_mentions.json');

async function main(): Promise<void> {
  let contents: string;
  try {
    contents = await readFile(seedPath, 'utf8');
  } catch {
    throw new Error(
      `Could not read seed file at ${seedPath}. ` +
        'Place seed_mentions.json in the project root, or pass a path: npm run seed -- ./path/to/file.json',
    );
  }

  const parsed: unknown = JSON.parse(contents);
  const records = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { mentions?: unknown }).mentions)
      ? ((parsed as { mentions: unknown[] }).mentions)
      : null;

  if (records === null) {
    throw new Error('Seed file must contain a JSON array, or an object with a "mentions" array.');
  }

  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  try {
    const report = await storeMentions(pool, records);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Seeding failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
