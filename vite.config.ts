import { defineConfig } from "vitest/config";

export default defineConfig({
  // Project GitHub Pages: https://ttushka.github.io/Thread/
  // Absolute base keeps assets + ?daily= deep-links working with or without a trailing slash.
  base: "/Thread/",
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
