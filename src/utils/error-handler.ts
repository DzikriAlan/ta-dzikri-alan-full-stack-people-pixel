import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ApiError, type ErrorResponseBody } from './errors.js';

interface ZodIssueDetail {
  path: string;
  message: string;
}

export function formatZodIssues(error: ZodError): ZodIssueDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

function body(code: string, message: string, details?: unknown): ErrorResponseBody {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}

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

    switch (error.code) {
      case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
        reply
          .status(415)
          .send(body('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json'));
        return;
      case 'FST_ERR_CTP_INVALID_JSON_BODY':
        reply.status(400).send(body('INVALID_JSON', 'Request body is not valid JSON'));
        return;
      case 'FST_ERR_CTP_EMPTY_JSON_BODY':
        reply.status(400).send(body('EMPTY_BODY', 'Request body must not be empty'));
        return;
      case 'FST_ERR_CTP_BODY_TOO_LARGE':
        reply
          .status(413)
          .send(body('PAYLOAD_TOO_LARGE', 'Request body exceeds the maximum accepted size'));
        return;
      default:
        break;
    }

    request.log.error({ err: error }, 'Unhandled error while processing request');
    reply.status(500).send(body('INTERNAL_SERVER_ERROR', 'An unexpected error occurred'));
  });
}
