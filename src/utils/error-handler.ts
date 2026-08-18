import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ApiError, type ErrorResponseBody } from './errors.js';

interface ZodIssueDetail {
  path: string;
  message: string;
}

function formatZodIssues(error: ZodError): ZodIssueDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

function body(code: string, message: string, details?: unknown): ErrorResponseBody {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}

/**
 * Single place that turns any thrown value into a consistent error envelope.
 * Consumers never see SQL, connection strings or stack traces: unknown errors
 * are logged server-side and answered with an opaque 500.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply
      .status(404)
      .send(body('NOT_FOUND', `Route ${request.method} ${request.url} not found`));
  });

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ApiError) {
      reply.status(error.statusCode).send(body(error.code, error.message, error.details));
      return;
    }

    if (error instanceof ZodError) {
      reply
        .status(400)
        .send(body('VALIDATION_ERROR', 'Request validation failed', formatZodIssues(error)));
      return;
    }

    // Fastify surfaces malformed JSON and body-limit violations as coded errors
    // before any handler runs, so they are translated here rather than in routes.
    if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      reply
        .status(415)
        .send(body('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json'));
      return;
    }

    if (error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || error.statusCode === 400) {
      reply.status(400).send(body('INVALID_JSON', 'Request body is not valid JSON'));
      return;
    }

    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error.statusCode === 413) {
      reply
        .status(413)
        .send(body('PAYLOAD_TOO_LARGE', 'Request body exceeds the maximum accepted size'));
      return;
    }

    request.log.error({ err: error }, 'Unhandled error while processing request');
    reply
      .status(500)
      .send(body('INTERNAL_SERVER_ERROR', 'An unexpected error occurred'));
  });
}
