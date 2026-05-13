import "../../shared/http/hono-env.js";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  createContestDto,
  updateContestDto,
  listContestsQuery,
  createEntryDto,
  listEntriesQuery,
  selectForVoteDto,
  voteDto,
  announceResultsDto,
  siteParam,
} from "./dto.js";
import {
  createContest,
  listContests,
  getContest,
  updateContest,
  deleteContest,
  createEntry,
  listEntries,
  selectEntryForVote,
  voteForEntry,
  listResults,
  announceResults,
  tallyVotes,
} from "./service.js";
import { ok, created } from "../../shared/http/response.js";
import { requireAuth, optionalAuth } from "../../shared/http/middleware/auth.js";
import { siteFromParam } from "../../shared/http/middleware/site.js";
import { AppError } from "../../shared/errors/app-error.js";

const contests = new Hono();

contests.use("/sites/:site/*", siteFromParam());

/**
 * isAdmin 결정 — site_membership 조회 미구현. Stage 2 에서 user_site_roles
 * lookup 으로 교체. 지금은 false 로 두되, admin-only 라우트는 TODO 마커 + 401.
 *
 * 현 시점 정책:
 *   - 콘테스트 생성/수정/삭제/후보선정/결과발표 = admin only → 모두 isAdmin 체크
 *   - 그 외 (list/get/entry 작성/투표/결과 조회) = 로그인 회원 or 공개
 */
async function resolveIsAdmin(_site: string, _userId: string): Promise<boolean> {
  // TODO Stage 2: SELECT role FROM user_site_roles WHERE site=$1 AND user_id=$2
  // role IN ('admin','super') 이면 true. 현재는 모두 false.
  return false;
}

function requireAdmin(): never {
  throw AppError.forbidden(
    "운영자 권한이 필요합니다. (site_membership 미구현 단계)",
    "admin_required",
  );
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
  const id = c.req.param("id");
  if (!id) throw AppError.badRequest("contest id required", "id_required");
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
    const id = c.req.param("id");
    if (!id) throw AppError.badRequest("contest id required", "id_required");
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
  const id = c.req.param("id");
  if (!id) throw AppError.badRequest("contest id required", "id_required");
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
    const id = c.req.param("id");
    if (!id) throw AppError.badRequest("contest id required", "id_required");
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
    const id = c.req.param("id");
    if (!id) throw AppError.badRequest("contest id required", "id_required");
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
    const id = c.req.param("id");
    const entryId = c.req.param("entryId");
    if (!id || !entryId) throw AppError.badRequest("id required", "id_required");
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
    const id = c.req.param("id");
    if (!id) throw AppError.badRequest("contest id required", "id_required");
    const { entryId } = c.req.valid("json");
    const vote = await voteForEntry(site, id, userId, entryId);
    return created(c, { vote });
  },
);

/** GET /sites/:site/contests/:id/tally — 현재 집계 (운영 모니터링용). */
contests.get("/sites/:site/contests/:id/tally", optionalAuth(), async (c) => {
  const site = c.get("site");
  const id = c.req.param("id");
  if (!id) throw AppError.badRequest("contest id required", "id_required");
  const tally = await tallyVotes(site, id);
  return ok(c, { tally });
});

/* -------------------------------------------------------------------------- */
/* results                                                                    */
/* -------------------------------------------------------------------------- */

/** GET /sites/:site/contests/:id/results — 발표된 결과. */
contests.get("/sites/:site/contests/:id/results", optionalAuth(), async (c) => {
  const site = c.get("site");
  const id = c.req.param("id");
  if (!id) throw AppError.badRequest("contest id required", "id_required");
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
    const id = c.req.param("id");
    if (!id) throw AppError.badRequest("contest id required", "id_required");
    const input = c.req.valid("json");
    const results = await announceResults(site, id, input);
    return created(c, { results });
  },
);

// satisfy unused import lint (siteParam for OpenAPI / external use)
void siteParam;

export default contests;
