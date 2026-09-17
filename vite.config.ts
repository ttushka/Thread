import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: {
    sourcemap: false,
    target: "es2022",
    assetsInlineLimit: 4096,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
