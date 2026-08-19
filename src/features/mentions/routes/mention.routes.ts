import type { FastifyInstance } from 'fastify';
import {
  loadMentionStatsController,
  loadMentionsController,
  saveMentionsBulkController,
} from '../controllers/mention.controller.js';

export async function mentionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/internal/mentions/bulk', saveMentionsBulkController);
  app.get('/mentions/stats', loadMentionStatsController);
  app.get('/mentions', loadMentionsController);
}
