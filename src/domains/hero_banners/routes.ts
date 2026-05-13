import "../../shared/http/hono-env.js";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createHeroBannerDto, updateHeroBannerDto } from "./dto.js";
import {
  listHeroBanners,
  createHeroBanner,
  updateHeroBanner,
  deleteHeroBanner,
} from "./service.js";
import { ok } from "../../shared/http/response.js";
import { requireAuth, optionalAuth } from "../../shared/http/middleware/auth.js";
import { siteFromParam } from "../../shared/http/middleware/site.js";
import { AppError } from "../../shared/errors/app-error.js";
import { requireUuid } from "../../shared/validation/uuid.js";
import { isSiteAdmin } from "../../shared/auth/permissions.js";

const heroBanners = new Hono();

heroBanners.use("/sites/:site/hero-banners/*", siteFromParam());
heroBanners.use("/sites/:site/hero-banners", siteFromParam());

/** GET /sites/:site/hero-banners — public list (active only). admin 일 경우 inactive 도 포함 옵션. */
heroBanners.get("/sites/:site/hero-banners", optionalAuth(), async (c) => {
  const site = c.get("site");
  const userId = c.get("userId");
  const wantsAll = c.req.query("includeInactive") === "1";
  let includeInactive = false;
  if (wantsAll && userId) {
    includeInactive = await isSiteAdmin(site, userId);
  }
  const rows = await listHeroBanners(site, { includeInactive });
  return ok(c, { items: rows });
});

/** POST /sites/:site/hero-banners — admin only. */
heroBanners.post(
  "/sites/:site/hero-banners",
  requireAuth(),
  zValidator("json", createHeroBannerDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const isAdmin = await isSiteAdmin(site, userId);
    if (!isAdmin) {
      throw AppError.forbidden("운영자 권한이 필요합니다.", "admin_required");
    }
    const input = c.req.valid("json");
    const row = await createHeroBanner(site, userId, input);
    return ok(c, { banner: row }, undefined, 201);
  },
);

/** PATCH /sites/:site/hero-banners/:id — admin only. */
heroBanners.patch(
  "/sites/:site/hero-banners/:id",
  requireAuth(),
  zValidator("json", updateHeroBannerDto),
  async (c) => {
    const site = c.get("site");
    const userId = c.get("userId");
    const id = requireUuid(c.req.param("id"), "id");
    const isAdmin = await isSiteAdmin(site, userId);
    if (!isAdmin) {
      throw AppError.forbidden("운영자 권한이 필요합니다.", "admin_required");
    }
    const input = c.req.valid("json");
    const row = await updateHeroBanner(site, id, input);
    return ok(c, { banner: row });
  },
);

/** DELETE /sites/:site/hero-banners/:id — admin only. */
heroBanners.delete("/sites/:site/hero-banners/:id", requireAuth(), async (c) => {
  const site = c.get("site");
  const userId = c.get("userId");
  const id = requireUuid(c.req.param("id"), "id");
  const isAdmin = await isSiteAdmin(site, userId);
  if (!isAdmin) {
    throw AppError.forbidden("운영자 권한이 필요합니다.", "admin_required");
  }
  await deleteHeroBanner(site, id);
  return ok(c, { ok: true });
});

export default heroBanners;
