import { writeRateLimit } from "@/shared/http/middleware/rate-limit.js";
import "../../shared/http/hono-env.js";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { isSiteAdmin } from "../../shared/auth/permissions.js";
import { AppError } from "../../shared/errors/app-error.js";
import { optionalAuth, requireAuth } from "../../shared/http/middleware/auth.js";
import { siteFromParam } from "../../shared/http/middleware/site.js";
import { created, ok } from "../../shared/http/response.js";
import { requireUuid } from "../../shared/validation/uuid.js";
import {
  createCategoryDto,
  createPostDto,
  listPostsQuery,
  siteParam,
  updatePostDto,
  votePostDto,
} from "./dto.js";
import {
  bumpViewCount,
  createCategory,
  createPost,
  deletePost,
  getPostById,
  listCategories,
  listPosts,
  updatePost,
  votePost,
} from "./service.js";

const posts = new Hono();

posts.use("/sites/:site/*", siteFromParam());

/** GET /sites/:site/categories — 카테고리 list (public). */
posts.get("/sites/:site/categories", optionalAuth(), async (c) => {
  const site = c.get("site");
  const rows = await listCategories(site);
  return ok(c, { items: rows });
});

/** POST /sites/:site/categories — 카테고리 생성 (admin only). */
posts.post(
  "/sites/:site/categories",
  requireAuth(),
  zValidator("json", createCategoryDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const isAdmin = await isSiteAdmin(site, userId);
    if (!isAdmin) {
      throw AppError.forbidden("운영자 권한이 필요합니다.", "admin_required");
    }
    const input = c.req.valid("json");
    const cat = await createCategory(site, input);
    return ok(c, { category: cat }, undefined, 201);
  },
);

/** GET /sites/:site/posts — 글 list (public, 익명도 조회 가능). */
posts.get("/sites/:site/posts", optionalAuth(), zValidator("query", listPostsQuery), async (c) => {
  const site = c.get("site");
  const query = c.req.valid("query");
  // author=me 처리용으로 optional userId 전달.
  const actorId = c.get("userId");
  const result = await listPosts(site, query, actorId);
  return ok(c, result);
});

/** GET /sites/:site/posts/:id — 글 상세 (조회수 증가). */
posts.get("/sites/:site/posts/:id", optionalAuth(), async (c) => {
  const site = c.get("site");
  const id = requireUuid(c.req.param("id"), "post_not_found");
  const post = await getPostById(site, id);
  // fire and forget
  bumpViewCount(post.id).catch(() => {});
  return ok(c, { post });
});

/** POST /sites/:site/posts — 글 작성 (회원). */
posts.post("/sites/:site/posts", requireAuth(), zValidator("json", createPostDto), async (c) => {
  const site = c.get("site");
  const userId = c.get("userId");
  const input = c.req.valid("json");
  const post = await createPost(site, userId, input);
  return created(c, { post });
});

/** PATCH /sites/:site/posts/:id — 글 수정 (작성자 or 어드민). */
posts.patch(
  "/sites/:site/posts/:id",
  requireAuth(),
  zValidator("json", updatePostDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const id = requireUuid(c.req.param("id"), "post_not_found");
    const input = c.req.valid("json");
    const isAdmin = await isSiteAdmin(site, userId);
    const post = await updatePost(site, id, userId, isAdmin, input);
    return ok(c, { post });
  },
);

/** DELETE /sites/:site/posts/:id — soft delete. */
posts.delete("/sites/:site/posts/:id", writeRateLimit, requireAuth(), async (c) => {
  const site = c.get("site");
  const userId = c.get("userId");
  const id = requireUuid(c.req.param("id"), "post_not_found");
  const isAdmin = await isSiteAdmin(site, userId);
  await deletePost(site, id, userId, isAdmin);
  return ok(c, { ok: true });
});

/** POST /sites/:site/posts/:id/vote — 추천/비추천 토글. */
posts.post(
  "/sites/:site/posts/:id/vote",
  requireAuth(),
  zValidator("json", votePostDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const id = requireUuid(c.req.param("id"), "post_not_found");
    const { voteType } = c.req.valid("json");
    const post = await votePost(site, id, userId, voteType);
    return ok(c, { post });
  },
);

// satisfy unused import lint (siteParam exported for future use)
void siteParam;

export default posts;
