import { describe, expect, it, vi } from "vitest";
import dailyStream from "../__fixtures__/daily-stream-2026-09-17.json";
import { generateCourse, streamEvents } from "../world/course.ts";
import { dailySeed } from "../seed.ts";
import { createWorld, updateWorld } from "../world/simulate.ts";
import { TICK } from "../world/constants.ts";
import type { Intent } from "../../types.ts";

const idle: Intent = {
  steer: 0,
  pointerActive: false,
  pointerX: 180,
  restart: false,
  toTitle: false,
};

describe("Daily course stream", () => {
  it("does not call Math.random on the Daily path", () => {
    const spy = vi.spyOn(Math, "random");
    generateCourse(dailySeed("2026-09-17"), { daily: true });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("replays the same first-K events for the same UTC day", () => {
    const seed = dailySeed("2026-09-17");
    const a = streamEvents(generateCourse(seed, { daily: true }), 16);
    const b = streamEvents(generateCourse(seed, { daily: true }), 16);
    expect(a).toEqual(b);
    expect(a).toEqual(dailyStream.events);
  });

  it("diverges across UTC days", () => {
    const a = streamEvents(generateCourse(dailySeed("2026-09-17"), { daily: true }), 8);
    const b = streamEvents(generateCourse(dailySeed("2026-09-18"), { daily: true }), 8);
    expect(a).not.toEqual(b);
  });

  it("matches with an injected Endless seed (shared generator path)", () => {
    const seed = 0x4eadc0de;
    const a = streamEvents(generateCourse(seed, { daily: false, endlessHorizon: 2200 }), 8);
    const b = streamEvents(generateCourse(seed, { daily: false, endlessHorizon: 2200 }), 8);
    expect(a).toEqual(b);
  });
});

describe("simulation fairness", () => {
  it("keeps two Daily sims with the same input identical", () => {
    const seed = dailySeed("2026-09-17");
    const wa = createWorld(seed, { daily: true, reducedMotion: true });
    const wb = createWorld(seed, { daily: true, reducedMotion: true });
    const intent: Intent = { ...idle, steer: 1 };
    for (let i = 0; i < 180; i++) {
      updateWorld(wa, intent, TICK);
      updateWorld(wb, intent, TICK);
    }
    expect(wa.distance).toBe(wb.distance);
    expect(wa.x).toBe(wb.x);
    expect(wa.cleanPasses).toBe(wb.cleanPasses);
    expect(wa.alive).toBe(wb.alive);
  });
});
