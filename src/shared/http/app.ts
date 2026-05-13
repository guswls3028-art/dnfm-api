import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { logger as honoLogger } from "hono/logger";
import { ZodError } from "zod";
import { errorsMiddleware } from "./middleware/errors.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { corsMiddleware } from "./middleware/cors.js";
import { ok, fail } from "./response.js";
import { AppError } from "@/shared/errors/app-error.js";
import { logger } from "@/config/logger.js";
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

  /**
   * Global onError — errorsMiddleware 가 ESM dual-instance 등으로 instanceof
   * 매칭 실패하거나 미들웨어 chain 밖에서 throw 가 발생해도 envelope 으로 변환.
   *
   * duck typing 으로 AppError-like 검사:
   *   err.name === "AppError" + err.status (number) + err.code (string)
   */
  app.onError((err, c) => {
    const e = err as unknown as {
      name?: string;
      status?: number;
      code?: string;
      message?: string;
      details?: unknown;
    };
    if (e && e.name === "AppError" && typeof e.status === "number" && typeof e.code === "string") {
      return fail(c, e.status, e.code, e.message ?? "Error", e.details);
    }
    if (err instanceof AppError) {
      return fail(c, err.status, err.code, err.message, err.details);
    }
    if (err instanceof ZodError) {
      return fail(c, 422, "validation_failed", "입력값이 올바르지 않습니다.", err.flatten());
    }
    const requestId = c.get("requestId");
    logger.error({ err, requestId, path: c.req.path }, "unhandled error (onError)");
    return fail(c, 500, "internal_error", "서버 오류가 발생했습니다.");
  });

  return app;
}
