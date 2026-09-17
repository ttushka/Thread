import { describe, expect, it } from "vitest";
import { parseVariant, VARIANT_TEACH } from "../variant.ts";
import { dailySeed, SEED_VERSION } from "../seed.ts";
import { generateCourse, streamEvents } from "../world/course.ts";
import dailyStream from "../__fixtures__/daily-stream-2026-09-17.json";

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

  it("has a teach line for every live variant", () => {
    expect(VARIANT_TEACH.brake).toMatch(/slow/i);
    expect(VARIANT_TEACH.beat).toMatch(/beat/i);
    expect(VARIANT_TEACH.lanes).toMatch(/lanes/i);
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
