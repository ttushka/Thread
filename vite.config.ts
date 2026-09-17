import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages project site: https://ttushka.github.io/Thread/
  // Absolute /Thread/ keeps Pages assets + ?daily= deep-links working with or without a trailing slash.
  // itch.io serves the ZIP from a nested iframe URL — `npm run build:itch` sets VITE_BASE=./
  // (and `vite --base ./`) so JS/CSS/favicon are relative, not /Thread/.
  base: process.env.VITE_BASE ?? "/Thread/",
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
