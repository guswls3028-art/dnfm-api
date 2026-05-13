import { z } from "zod";

/**
 * 사이트 식별자 — 모든 도메인 데이터는 정확히 하나의 사이트에 속한다.
 * cross-site 조회는 명시적 endpoint 만 허용.
 */
export const SITE_CODES = ["newb", "allow"] as const;
export type SiteCode = (typeof SITE_CODES)[number];

export const siteCodeSchema = z.enum(SITE_CODES);

/**
 * 사이트별 역할.
 *  - member         : 일반 회원 (글 작성, 댓글, 좋아요, 콘테스트 참가, 투표)
 *  - admin          : 사이트 운영자 (콘텐츠 모더레이션, 콘테스트 생성·심사, 공지)
 *  - super          : 플랫폼 슈퍼유저 (방장 본인). 모든 사이트의 admin 권한.
 *
 * 같은 user_id 가 site 별로 다른 role 을 가질 수 있다 (newb 의 admin 이
 * allow 에선 member 일 수 있음).
 */
export const SITE_ROLES = ["member", "admin", "super"] as const;
export type SiteRole = (typeof SITE_ROLES)[number];

export const siteRoleSchema = z.enum(SITE_ROLES);

export function isAdminOrAbove(role: SiteRole): boolean {
  return role === "admin" || role === "super";
}
