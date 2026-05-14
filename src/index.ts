import "@/shared/http/hono-env.js";
import { serve } from "@hono/node-server";
import { createApp } from "@/shared/http/app.js";
import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { closeDb } from "@/shared/db/client.js";

const app = createApp();

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, env: env.NODE_ENV }, "api up");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down — waiting in-flight requests (max 180s)");
  server.close(async (err) => {
    if (err) logger.error({ err }, "server close error");
    await closeDb();
    process.exit(0);
  });
  // hard timeout — OCR multi-image 처리가 30-60s 걸려 in-flight cut 방지.
  // pm2 kill_timeout 도 ecosystem.config.cjs 에 180000 으로 sync 필요.
  setTimeout(() => {
    logger.warn("force exit after 180s timeout");
    process.exit(1);
  }, 180_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
