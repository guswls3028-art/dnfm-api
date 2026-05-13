import "../../shared/http/hono-env.js";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { isSiteAdmin } from "../../shared/auth/permissions.js";
import { getClientIp, getUserAgent } from "../../shared/http/client-ip.js";
import { optionalAuth } from "../../shared/http/middleware/auth.js";
import { writeRateLimit } from "../../shared/http/middleware/rate-limit.js";
import { siteFromParam } from "../../shared/http/middleware/site.js";
import { created, ok } from "../../shared/http/response.js";
import { requireUuid } from "../../shared/validation/uuid.js";
import {
  createCommentDto,
  deleteCommentDto,
  listCommentsQuery,
  siteParam,
  updateCommentDto,
} from "./dto.js";
import {
  createComment,
  deleteComment,
  listByPost,
  publicComment,
  updateComment,
} from "./service.js";

const comments = new Hono();

comments.use("/sites/:site/*", siteFromParam());

/** GET /sites/:site/posts/:postId/comments — 댓글 list (public). */
comments.get(
  "/sites/:site/posts/:postId/comments",
  optionalAuth(),
  zValidator("query", listCommentsQuery),
  async (c) => {
    const site = c.get("site");
    const postId = requireUuid(c.req.param("postId"), "post_not_found");
    const query = c.req.valid("query");
    const result = await listByPost(site, postId, query);
    return ok(c, result);
  },
);

/** POST /sites/:site/posts/:postId/comments — 댓글 작성. 회원/비회원 모두. */
comments.post(
  "/sites/:site/posts/:postId/comments",
  writeRateLimit,
  optionalAuth(),
  zValidator("json", createCommentDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId") || null;
    const postId = requireUuid(c.req.param("postId"), "post_not_found");
    const input = c.req.valid("json");
    const comment = await createComment(site, postId, userId, input, {
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });
    return created(c, { comment: publicComment(comment) });
  },
);

/** PATCH /sites/:site/comments/:id — 댓글 수정. 회원 본인 / 비회원 비번 일치 / admin. */
comments.patch(
  "/sites/:site/comments/:id",
  optionalAuth(),
  zValidator("json", updateCommentDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId") || null;
    const id = requireUuid(c.req.param("id"), "comment_not_found");
    const input = c.req.valid("json");
    const isAdmin = userId ? await isSiteAdmin(site, userId) : false;
    const comment = await updateComment(site, id, userId, isAdmin, input);
    return ok(c, { comment: publicComment(comment) });
  },
);

/** DELETE /sites/:site/comments/:id — soft delete. 회원/비회원 모두. */
comments.delete(
  "/sites/:site/comments/:id",
  writeRateLimit,
  optionalAuth(),
  zValidator("json", deleteCommentDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId") || null;
    const id = requireUuid(c.req.param("id"), "comment_not_found");
    const input = c.req.valid("json");
    const isAdmin = userId ? await isSiteAdmin(site, userId) : false;
    await deleteComment(site, id, userId, isAdmin, input.guestPassword);
    return ok(c, { ok: true });
  },
);

// satisfy unused import lint
void siteParam;

export default comments;
