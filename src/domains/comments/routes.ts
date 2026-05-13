import "../../shared/http/hono-env.js";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { isSiteAdmin } from "../../shared/auth/permissions.js";
import { optionalAuth, requireAuth } from "../../shared/http/middleware/auth.js";
import { siteFromParam } from "../../shared/http/middleware/site.js";
import { created, ok } from "../../shared/http/response.js";
import { requireUuid } from "../../shared/validation/uuid.js";
import { createCommentDto, listCommentsQuery, siteParam, updateCommentDto } from "./dto.js";
import { createComment, deleteComment, listByPost, updateComment } from "./service.js";

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

/** POST /sites/:site/posts/:postId/comments — 댓글 작성 (회원). */
comments.post(
  "/sites/:site/posts/:postId/comments",
  requireAuth(),
  zValidator("json", createCommentDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const postId = requireUuid(c.req.param("postId"), "post_not_found");
    const input = c.req.valid("json");
    const comment = await createComment(site, postId, userId, input);
    return created(c, { comment });
  },
);

/** PATCH /sites/:site/comments/:id — 댓글 수정 (작성자 or 어드민). */
comments.patch(
  "/sites/:site/comments/:id",
  requireAuth(),
  zValidator("json", updateCommentDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const id = requireUuid(c.req.param("id"), "comment_not_found");
    const input = c.req.valid("json");
    const isAdmin = await isSiteAdmin(site, userId);
    const comment = await updateComment(site, id, userId, isAdmin, input);
    return ok(c, { comment });
  },
);

/** DELETE /sites/:site/comments/:id — soft delete (작성자 or 어드민). */
comments.delete("/sites/:site/comments/:id", requireAuth(), async (c) => {
  const site = c.get("site");
  const userId = c.get("userId");
  const id = requireUuid(c.req.param("id"), "comment_not_found");
  const isAdmin = await isSiteAdmin(site, userId);
  await deleteComment(site, id, userId, isAdmin);
  return ok(c, { ok: true });
});

// satisfy unused import lint
void siteParam;

export default comments;
