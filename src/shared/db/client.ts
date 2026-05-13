import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env, isProd } from "@/config/env.js";

const queryClient = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: false,
  ssl: isProd ? "require" : undefined,
});

export const db = drizzle(queryClient);
export type DB = typeof db;

export async function closeDb(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
