import path from 'node:path';
import type { Database } from './client.js';

interface FsLike {
  readdir(dir: string): Promise<string[]>;
  readFile(file: string, encoding: 'utf8'): Promise<string>;
}

/**
 * A deliberately small migration runner instead of a migration library: the SQL
 * files stay the single, reviewable source of truth for the schema, which is
 * what the assessment asks for. Each file runs once, inside a transaction, and
 * is recorded in `schema_migrations`.
 *
 * `pg_advisory_lock` makes concurrent runners (e.g. two test workers or a
 * restarting deployment) safe: the second one waits rather than applying the
 * same file twice.
 */
const MIGRATION_LOCK_ID = 8_123_451;

export async function runMigrations(
  db: Database,
  migrationsDir: string,
  fs: FsLike,
): Promise<string[]> {
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const client = await db.connect();
  const applied: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text        PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((row) => row.name));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    client.release();
  }

  return applied;
}
