/**
 * Application-level errors that map to a deliberate HTTP status and a stable,
 * machine-readable `code`. Anything that is not an ApiError is treated as an
 * unexpected fault and reported as a generic 500 without internal detail.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(code: string, message: string, details?: unknown): ApiError {
    return new ApiError(400, code, message, details);
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static payloadTooLarge(message: string): ApiError {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', message);
  }
}

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
