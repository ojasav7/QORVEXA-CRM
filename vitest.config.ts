import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["server/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["server/lib/**/*.ts"],
      exclude: ["server/lib/integrations/**"],
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
