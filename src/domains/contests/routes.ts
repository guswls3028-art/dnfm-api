import "../../shared/http/hono-env.js";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { isSiteAdmin } from "../../shared/auth/permissions.js";
import { AppError } from "../../shared/errors/app-error.js";
import { getClientIp } from "../../shared/http/client-ip.js";
import { optionalAuth, requireAuth } from "../../shared/http/middleware/auth.js";
import { writeRateLimit } from "../../shared/http/middleware/rate-limit.js";
import { siteFromParam } from "../../shared/http/middleware/site.js";
import { created, ok } from "../../shared/http/response.js";
import type { SiteCode } from "../../shared/types/site.js";
import { requireUuid } from "../../shared/validation/uuid.js";
import {
  announceResultsDto,
  createContestDto,
  createEntryDto,
  deleteEntryDto,
  listContestsQuery,
  listEntriesQuery,
  selectForVoteDto,
  siteParam,
  updateContestDto,
  updateEntryModerationDto,
  voteDto,
} from "./dto.js";
import {
  announceResults,
  createContest,
  createEntry,
  deleteContest,
  deleteEntryAsGuest,
  getContest,
  listContestAuditLogs,
  listContests,
  listEntries,
  listMyContestEntries,
  listResults,
  selectEntryForVote,
  tallyVotes,
  updateContest,
  updateEntryModeration,
  voteForEntry,
} from "./service.js";

/**
 * 비회원 정책 SSOT: project_anonymous_posting_policy.md (2026-05-14).
 * - entries 참가 = 비회원 가능 (회원 인증 강제 X). authorId null 일 때 anonymousMarker 표기.
 * - 수정/삭제 = guestPassword 본인 검증 또는 어드민.
 *
 * IP 추출은 shared helper `getClientIp` SSOT — cf-connecting-ip 우선.
 */

const contests = new Hono();

contests.use("/sites/:site/*", siteFromParam());

/**
 * isAdmin 결정 — user_site_roles 조회.
 *   role IN ('admin','super') 또는 site='*' 의 admin/super row 면 true.
 *
 * 정책:
 *   - 콘테스트 생성/수정/삭제/후보선정/결과발표 = admin only → 모두 isAdmin 체크
 *   - 그 외 (list/get/entry 작성/투표/결과 조회) = 로그인 회원 or 공개
 */
async function resolveIsAdmin(site: SiteCode, userId: string): Promise<boolean> {
  return isSiteAdmin(site, userId);
}

function requireAdmin(): never {
  throw AppError.forbidden("운영자 권한이 필요합니다.", "admin_required");
}

/* -------------------------------------------------------------------------- */
/* contests CRUD                                                              */
/* -------------------------------------------------------------------------- */

/** GET /sites/:site/contests — list. */
contests.get(
  "/sites/:site/contests",
  optionalAuth(),
  zValidator("query", listContestsQuery),
  async (c) => {
    const site = c.get("site");
    const query = c.req.valid("query");
    const result = await listContests(site, query);
    return ok(c, result);
  },
);

/** POST /sites/:site/contests — 어드민 생성. */
contests.post(
  "/sites/:site/contests",
  requireAuth(),
  zValidator("json", createContestDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const isAdmin = await resolveIsAdmin(site, userId);
    if (!isAdmin) requireAdmin();
    const input = c.req.valid("json");
    const contest = await createContest(site, userId, input);
    return created(c, { contest });
  },
);

/** GET /sites/:site/contests/:id — 단건 (counts 포함). */
contests.get("/sites/:site/contests/:id", optionalAuth(), async (c) => {
  const site = c.get("site");
  const id = requireUuid(c.req.param("id"), "contest_not_found");
  const result = await getContest(site, id);
  return ok(c, result);
});

/** PATCH /sites/:site/contests/:id — 어드민 수정. */
contests.patch(
  "/sites/:site/contests/:id",
  requireAuth(),
  zValidator("json", updateContestDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const isAdmin = await resolveIsAdmin(site, userId);
    if (!isAdmin) requireAdmin();
    const id = requireUuid(c.req.param("id"), "contest_not_found");
    const input = c.req.valid("json");
    const contest = await updateContest(site, id, userId, input);
    return ok(c, { contest });
  },
);

/** DELETE /sites/:site/contests/:id — 어드민 삭제 (entry 없는 draft 만). */
contests.delete("/sites/:site/contests/:id", requireAuth(), async (c) => {
  const site = c.get("site");
  const userId = c.get("userId");
  const isAdmin = await resolveIsAdmin(site, userId);
  if (!isAdmin) requireAdmin();
  const id = requireUuid(c.req.param("id"), "contest_not_found");
  await deleteContest(site, id, userId);
  return ok(c, { ok: true });
});

/* -------------------------------------------------------------------------- */
/* entries                                                                    */
/* -------------------------------------------------------------------------- */

/** GET /sites/:site/me/contest-entries — 내가 제출한 참가작 상태. */
contests.get("/sites/:site/me/contest-entries", requireAuth(), async (c) => {
  const site = c.get("site");
  const userId = c.get("userId");
  const items = await listMyContestEntries(site, userId);
  return ok(c, { items });
});

/** GET /sites/:site/contests/:id/entries — entry list. */
contests.get(
  "/sites/:site/contests/:id/entries",
  optionalAuth(),
  zValidator("query", listEntriesQuery),
  async (c) => {
    const site = c.get("site");
    const id = requireUuid(c.req.param("id"), "contest_not_found");
    const query = c.req.valid("query");
    const userId = c.get("userId") ?? null;
    const includeAll = userId ? await resolveIsAdmin(site, userId) : false;
    const result = await listEntries(site, id, query, { includeAll });
    return ok(c, result);
  },
);

