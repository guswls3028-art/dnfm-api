import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { logger as honoLogger } from "hono/logger";
import { errorsMiddleware } from "./middleware/errors.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { corsMiddleware } from "./middleware/cors.js";
import { ok } from "./response.js";
import authRoutes from "@/domains/auth/routes.js";
import postsRoutes from "@/domains/posts/routes.js";

/**
 * Hono app factory.
 * 라우트 추가는 도메인별로 import 해 mount.
 * 횡단 관심사 (request-id, cors, secure-headers, errors, logger) 는 여기에 한 줄씩.
 */
export function createApp() {
  const app = new Hono();

  app.use("*", requestIdMiddleware);
  app.use("*", honoLogger());
  app.use("*", secureHeaders());
  app.use("*", corsMiddleware);
  app.use("*", errorsMiddleware);

  // health
  app.get("/healthz", (c) => ok(c, { status: "ok", ts: new Date().toISOString() }));
  app.get("/readyz", (c) => ok(c, { status: "ready" }));

  // 도메인 mount
  app.route("/auth", authRoutes);
  app.route("/", postsRoutes); // /sites/:site/{categories,posts,...}

  // TODO Stage 2/3: /sites/:site/comments, /sites/:site/contests,
  //                 /sites/:site/likes, /uploads, /me/profile

  app.notFound((c) => c.json({ error: { code: "not_found", message: "endpoint not found" } }, 404));

  return app;
}
