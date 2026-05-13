import { writeRateLimit } from "@/shared/http/middleware/rate-limit.js";
import "../../shared/http/hono-env.js";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  createPostDto,
  updatePostDto,
  listPostsQuery,
  votePostDto,
  createCategoryDto,
  siteParam,
} from "./dto.js";
import {
  listPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  votePost,
  bumpViewCount,
  listCategories,
  createCategory,
} from "./service.js";
import { ok, created } from "../../shared/http/response.js";
import { requireAuth, optionalAuth } from "../../shared/http/middleware/auth.js";
import { siteFromParam } from "../../shared/http/middleware/site.js";
import { AppError } from "../../shared/errors/app-error.js";
import { isSiteAdmin } from "../../shared/auth/permissions.js";

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
posts.get(
  "/sites/:site/posts",
  optionalAuth(),
  zValidator("query", listPostsQuery),
  async (c) => {
    const site = c.get("site");
    const query = c.req.valid("query");
    const result = await listPosts(site, query);
    return ok(c, result);
  },
);

/** GET /sites/:site/posts/:id — 글 상세 (조회수 증가). */
posts.get("/sites/:site/posts/:id", optionalAuth(), async (c) => {
  const site = c.get("site");
  const id = c.req.param("id");
  if (!id) throw AppError.badRequest("post id required", "id_required");
  const post = await getPostById(site, id);
  // fire and forget
  bumpViewCount(post.id).catch(() => {});
  return ok(c, { post });
});

/** POST /sites/:site/posts — 글 작성 (회원). */
posts.post(
  "/sites/:site/posts",
  requireAuth(),
  zValidator("json", createPostDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const input = c.req.valid("json");
    const post = await createPost(site, userId, input);
    return created(c, { post });
  },
);

/** PATCH /sites/:site/posts/:id — 글 수정 (작성자 or 어드민). */
posts.patch(
  "/sites/:site/posts/:id",
  requireAuth(),
  zValidator("json", updatePostDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!id) throw AppError.badRequest("post id required", "id_required");
    const input = c.req.valid("json");
    const isAdmin = await isSiteAdmin(site, userId);
    const post = await updatePost(site, id, userId, isAdmin, input);
    return ok(c, { post });
  },
);

/** DELETE /sites/:site/posts/:id — soft delete. */
posts.delete("/sites/:site/posts/:id", 
  writeRateLimit,requireAuth(), async (c) => {
  const site = c.get("site");
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!id) throw AppError.badRequest("post id required", "id_required");
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
    const id = c.req.param("id");
    if (!id) throw AppError.badRequest("post id required", "id_required");
    const { voteType } = c.req.valid("json");
    const post = await votePost(site, id, userId, voteType);
    return ok(c, { post });
  },
);

// satisfy unused import lint (siteParam exported for future use)
void siteParam;

export default posts;
