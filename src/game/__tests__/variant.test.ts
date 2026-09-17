import { describe, expect, it } from "vitest";
import { Game } from "../Game.ts";
import { parseVariant, VARIANT_TEACH, EXPERIMENT_TEACH_COPY, inRunTeachOpacity } from "../variant.ts";
import { dailySeed, SEED_VERSION } from "../seed.ts";
import { generateCourse, streamEvents } from "../world/course.ts";
import dailyStream from "../__fixtures__/daily-stream-2026-09-17.json";
import titleHtml from "../../../index.html?raw";

const CONTROL_TEACH = "Steer through the lips. Don’t touch the walls.";
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

  it("accepts brake, beat, and lanes, including with daily", () => {
    expect(parseVariant("?variant=brake")).toBe("brake");
    expect(parseVariant("?variant=beat")).toBe("beat");
    expect(parseVariant("?variant=lanes")).toBe("lanes");
    expect(parseVariant("?daily=2026-09-17&variant=beat")).toBe("beat");
  });

  it("locks Design teach copy for every live variant", () => {
    expect(VARIANT_TEACH.control).toBe(CONTROL_TEACH);
    expect(EXPERIMENT_TEACH_COPY.control).toBe(CONTROL_TEACH);
    expect(VARIANT_TEACH.brake).toBe("Hold Brake (or Space) to slow. Steer the gaps.");
    expect(VARIANT_TEACH.beat).toBe("Thread each lip on the pulse. Works with click off.");
    expect(VARIANT_TEACH.lanes).toBe("Swipe or tap sides to change lane. Stay in the open one.");
  });

  it("uses Design-locked Control teach on a bare URL and Control chip", () => {
    expect(innerById(titleHtml, "experiment-teach")).toBe(VARIANT_TEACH.control);
    expect(innerById(titleHtml, "title-hint")).toBe(VARIANT_TEACH.control);
    expect(titleHtml).not.toContain(LEGACY_GENERIC_HELPER);
    expect(titleHtml).toMatch(/id="chip-control"[^>]*\bactive\b|class="chip active"[^>]*id="chip-control"/);

    const game = new Game(null);
    expect(parseVariant("")).toBe("control");
    expect(game.variant).toBe("control");
    expect(game.snapshot().teach).toBe(VARIANT_TEACH.control);

    game.setVariant("brake");
    expect(game.snapshot().teach).toBe(VARIANT_TEACH.brake);
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

describe("control path isolation", () => {
  it("does not bump SEED_VERSION", () => {
    expect(SEED_VERSION).toBe(2);
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
