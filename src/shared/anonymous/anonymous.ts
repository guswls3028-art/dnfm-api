import { createHash } from "node:crypto";

/**
 * 비회원 글/댓글 표시용 IP 끝자리 marker.
 *
 *   "121.182.55.7"  → "121.182"
 *   "::ffff:121.182.55.7" → "121.182"
 *   "2001:db8::1"   → "2001"
 *   IP 없으면 "ㅇㅇ" (default 시그널)
 *
 * 디시 스타일 — 끝자리는 보안상 노출 X (전체 IP 추적 차단). 운영자는 [[anonymous_audit_hash]] 로 식별.
 */
export function buildAnonymousMarker(ipAddress?: string | null): string {
  if (!ipAddress) return "ㅇㅇ";
  let ip = ipAddress.trim();
  // IPv4-mapped IPv6 prefix 제거
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  // IPv4: 앞 2 옥텟
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}`;
  }
  // IPv6: 앞 group
  if (ip.includes(":")) {
    const first = ip.split(":")[0];
    return first || "ㅇㅇ";
  }
  return "ㅇㅇ";
}

/**
 * 운영용 audit hash — 전체 IP + UA 결합 SHA-256.
 * 어드민 view 에서만 노출. IP 밴 검증 시에도 IP 평문 비교 X — hash 비교.
 *
 * 단, IP 밴 자체는 정확도가 필요하므로 IP 자체를 별도 ip_bans 테이블에 저장.
 * 이 hash 는 fingerprint audit 용 (같은 IP + UA 가 여러 닉으로 작성 추적).
 */
export function buildAnonymousAuditHash(
  ipAddress: string | null | undefined,
  userAgent: string | null | undefined,
): string {
  const h = createHash("sha256");
  h.update(ipAddress || "");
  h.update("|");
  h.update(userAgent || "");
  return h.digest("hex");
}

/**
 * guest 닉네임 정규화.
 * 빈 문자열 / 공백 → "ㅇㅇ" (디시 default).
 * 그 외 trim + max 32.
 */
export function sanitizeGuestNickname(raw: string | undefined | null): string {
  if (!raw) return "ㅇㅇ";
  const trimmed = raw.trim();
  if (!trimmed) return "ㅇㅇ";
  return trimmed.slice(0, 32);
}
