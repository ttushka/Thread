import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dailySeed, dailySeedInput, SEED_VERSION } from "../seed.ts";
import { mulberry32 } from "../rng.ts";
import { generateCourse, streamEvents } from "../world/course.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const dateKey = "2026-09-17";
const seed = dailySeed(dateKey);

writeFileSync(
  join(dir, "daily-seed.json"),
  JSON.stringify(
    {
      dateKey,
      seedVersion: SEED_VERSION,
      input: dailySeedInput(dateKey),
      seed,
      [dateKey]: seed,
    },
    null,
    2,
  ) + "\n",
);

const prngSeed = 2463534242;
const next = mulberry32(prngSeed);
const seq = Array.from({ length: 8 }, () => next());
writeFileSync(
  join(dir, "prng.json"),
  JSON.stringify({ seed: prngSeed, seq }, null, 2) + "\n",
);

const events = streamEvents(generateCourse(seed, { daily: true }), 16);
writeFileSync(
  join(dir, "daily-stream-2026-09-17.json"),
  JSON.stringify(
    {
      dateKey,
      seedVersion: SEED_VERSION,
      seed,
      note: "SEED_VERSION / content change: bump SEED_VERSION when regenerating this file.",
      events,
    },
    null,
    2,
  ) + "\n",
);

console.log("goldens written", { seed, events: events.length });
