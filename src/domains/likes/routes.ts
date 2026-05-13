import "../../shared/http/hono-env.js";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { likeDto, siteParam } from "./dto.js";
import { toggleLike } from "./service.js";
import { ok } from "../../shared/http/response.js";
import { requireAuth } from "../../shared/http/middleware/auth.js";
import { siteFromParam } from "../../shared/http/middleware/site.js";

const likes = new Hono();

likes.use("/sites/:site/*", siteFromParam());

/**
 * POST /sites/:site/likes — 좋아요 토글.
 * 응답: { liked: true | false }
 */
likes.post(
  "/sites/:site/likes",
  requireAuth(),
  zValidator("json", likeDto),
  async (c) => {
    const userId = c.get("userId");
    const input = c.req.valid("json");
    const result = await toggleLike(userId, input);
    return ok(c, result);
  },
);

// satisfy unused import lint
void siteParam;

export default likes;
