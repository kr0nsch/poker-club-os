import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    environment: "node",
    globalSetup: ["./global-setup.ts"],
    // Each file runs its own edge stack (API + worker processes); keep them sequential.
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 120_000,
  },
});
