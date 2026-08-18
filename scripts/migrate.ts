import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrator.js';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  try {
    const applied = await runMigrations(pool, migrationsDir, { readdir, readFile });
    if (applied.length === 0) {
      console.log('No pending migrations. Database is up to date.');
    } else {
      for (const name of applied) console.log(`Applied migration: ${name}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
