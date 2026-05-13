import { AppError } from "../errors/app-error.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * Route handler 안에서 path param id 검증.
 * UUID 가 아니면 = 존재하지 않는 리소스 = 404 (postgres uuid cast 500 회피).
 *
 * @param notFoundCode 도메인별 not-found 코드 (예: "post_not_found", "contest_not_found")
 */
export function requireUuid(id: string | undefined, notFoundCode: string): string {
  if (!id || !UUID_RE.test(id)) {
    throw AppError.notFound("리소스를 찾을 수 없습니다.", notFoundCode);
  }
  return id;
}
