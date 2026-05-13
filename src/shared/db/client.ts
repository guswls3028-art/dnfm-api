import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/config/env.js";

const queryClient = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: false,
  // ssl 은 env.DATABASE_SSL 로 명시 제어. NODE_ENV=production 으로 자동 강제하면
  // EC2 동거 PostgreSQL 처럼 ssl unsupported 환경에서 ECONNRESET 으로 깨짐.
  ssl: env.DATABASE_SSL === "true" ? "require" : false,
});

export const db = drizzle(queryClient);
export type DB = typeof db;

export async function closeDb(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
