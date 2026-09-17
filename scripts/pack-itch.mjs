#!/usr/bin/env node
/**
 * Zip dist/ contents so index.html sits at the archive root (itch.io HTML5).
 * Do not wrap files in a nested folder — itch looks for /index.html in the ZIP.
 */
import { existsSync, readFileSync, unlinkSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const dist = join(root, "dist");
const indexPath = join(dist, "index.html");
const zipPath = join(root, "thread-itch.zip");

if (!existsSync(indexPath)) {
  console.error("Missing dist/index.html. Run `vite build --base ./` first.");
  process.exit(1);
}

const html = readFileSync(indexPath, "utf8");
if (/["']\/Thread\//.test(html) || /(?:src|href)=["']\/(?!\/)/.test(html)) {
  console.error(
    "itch index.html has absolute asset paths. Vite base must be `./` so the itch iframe can load JS/CSS.",
  );
  process.exit(1);
}
if (!/\.\/assets\//.test(html) && !/\.\/favicon/.test(html)) {
  console.error("itch index.html does not look like a relative Vite build (expected ./assets or ./favicon).");
  process.exit(1);
}

if (existsSync(zipPath)) unlinkSync(zipPath);

const py = `
from pathlib import Path
import zipfile
import sys

dist = Path(${JSON.stringify(dist)})
zip_path = Path(${JSON.stringify(zipPath)})
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    for path in sorted(dist.rglob("*")):
        if path.is_file():
            zf.write(path, path.relative_to(dist).as_posix())
names = zipfile.ZipFile(zip_path).namelist()
if "index.html" not in names:
    sys.exit("ZIP must contain index.html at the root, not inside a folder")
if any(name.startswith("dist/") for name in names):
    sys.exit("ZIP must zip dist/ contents, not the dist folder itself")
print("\\n".join(names))
`;

const packed = spawnSync("python3", ["-c", py], { encoding: "utf8" });
if (packed.status !== 0) {
  process.stderr.write(packed.stderr || packed.stdout || "zip failed\n");
  process.exit(packed.status ?? 1);
}

const names = packed.stdout.trim().split("\n").filter(Boolean);
const bytes = statSync(zipPath).size;
console.log(`Wrote ${relative(root, zipPath) || "thread-itch.zip"} (${bytes} bytes)`);
for (const name of names) console.log(`  ${name}`);