/**
 * POST /sites/:site/contests/:id/entries — 참가.
 * 회원/비회원 둘 다 허용. 비회원은 dto 의 guestNickname/guestPassword 로.
 */
contests.post(
  "/sites/:site/contests/:id/entries",
  optionalAuth(),
  writeRateLimit, // 비회원 spam / 회원 도배 둘 다 방어. posts/comments 와 동일 정책.
  zValidator("json", createEntryDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId") ?? null;
    const id = requireUuid(c.req.param("id"), "contest_not_found");
    const input = c.req.valid("json");
    const entry = await createEntry(site, id, userId, input, {
      ipAddress: getClientIp(c),
      userAgent: c.req.header("user-agent"),
    });
    return created(c, { entry });
  },
);

/**
 * DELETE /sites/:site/contests/:id/entries/:entryId — 비회원 본인 삭제.
 * guestPassword 가 authorPasswordHash 와 매치돼야 함. 회원 entry / admin 삭제는 별도 path.
 */
contests.delete(
  "/sites/:site/contests/:id/entries/:entryId",
  writeRateLimit, // 비번 brute-force 방어 (IP 당 분당 20회).
  zValidator("json", deleteEntryDto),
  async (c) => {
    const site = c.get("site");
    const id = requireUuid(c.req.param("id"), "contest_not_found");
    const entryId = requireUuid(c.req.param("entryId"), "entry_not_found");
    const input = c.req.valid("json");
    if (!input.guestPassword) {
      throw AppError.badRequest("비밀번호가 필요합니다.", "guest_password_required");
    }
    const result = await deleteEntryAsGuest(site, id, entryId, input.guestPassword);
    return ok(c, result);
  },
);

/** POST /sites/:site/contests/:id/entries/:entryId/select — 어드민 후보 선정. */
contests.post(
  "/sites/:site/contests/:id/entries/:entryId/select",
  requireAuth(),
  zValidator("json", selectForVoteDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const isAdmin = await resolveIsAdmin(site, userId);
    if (!isAdmin) requireAdmin();
    const id = requireUuid(c.req.param("id"), "contest_not_found");
    const entryId = requireUuid(c.req.param("entryId"), "entry_not_found");
    const input = c.req.valid("json");
    const entry = await selectEntryForVote(
      site,
      id,
      entryId,
      userId,
      input.selectedForVote,
      input.reason,
    );
    return ok(c, { entry });
  },
);

/** PATCH /sites/:site/contests/:id/entries/:entryId — 어드민 검수 상태 변경. */
contests.patch(
  "/sites/:site/contests/:id/entries/:entryId",
  requireAuth(),
  zValidator("json", updateEntryModerationDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const isAdmin = await resolveIsAdmin(site, userId);
    if (!isAdmin) requireAdmin();
    const id = requireUuid(c.req.param("id"), "contest_not_found");
    const entryId = requireUuid(c.req.param("entryId"), "entry_not_found");
    const input = c.req.valid("json");
    const entry = await updateEntryModeration(site, id, entryId, userId, input);
    return ok(c, { entry });
  },
);

/* -------------------------------------------------------------------------- */
/* votes                                                                      */
/* -------------------------------------------------------------------------- */

/** POST /sites/:site/contests/:id/votes — 1인 1표. */
contests.post(
  "/sites/:site/contests/:id/votes",
  requireAuth(),
  zValidator("json", voteDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const id = requireUuid(c.req.param("id"), "contest_not_found");
    const { entryId } = c.req.valid("json");
    const vote = await voteForEntry(site, id, userId, entryId);
    return created(c, { vote });
  },
);

/** GET /sites/:site/contests/:id/tally — 공개투표 현재 집계. */
contests.get("/sites/:site/contests/:id/tally", optionalAuth(), async (c) => {
  const site = c.get("site");
  const id = requireUuid(c.req.param("id"), "contest_not_found");
  const tally = await tallyVotes(site, id);
  return ok(c, { tally });
});

/** GET /sites/:site/contests/:id/audit-logs — 어드민 감사 로그. */
contests.get("/sites/:site/contests/:id/audit-logs", requireAuth(), async (c) => {
  const site = c.get("site");
  const userId = c.get("userId");
  const isAdmin = await resolveIsAdmin(site, userId);
  if (!isAdmin) requireAdmin();
  const id = requireUuid(c.req.param("id"), "contest_not_found");
  const includeEntries = c.req.query("includeEntries") === "1";
  const limitRaw = Number(c.req.query("limit") || 100);
  const logs = await listContestAuditLogs(site, id, {
    includeEntries,
    limit: Number.isFinite(limitRaw) ? limitRaw : 100,
  });
  return ok(c, { logs });
});

/* -------------------------------------------------------------------------- */
/* results                                                                    */
/* -------------------------------------------------------------------------- */

/** GET /sites/:site/contests/:id/results — 발표된 결과. */
contests.get("/sites/:site/contests/:id/results", optionalAuth(), async (c) => {
  const site = c.get("site");
  const id = requireUuid(c.req.param("id"), "contest_not_found");
  const results = await listResults(site, id);
  return ok(c, { results });
});

/** POST /sites/:site/contests/:id/results — 어드민 발표 (auto 또는 수기). */
contests.post(
  "/sites/:site/contests/:id/results",
  requireAuth(),
  zValidator("json", announceResultsDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const isAdmin = await resolveIsAdmin(site, userId);
    if (!isAdmin) requireAdmin();
    const id = requireUuid(c.req.param("id"), "contest_not_found");
    const input = c.req.valid("json");
    const results = await announceResults(site, id, userId, input);
    return created(c, { results });
  },
);

// satisfy unused import lint (siteParam for OpenAPI / external use)
void siteParam;

export default contests;
