import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * vitest config — DB 없는 pure unit 우선.
 * DB / integration smoke 는 `*.integration.test.ts` 로 분리해 향후 추가.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
    environment: "node",
    globals: false,
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
