import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { registerErrorHandler } from './utils/error-handler.js';
import { mentionRoutes } from './features/mentions/index.js';

export interface AppDependencies {
  config: Config;
  db: Database;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export async function buildApp({ config, db }: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    bodyLimit: 16 * 1024 * 1024,
  });

  app.removeContentTypeParser(['text/plain']);

  app.decorate('db', db);
  registerErrorHandler(app);

  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { status: 'ok' };
  });

  await app.register(mentionRoutes);

  return app;
}
