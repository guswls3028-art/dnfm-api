/**
 * 도메인/서비스 레이어에서 throw 하는 표준 에러.
 * HTTP 레이어가 받아 envelope 응답으로 변환한다 ([[middleware/errors]]).
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(opts: { code: string; status: number; message: string; details?: unknown }) {
    super(opts.message);
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
    this.name = "AppError";
  }

  static badRequest(message: string, code = "bad_request", details?: unknown): AppError {
    return new AppError({ code, status: 400, message, details });
  }
  static unauthorized(message = "Unauthorized", code = "unauthorized"): AppError {
    return new AppError({ code, status: 401, message });
  }
  static forbidden(message = "Forbidden", code = "forbidden"): AppError {
    return new AppError({ code, status: 403, message });
  }
  static notFound(message = "Not found", code = "not_found"): AppError {
    return new AppError({ code, status: 404, message });
  }
  static conflict(message: string, code = "conflict", details?: unknown): AppError {
    return new AppError({ code, status: 409, message, details });
  }
  static unprocessable(message: string, code = "unprocessable", details?: unknown): AppError {
    return new AppError({ code, status: 422, message, details });
  }
  static tooManyRequests(message = "Too many requests", code = "too_many_requests"): AppError {
    return new AppError({ code, status: 429, message });
  }
  static internal(message = "Internal server error", code = "internal_error"): AppError {
    return new AppError({ code, status: 500, message });
  }
}
