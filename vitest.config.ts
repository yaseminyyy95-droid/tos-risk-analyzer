import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      reporter: ["text-summary", "text"],
    },
  },
});
