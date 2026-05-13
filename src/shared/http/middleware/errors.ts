import type { Context, Next } from "hono";
import { ZodError } from "zod";
import { AppError } from "@/shared/errors/app-error.js";
import { logger } from "@/config/logger.js";
import { fail } from "@/shared/http/response.js";

/**
 * 글로벌 에러 핸들러.
 * - AppError    → status + code + message envelope 로 변환
 * - ZodError    → 422 unprocessable + field details
 * - 그 외       → 500 internal + 로그 (운영에서는 message 노출 X)
 */
export async function errorsMiddleware(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    if (err instanceof AppError) {
      return fail(c, err.status, err.code, err.message, err.details);
    }
    if (err instanceof ZodError) {
      return fail(c, 422, "validation_failed", "입력값이 올바르지 않습니다.", err.flatten());
    }
    const requestId = c.get("requestId") ?? undefined;
    logger.error({ err, requestId, path: c.req.path }, "unhandled error");
    return fail(c, 500, "internal_error", "서버 오류가 발생했습니다.");
  }
}
