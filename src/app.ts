import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { registerErrorHandler } from './utils/error-handler.js';

export interface AppDependencies {
  config: Config;
  db: Database;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

/**
 * Builds the Fastify instance without starting it, so tests can drive the real
 * app through `app.inject()` against a real PostgreSQL database.
 */
export async function buildApp({ config, db }: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    // seed_mentions.json is posted as a single array; the default 1 MiB body
    // limit is raised to comfortably hold a bulk batch.
    bodyLimit: 16 * 1024 * 1024,
  });

  app.decorate('db', db);
  registerErrorHandler(app);

  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { status: 'ok' };
  });

  // Feature routes are registered here once the schema is in place.

  return app;
}
