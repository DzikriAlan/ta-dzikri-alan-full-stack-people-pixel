import type { FastifyReply, FastifyRequest } from 'fastify';
import { formatZodIssues } from '../../../utils/error-handler.js';
import { ApiError } from '../../../utils/errors.js';
import { fetchMentionStats, fetchMentions, storeMentions } from '../services/mention.service.js';
import type { IngestionReport, MentionListResponse, MentionStatsResponse } from '../types/mention.js';
import {
  getMentionStatsSchema,
  getMentionsSchema,
  postMentionsBulkSchema,
} from '../validation/mention.validation.js';

export async function saveMentionsBulkController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<IngestionReport> {
  const parsed = postMentionsBulkSchema.safeParse(request.body);
  if (!parsed.success) {
    throw ApiError.badRequest(
      'VALIDATION_ERROR',
      'Request body must be an array of mentions, or an object with a "mentions" array',
      formatZodIssues(parsed.error),
    );
  }

  reply.status(200);
  return storeMentions(request.server.db, parsed.data);
}

export async function loadMentionsController(
  request: FastifyRequest,
): Promise<MentionListResponse> {
  const parsed = getMentionsSchema.safeParse(request.query);
  if (!parsed.success) {
    throw ApiError.badRequest(
      'INVALID_QUERY_PARAMETERS',
      'One or more query parameters are invalid',
      formatZodIssues(parsed.error),
    );
  }

  return fetchMentions(request.server.db, parsed.data);
}

export async function loadMentionStatsController(
  request: FastifyRequest,
): Promise<MentionStatsResponse> {
  const parsed = getMentionStatsSchema.safeParse(request.query);
  if (!parsed.success) {
    throw ApiError.badRequest(
      'INVALID_QUERY_PARAMETERS',
      'Unsupported or missing group_by value',
      formatZodIssues(parsed.error),
    );
  }

  return fetchMentionStats(request.server.db, parsed.data.group_by);
}
