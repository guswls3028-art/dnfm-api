import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { logger as honoLogger } from "hono/logger";
import { errorsMiddleware } from "./middleware/errors.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { corsMiddleware } from "./middleware/cors.js";
import { ok } from "./response.js";
import authRoutes from "@/domains/auth/routes.js";
import postsRoutes from "@/domains/posts/routes.js";
import commentsRoutes from "@/domains/comments/routes.js";
import likesRoutes from "@/domains/likes/routes.js";
import uploadsRoutes from "@/domains/uploads/routes.js";
import contestsRoutes from "@/domains/contests/routes.js";

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
  // /auth/*  (signup/login/logout/me + OAuth + dnf OCR)
  app.route("/auth", authRoutes);
  // /sites/:site/{categories, posts, posts/:id/{,vote}}
  app.route("/", postsRoutes);
  // /sites/:site/posts/:postId/comments + /sites/:site/comments/:id
  app.route("/", commentsRoutes);
  // /sites/:site/likes
  app.route("/", likesRoutes);
  // /sites/:site/contests + entries + votes + results
  app.route("/", contestsRoutes);
  // /uploads/presigned-put + /uploads/:id/confirm
  app.route("/", uploadsRoutes);

  // TODO Stage 2/3: /me/profile, /admin/*

  app.notFound((c) => c.json({ error: { code: "not_found", message: "endpoint not found" } }, 404));

  return app;
}
