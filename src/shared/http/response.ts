import type { Context } from "hono";

/**
 * 표준 응답 envelope.
 *   success: { data, meta? }
 *   error:   { error: { code, message, details? } }
 *
 * frontend client 는 항상 같은 shape 으로 받아 처리한다.
 */
export type ApiSuccess<T> = { data: T; meta?: Record<string, unknown> };
export type ApiError = { error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function ok<T>(c: Context, data: T, meta?: Record<string, unknown>, status: 200 | 201 = 200) {
  const payload: ApiSuccess<T> = meta ? { data, meta } : { data };
  return c.json(payload, status);
}

export function created<T>(c: Context, data: T, meta?: Record<string, unknown>) {
  return ok(c, data, meta, 201);
}

export function fail(
  c: Context,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  // biome-ignore lint/suspicious/noExplicitAny: hono status type
  return c.json({ error: { code, message, details } } satisfies ApiError, status as any);
}
