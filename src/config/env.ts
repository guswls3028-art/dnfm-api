import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL required"),
  // DB TLS 강제. EC2 동거 PostgreSQL 처럼 ssl unsupported 인 경우 "false" (default).
  // RDS / Cloud SQL 처럼 ssl 강제 환경에선 "true".
  DATABASE_SSL: z.string().optional().default("false"),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  COOKIE_DOMAIN: z.string().min(1).default(".dnfm.kr"),
  COOKIE_SECURE: z
    .string()
    .transform((v) => v === "true")
    .default("false"),

  CORS_ORIGINS: z
    .string()
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .default(""),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(4).default(4),

  R2_ENDPOINT: z.string().url().optional().or(z.literal("")),
  R2_REGION: z.string().default("auto"),
  R2_ACCESS_KEY_ID: z.string().default(""),
  R2_SECRET_ACCESS_KEY: z.string().default(""),
  R2_BUCKET: z.string().default("dnfm-uploads"),
  R2_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  // R2 public base URL — Cloudflare R2 public dev URL (https://pub-XXXX.r2.dev) 또는 커스텀 도메인.
  // 비면 publicUrl 미반환 — 클라가 r2Key 만 받고 다른 경로로 노출해야 함.
  R2_PUBLIC_BASE: z.string().optional().default(""),

  ALLOWED_SITES: z
    .string()
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .default("newb,allow"),

  // 던파 OCR — Gemini Flash 가 1순위 (~10배 저렴), Vision 은 fallback
  GEMINI_API_KEY: z.string().optional().default(""),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional().default(""),
  GOOGLE_VISION_API_KEY: z.string().optional().default(""),

  // OAuth (Stage 2)
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional().default(""),
  KAKAO_OAUTH_CLIENT_ID: z.string().optional().default(""),
  KAKAO_OAUTH_CLIENT_SECRET: z.string().optional().default(""),
  KAKAO_OAUTH_REDIRECT_URI: z.string().optional().default(""),
});

export type AppEnv = z.infer<typeof envSchema>;

function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.format();
    console.error("[env] invalid environment variables");
    console.error(JSON.stringify(formatted, null, 2));
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";
