import { describe, expect, it } from "vitest";
import { Game } from "../Game.ts";
import {
  parseVariant,
  VARIANT_TEACH,
  EXPERIMENT_TEACH_COPY,
  inRunTeachOpacity,
  PICKER_VARIANT_KEYS,
  BEAT_STREAK_CAP,
  BEAT_COOL_MS,
  BEAT_PULSE_SCALE_MAX,
  BEAT_GLOW_BLUR_MAX,
  BEAT_BED_BOOST_DB,
  BEAT_SKIM_MS,
  BEAT_SKIM_EARLY_MS,
  BEAT_SKIM_FORGIVE_STREAK,
  beatIntensityFromStreak,
  beatBedGain,
  beatSkimParticleCount,
  beatSkimScale,
} from "../variant.ts";
import { dailySeed, SEED_VERSION } from "../seed.ts";
import { generateCourse, streamEvents } from "../world/course.ts";
import dailyStream from "../__fixtures__/daily-stream-2026-09-17.json";
import titleHtml from "../../../index.html?raw";

const CONTROL_TEACH = "Skim the edge \u2014 that\u2019s the craft.";
const LEGACY_GENERIC_HELPER = "Steer with A/D or arrows";

function innerById(html: string, id: string): string {
  const match = html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</p>`));
  return (match?.[1] ?? "").trim();
}

describe("parseVariant", () => {
  it("defaults omitted, control, and dead keys to control", () => {
    expect(parseVariant("")).toBe("control");
    expect(parseVariant("?mode=endless")).toBe("control");
    expect(parseVariant("?variant=control")).toBe("control");
    expect(parseVariant("?variant=ghost")).toBe("control");
    expect(parseVariant("?variant=pulse")).toBe("control");
    expect(parseVariant("?variant=mirror")).toBe("control");
    expect(parseVariant("?variant=nope")).toBe("control");
  });

  it("accepts brake and beat, and maps lanes (and other dead keys) to control", () => {
    expect(parseVariant("?variant=brake")).toBe("brake");
    expect(parseVariant("?variant=beat")).toBe("beat");
    expect(parseVariant("?variant=lanes")).toBe("control");
    expect(parseVariant("?daily=2026-09-17&variant=beat")).toBe("beat");
    expect(parseVariant("?daily=2026-09-17&variant=lanes")).toBe("control");
  });

  it("locks Design teach copy for every live variant", () => {
    expect(VARIANT_TEACH.control).toBe(CONTROL_TEACH);
    expect(EXPERIMENT_TEACH_COPY.control).toBe(CONTROL_TEACH);
    expect(VARIANT_TEACH.brake).toBe("Hold Brake (or Space) to slow. Steer the gaps.");
    expect(VARIANT_TEACH.beat).toBe("Skim the wall on the pulse \u2014 that\u2019s the craft. Click optional.");
    expect(VARIANT_TEACH.lanes).toBe("Swipe or tap sides to change lane. Stay in the open one.");
  });

  it("uses Design-locked Control teach on a bare URL and Control chip", () => {
    expect(innerById(titleHtml, "experiment-teach")).toBe(VARIANT_TEACH.control);
    expect(innerById(titleHtml, "title-hint")).toBe(VARIANT_TEACH.control);
    expect(titleHtml).not.toContain(LEGACY_GENERIC_HELPER);
    expect(titleHtml).toMatch(/id="chip-control"[^>]*\bactive\b|class="chip active"[^>]*id="chip-control"/);
    expect(titleHtml).not.toMatch(/id="chip-lanes"/);
    expect(titleHtml).not.toMatch(/data-variant="lanes"/);
    expect(titleHtml).not.toMatch(/>Lanes</);
    expect([...PICKER_VARIANT_KEYS]).toEqual(["control", "brake", "beat"]);

    const game = new Game(null);
    expect(parseVariant("")).toBe("control");
    expect(game.variant).toBe("control");
    expect(game.snapshot().teach).toBe(VARIANT_TEACH.control);

    game.setVariant("brake");
    expect(game.snapshot().teach).toBe(VARIANT_TEACH.brake);
    game.setVariant("beat");
    expect(game.snapshot().teach).toBe(VARIANT_TEACH.beat);
    game.setVariant("control");
    expect(game.snapshot().teach).toBe(VARIANT_TEACH.control);
  });

  it("holds in-run teach for 4s then fades", () => {
    expect(inRunTeachOpacity(0)).toBe(1);
    expect(inRunTeachOpacity(4)).toBe(1);
    expect(inRunTeachOpacity(4.25)).toBeCloseTo(0.5, 5);
    expect(inRunTeachOpacity(4.5)).toBe(0);
    expect(inRunTeachOpacity(8)).toBe(0);
  });
});

describe("BEAT-STREAK-INTENSITY-v1 tokens", () => {
  it("locks streak cap, cool window, and feedback caps", () => {
    expect(BEAT_STREAK_CAP).toBe(8);
    expect(beatIntensityFromStreak(0)).toBe(0);
    expect(beatIntensityFromStreak(4)).toBe(0.5);
    expect(beatIntensityFromStreak(8)).toBe(1);
    expect(beatIntensityFromStreak(99)).toBe(1);
    expect(BEAT_COOL_MS).toBeLessThanOrEqual(400);
    expect(BEAT_PULSE_SCALE_MAX).toBeLessThanOrEqual(1.18);
    expect(BEAT_GLOW_BLUR_MAX).toBeLessThanOrEqual(20);
    expect(BEAT_BED_BOOST_DB).toBeLessThanOrEqual(6);
    expect(beatBedGain(0.42, 0)).toBeCloseTo(0.42, 8);
    expect(beatBedGain(0.42, 1) / 0.42).toBeCloseTo(10 ** (BEAT_BED_BOOST_DB / 20), 8);
    expect(beatBedGain(0.42, 1) / 0.42).toBeLessThanOrEqual(10 ** (6 / 20) + 1e-9);
  });
});

describe("BEAT-SKIM-MASTERY-v1 tokens", () => {
  it("locks the on-pulse skim window and teal/ink spark counts", () => {
    expect(BEAT_SKIM_MS).toBe(180);
    expect(BEAT_SKIM_EARLY_MS).toBe(240);
    expect(BEAT_SKIM_FORGIVE_STREAK).toBe(3);
    expect(beatSkimParticleCount(0)).toBe(4);
    expect(beatSkimParticleCount(0.5)).toBe(6);
    expect(beatSkimParticleCount(1)).toBe(8);
    expect(beatSkimScale(0)).toBe(1);
    expect(beatSkimScale(1)).toBe(BEAT_PULSE_SCALE_MAX);
    expect(beatSkimScale(1)).toBeLessThanOrEqual(1.18);
  });
});

describe("control path isolation", () => {
  it("locks SEED_VERSION for the control generator", () => {
    expect(SEED_VERSION).toBe(3);
  });

  it("keeps Daily goldens when variant is omitted or control", () => {
    const seed = dailySeed("2026-09-17");
    const a = streamEvents(generateCourse(seed, { daily: true }), 16);
    const b = streamEvents(generateCourse(seed, { daily: true, variant: "control" }), 16);
    const c = streamEvents(generateCourse(seed, { daily: true, variant: "brake" }), 16);
    expect(a).toEqual(dailyStream.events);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
});
