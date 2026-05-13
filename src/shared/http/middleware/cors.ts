import { cors } from "hono/cors";
import { env } from "@/config/env.js";

/**
 * CORS allowlist — Origin 이 env.CORS_ORIGINS 안에 있을 때만 credentials 허용.
 * 쿠키 도메인 `.dnfm.kr` 로 sibling subdomain 공유 (Stage 2).
 */
export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return null;
    return env.CORS_ORIGINS.includes(origin) ? origin : null;
  },
  credentials: true,
  allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Site-Code"],
  exposeHeaders: ["X-Request-Id"],
  maxAge: 600,
});
