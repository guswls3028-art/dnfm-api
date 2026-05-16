import "../../shared/http/hono-env.js";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { isSiteAdmin } from "../../shared/auth/permissions.js";
import { AppError } from "../../shared/errors/app-error.js";
import { optionalAuth, requireAuth } from "../../shared/http/middleware/auth.js";
import { writeRateLimit } from "../../shared/http/middleware/rate-limit.js";
import { siteFromParam } from "../../shared/http/middleware/site.js";
import { created, ok } from "../../shared/http/response.js";
import { requireUuid } from "../../shared/validation/uuid.js";
import {
  createDrawSessionDto,
  createQuestionDto,
  listDrawSessionsQuery,
  listQuestionsQuery,
  siteParam,
  updateQuestionDto,
} from "./dto.js";
import {
  createDrawSession,
  createQuestion,
  getBroadcastDashboard,
  getLiveQuestion,
  listDrawSessions,
  listQuestions,
  updateQuestionStatus,
} from "./service.js";

const broadcastOps = new Hono();

broadcastOps.use("/sites/:site/*", siteFromParam());

async function requireAdmin(site: "newb" | "hurock", userId: string) {
  const admin = await isSiteAdmin(site, userId);
  if (!admin) throw AppError.forbidden("운영자 권한이 필요합니다.", "admin_required");
}

/** POST /sites/:site/broadcast/questions — 방송 질문 접수. */
broadcastOps.post(
  "/sites/:site/broadcast/questions",
  writeRateLimit,
  optionalAuth(),
  zValidator("json", createQuestionDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId") ?? null;
    const input = c.req.valid("json");
    const question = await createQuestion(site, userId, input);
    return created(c, { question });
  },
);

/** GET /sites/:site/broadcast/questions/live — OBS/browser source 용 공개 화면 데이터. */
broadcastOps.get("/sites/:site/broadcast/questions/live", async (c) => {
  const site = c.get("site");
  const question = await getLiveQuestion(site);
  return ok(c, { question });
});

/** GET /sites/:site/broadcast/questions — 어드민 질문 큐. */
broadcastOps.get(
  "/sites/:site/broadcast/questions",
  requireAuth(),
  zValidator("query", listQuestionsQuery),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    await requireAdmin(site, userId);
    const query = c.req.valid("query");
    const result = await listQuestions(site, query);
    return ok(c, result);
  },
);

/** PATCH /sites/:site/broadcast/questions/:id — 어드민 질문 상태 변경. */
broadcastOps.patch(
  "/sites/:site/broadcast/questions/:id",
  requireAuth(),
  zValidator("json", updateQuestionDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    await requireAdmin(site, userId);
    const id = requireUuid(c.req.param("id"), "question_not_found");
    const input = c.req.valid("json");
    const question = await updateQuestionStatus(site, id, userId, input);
    return ok(c, { question });
  },
);

/** GET /sites/:site/broadcast/dashboard — 어드민 방송 운영 요약. */
broadcastOps.get("/sites/:site/broadcast/dashboard", requireAuth(), async (c) => {
  const site = c.get("site");
  const userId = c.get("userId");
  await requireAdmin(site, userId);
  const dashboard = await getBroadcastDashboard(site);
  return ok(c, dashboard);
});

/** GET /sites/:site/draw-sessions — 추첨 기록 공개 목록. */
broadcastOps.get(
  "/sites/:site/draw-sessions",
  zValidator("query", listDrawSessionsQuery),
  async (c) => {
    const site = c.get("site");
    const query = c.req.valid("query");
    const result = await listDrawSessions(site, query);
    return ok(c, result);
  },
);

/** POST /sites/:site/draw-sessions — 어드민 서버 추첨 실행 + 기록 저장. */
broadcastOps.post(
  "/sites/:site/draw-sessions",
  requireAuth(),
  zValidator("json", createDrawSessionDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    await requireAdmin(site, userId);
    const input = c.req.valid("json");
    const drawSession = await createDrawSession(site, userId, input);
    return created(c, { drawSession });
  },
);

void siteParam;

export default broadcastOps;
