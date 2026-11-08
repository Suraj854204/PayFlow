import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    // Webhook deliveries time out after 10 s, and CI runners have real (sometimes unroutable) networks.
    testTimeout: 30_000,
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.int.test.ts",
    ],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/db/**", "src/lib/auth/**", "src/lib/env.ts"],
      // Measured with the database tests running (TEST_DATABASE_URL set); without them the number is lower.
      thresholds: { statements: 80, lines: 80, functions: 75, branches: 60 },
    },
  },
});
