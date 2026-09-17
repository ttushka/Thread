import { describe, expect, it } from "vitest";
import { createWorld, updateWorld, worldScore } from "../world/simulate.ts";
import { TICK } from "../world/constants.ts";
import type { Intent } from "../../types.ts";

const hold = (steer: number): Intent => ({
  steer,
  pointerActive: false,
  pointerX: 180,
  restart: false,
  toTitle: false,
});

describe("combo", () => {
  it("clears on nick or death and scores from the peak", () => {
    const world = createWorld(0xc0ffee, {
      daily: false,
      reducedMotion: true,
      endlessHorizon: 2500,
    });
    for (let i = 0; i < 60 * 12; i++) {
      updateWorld(world, hold(0), TICK);
      if (world.combo >= 1) break;
    }
    expect(world.alive).toBe(true);
    expect(world.combo).toBeGreaterThanOrEqual(1);
    const peakBefore = world.comboPeak;

    world.x = 8;
    world.prevX = 8;
    for (let i = 0; i < 12; i++) {
      updateWorld(world, hold(-1), TICK);
      if (world.combo === 0) break;
    }
    expect(world.combo).toBe(0);
    expect(world.comboPeak).toBe(peakBefore);
    expect(worldScore(world)).toBe(
      Math.floor(world.distance) + world.cleanPasses * 50 + world.comboPeak * 25,
    );
  });
});
