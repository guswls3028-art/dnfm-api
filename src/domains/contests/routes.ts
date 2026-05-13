import "../../shared/http/hono-env.js";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { isSiteAdmin } from "../../shared/auth/permissions.js";
import { AppError } from "../../shared/errors/app-error.js";
import { optionalAuth, requireAuth } from "../../shared/http/middleware/auth.js";
import { siteFromParam } from "../../shared/http/middleware/site.js";
import { created, ok } from "../../shared/http/response.js";
import type { SiteCode } from "../../shared/types/site.js";
import { requireUuid } from "../../shared/validation/uuid.js";
import {
  announceResultsDto,
  createContestDto,
  createEntryDto,
  listContestsQuery,
  listEntriesQuery,
  selectForVoteDto,
  siteParam,
  updateContestDto,
  voteDto,
} from "./dto.js";
import {
  announceResults,
  createContest,
  createEntry,
  deleteContest,
  getContest,
  listContests,
  listEntries,
  listResults,
  selectEntryForVote,
  tallyVotes,
  updateContest,
  voteForEntry,
} from "./service.js";

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
    const contest = await updateContest(site, id, input);
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
  await deleteContest(site, id);
  return ok(c, { ok: true });
});

/* -------------------------------------------------------------------------- */
/* entries                                                                    */
/* -------------------------------------------------------------------------- */

/** GET /sites/:site/contests/:id/entries — entry list. */
contests.get(
  "/sites/:site/contests/:id/entries",
  optionalAuth(),
  zValidator("query", listEntriesQuery),
  async (c) => {
    const site = c.get("site");
    const id = requireUuid(c.req.param("id"), "contest_not_found");
    const query = c.req.valid("query");
    const result = await listEntries(site, id, query);
    return ok(c, result);
  },
);

/** POST /sites/:site/contests/:id/entries — 회원 참가. */
contests.post(
  "/sites/:site/contests/:id/entries",
  requireAuth(),
  zValidator("json", createEntryDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const id = requireUuid(c.req.param("id"), "contest_not_found");
    const input = c.req.valid("json");
    const entry = await createEntry(site, id, userId, input);
    return created(c, { entry });
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
    const entry = await selectEntryForVote(site, id, entryId, input.selectedForVote);
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

/** GET /sites/:site/contests/:id/tally — 현재 집계 (운영 모니터링용). */
contests.get("/sites/:site/contests/:id/tally", optionalAuth(), async (c) => {
  const site = c.get("site");
  const id = requireUuid(c.req.param("id"), "contest_not_found");
  const tally = await tallyVotes(site, id);
  return ok(c, { tally });
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
    const results = await announceResults(site, id, input);
    return created(c, { results });
  },
);

// satisfy unused import lint (siteParam for OpenAPI / external use)
void siteParam;

export default contests;
