import type { Context, Next } from "hono";
import { siteCodeSchema, type SiteCode } from "@/shared/types/site.js";
import { AppError } from "@/shared/errors/app-error.js";

/**
 * 사이트 컨텍스트 미들웨어. 다음 우선순위로 결정:
 *   1. URL path 파라미터 (`/sites/:site/...`) — 가장 명시적
 *   2. `X-Site-Code` 헤더 — frontend client 가 명시적으로 전송
 *   3. `Origin` 헤더 추론 — `dnfm.kr` 계열 → newb, `hurock.dnfm.kr` → hurock
 *
 * 결정된 site 는 c.set("site", ...) 로 라우트 핸들러에 전달.
 *
 * cross-site 접근 금지 정책: site param 과 Origin 추론 결과가 다르면 거부.
 * (단, super 권한은 우회 가능 — auth middleware 에서 처리)
 */
function inferSiteFromOrigin(origin: string | undefined): SiteCode | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (host === "dnfm.kr" || host === "www.dnfm.kr" || host === "localhost") return "newb";
    if (host === "hurock.dnfm.kr") return "hurock";
    // dev: 포트로 분기
    if (host === "127.0.0.1") return "newb";
    return null;
  } catch {
    return null;
  }
}

export function siteFromParam() {
  return async (c: Context, next: Next) => {
    const raw = c.req.param("site");
    const parsed = siteCodeSchema.safeParse(raw);
    if (!parsed.success) {
      throw AppError.badRequest("지원하지 않는 사이트입니다.", "invalid_site", { site: raw });
    }
    c.set("site", parsed.data);
    await next();
  };
}

export function siteFromHeader() {
  return async (c: Context, next: Next) => {
    const headerSite = c.req.header("x-site-code");
    const origin = c.req.header("origin");
    const inferred = inferSiteFromOrigin(origin);
    const candidate = headerSite ?? inferred;
    const parsed = siteCodeSchema.safeParse(candidate);
    if (!parsed.success) {
      throw AppError.badRequest("사이트를 식별할 수 없습니다.", "site_required");
    }
    c.set("site", parsed.data);
    await next();
  };
}

export function getSite(c: Context): SiteCode {
  const site = c.get("site");
  if (!site) throw AppError.internal("site context missing");
  return site as SiteCode;
}
