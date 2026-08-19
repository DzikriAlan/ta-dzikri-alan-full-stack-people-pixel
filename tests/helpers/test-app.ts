import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createPool, type Database } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrator.js';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. See README "Running the tests" -- it must point at a ' +
        'throwaway database, because the suite truncates the mentions table.',
    );
  }
  return url;
}

export interface TestContext {
  app: FastifyInstance;
  db: Database;
  close(): Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const connectionString = testDatabaseUrl();
  const db = createPool(connectionString);
  await runMigrations(db, migrationsDir, { readdir, readFile });

  const app = await buildApp({
    config: {
      DATABASE_URL: connectionString,
      PORT: 0,
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
    },
    db,
  });
  await app.ready();

  return {
    app,
    db,
    async close() {
      await app.close();
      await db.end();
    },
  };
}

export async function truncateMentions(db: Database): Promise<void> {
  await db.query('TRUNCATE TABLE mentions RESTART IDENTITY');
}

export async function countRows(db: Database): Promise<number> {
  const { rows } = await db.query<{ count: number }>('SELECT count(*)::bigint AS count FROM mentions');
  return rows[0]?.count ?? 0;
}
