import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "@/config/env.js";
import { drizzle } from "drizzle-orm/postgres-js";
import { logger } from "@/config/logger.js";

async function main() {
  const client = postgres(env.DATABASE_URL, {
    max: 1,
    ssl: env.DATABASE_SSL === "true" ? "require" : false,
  });
  const db = drizzle(client);
  logger.info("running migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  logger.info("migrations applied");
  await client.end();
}

main().catch((err) => {
  logger.error({ err }, "migration failed");
  process.exit(1);
});
