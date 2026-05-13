import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/shared/db/client.js";
import { userSiteRoles } from "@/domains/site_membership/schema.js";
import type { SiteCode, SiteRole } from "@/shared/types/site.js";

/**
 * 사이트 권한 helper — user_site_roles 조회.
 *
 * super 정책: site = "*" 한 row 로 모든 사이트의 admin/super 권한.
 *   따라서 검사 대상 site 의 row 또는 site = "*" 의 row 둘 다 매치.
 */

/** (site, userId) 의 role 반환. 없으면 null. super("*") 도 같이 본다. */
export async function getUserSiteRole(
  site: SiteCode,
  userId: string,
): Promise<SiteRole | null> {
  const rows = await db
    .select({ role: userSiteRoles.role, site: userSiteRoles.site })
    .from(userSiteRoles)
    .where(
      and(
        eq(userSiteRoles.userId, userId),
        or(eq(userSiteRoles.site, site), eq(userSiteRoles.site, "*")),
      ),
    );

  if (rows.length === 0) return null;

  // super("*") row 가 있으면 우선 — 사이트별 role 보다 우세.
  const superRow = rows.find((r) => r.site === "*");
  if (superRow) return superRow.role as SiteRole;

  return rows[0]?.role as SiteRole;
}

/**
 * 사용자의 모든 사이트별 role 반환.
 * /auth/me 응답 enrichment 에 사용 — frontend 가 admin 버튼 분기.
 *
 * 반환: [{ site: "newb"|"allow"|"*", role: "member"|"admin"|"super" }, ...]
 * 비어있으면 [] (member 자동 부여 정책은 별도 — 여기선 user_site_roles row 만 본다).
 */
export async function getAllUserSiteRoles(
  userId: string,
): Promise<Array<{ site: SiteCode | "*"; role: SiteRole }>> {
  const rows = await db
    .select({ site: userSiteRoles.site, role: userSiteRoles.role })
    .from(userSiteRoles)
    .where(eq(userSiteRoles.userId, userId));
  return rows as Array<{ site: SiteCode | "*"; role: SiteRole }>;
}

/**
 * site 의 admin 또는 super 권한 보유 검사.
 * posts/contests 의 update/delete/pinned/admin-only endpoint 에서 사용.
 */
export async function isSiteAdmin(site: SiteCode, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: userSiteRoles.id })
    .from(userSiteRoles)
    .where(
      and(
        eq(userSiteRoles.userId, userId),
        or(eq(userSiteRoles.site, site), eq(userSiteRoles.site, "*")),
        inArray(userSiteRoles.role, ["admin", "super"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * 어느 사이트든 admin / super 권한이 하나라도 있는지.
 * 사이트 무관 admin gate (예: cross-site hero banner 업로드) 에서 사용.
 */
export async function hasAnyAdminRole(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: userSiteRoles.id })
    .from(userSiteRoles)
    .where(
      and(
        eq(userSiteRoles.userId, userId),
        inArray(userSiteRoles.role, ["admin", "super"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
