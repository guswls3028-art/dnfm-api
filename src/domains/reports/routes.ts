import "../../shared/http/hono-env.js";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { isSiteAdmin } from "../../shared/auth/permissions.js";
import { AppError } from "../../shared/errors/app-error.js";
import { getClientIp, getUserAgent } from "../../shared/http/client-ip.js";
import { optionalAuth, requireAuth } from "../../shared/http/middleware/auth.js";
import { writeRateLimit } from "../../shared/http/middleware/rate-limit.js";
import { siteFromParam } from "../../shared/http/middleware/site.js";
import { created, ok } from "../../shared/http/response.js";
import { requireUuid } from "../../shared/validation/uuid.js";
import { createReportDto, listReportsQuery, siteParam, updateReportDto } from "./dto.js";
import { createReport, listReports, updateReport } from "./service.js";

const reports = new Hono();

reports.use("/sites/:site/*", siteFromParam());

/** POST /sites/:site/reports — 신고 접수. 회원/비회원 모두. */
reports.post(
  "/sites/:site/reports",
  writeRateLimit,
  optionalAuth(),
  zValidator("json", createReportDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId") || null;
    const input = c.req.valid("json");
    const report = await createReport(site, userId, input, {
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });
    return created(c, { report });
  },
);

/** GET /sites/:site/reports — 어드민 신고 목록. */
reports.get(
  "/sites/:site/reports",
  requireAuth(),
  zValidator("query", listReportsQuery),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const isAdmin = await isSiteAdmin(site, userId);
    if (!isAdmin) {
      throw AppError.forbidden("운영자 권한이 필요합니다.", "admin_required");
    }
    const query = c.req.valid("query");
    const result = await listReports(site, query);
    return ok(c, result);
  },
);

/** PATCH /sites/:site/reports/:id — 어드민 처리 상태 변경. */
reports.patch(
  "/sites/:site/reports/:id",
  requireAuth(),
  zValidator("json", updateReportDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const isAdmin = await isSiteAdmin(site, userId);
    if (!isAdmin) {
      throw AppError.forbidden("운영자 권한이 필요합니다.", "admin_required");
    }
    const id = requireUuid(c.req.param("id"), "report_not_found");
    const input = c.req.valid("json");
    const report = await updateReport(site, id, userId, input);
    return ok(c, { report });
  },
);

void siteParam;

export default reports;
