import { describe, expect, it } from "vitest";
import type { Intent, ObstacleSpec } from "../../types.ts";
import { BEAT_COOL_MS, beatIntensityFromStreak } from "../variant.ts";
import { BASE_SPEED, DIST, FIELD_W, GATE_LIP_THICKNESS, TICK } from "../world/constants.ts";
import { beatDistance } from "../world/beat.ts";
import { createWorld, updateWorld } from "../world/simulate.ts";

const idle: Intent = {
  steer: 0,
  pointerActive: false,
  pointerX: 180,
  restart: false,
  toTitle: false,
};

function wideCorridor(left = 16, right = FIELD_W - 16) {
  return [
    { y: 0, left, right, gateId: null },
    { y: 8000, left, right, gateId: null },
  ];
}

function gateSpec(partial: Partial<ObstacleSpec> = {}): ObstacleSpec {
  return {
    id: 1,
    kind: "gate",
    y: DIST.openEnd + 80,
    left: 70,
    right: 190,
    thickness: GATE_LIP_THICKNESS,
    baseCenter: 130,
    gapWidth: 120,
    amplitude: 0,
    period: 1,
    phase: 0,
    ...partial,
  };
}

function worldWith(variant: "control" | "brake" | "beat", x: number, gates: ObstacleSpec[]) {
  const world = createWorld(1, { daily: true, reducedMotion: true, variant });
  world.course.keyframes = wideCorridor();
  world.obstacles = gates.map((g) => ({ ...g, passed: false, nicked: false }));
  world.distance = DIST.openEnd + 4;
  world.prevDistance = world.distance;
  world.x = x;
  world.prevX = x;
  return world;
}

function onBeatGate(id: number, y: number): ObstacleSpec {
  return gateSpec({ id, y, left: 100, right: 260, baseCenter: 180, gapWidth: 160 });
}

function crossAt(world: ReturnType<typeof createWorld>, y: number, extra: Partial<Intent> = {}): void {
  world.time = y / BASE_SPEED - TICK;
  world.distance = y - BASE_SPEED * TICK * 0.5;
  world.prevDistance = world.distance - BASE_SPEED * TICK;
  updateWorld(world, { ...idle, touchScoring: false, ...extra }, TICK);
}

describe("BEAT-STREAK-INTENSITY-v1", () => {
  it("heats from consecutive Perfects and caps at streak 8", () => {
    const step = beatDistance();
    const y0 = step * Math.ceil((DIST.openEnd + 80) / step);
    const world = worldWith("beat", 180, [onBeatGate(1, y0), onBeatGate(2, y0 + step)]);
    crossAt(world, y0);
    expect(world.cleanPasses).toBe(1);
    expect(world.perfects).toBe(1);
    expect(world.beatStreak).toBe(1);
    expect(world.beatHeat).toBeCloseTo(beatIntensityFromStreak(1), 8);

    world.obstacles[1]!.passed = false;
    crossAt(world, y0 + step);
    expect(world.perfects).toBe(2);
    expect(world.beatStreak).toBe(2);
    expect(world.beatHeat).toBeCloseTo(0.25, 8);

    world.beatStreak = 7;
    world.beatHeat = beatIntensityFromStreak(7);
    const y2 = y0 + step * 8;
    world.obstacles.push({ ...onBeatGate(3, y2), passed: false, nicked: false });
    crossAt(world, y2);
    expect(world.beatStreak).toBe(8);
    expect(world.beatHeat).toBe(1);

    world.obstacles.push({ ...onBeatGate(4, y2 + step), passed: false, nicked: false });
    crossAt(world, y2 + step);
    expect(world.beatStreak).toBe(8);
    expect(world.beatHeat).toBe(1);
  });

  it("cools to baseline within 400ms after an off-beat clear", () => {
    const y = beatDistance() * Math.ceil((DIST.openEnd + 80) / beatDistance());
    const world = worldWith("beat", 180, [onBeatGate(1, y)]);
    world.beatStreak = 8;
    world.beatHeat = 1;
    world.time = y / BASE_SPEED + 0.11 - TICK;
    world.distance = y - BASE_SPEED * TICK * 0.5;
    world.prevDistance = world.distance - BASE_SPEED * TICK;
    updateWorld(world, { ...idle, touchScoring: false, pointerActive: false }, TICK);
    expect(world.cleanPasses).toBe(1);
    expect(world.perfects).toBe(0);
    expect(world.beatStreak).toBe(0);
    expect(world.beatHeat).toBeGreaterThan(0);
    expect(world.beatHeat).toBeLessThan(1);

    const coolTicks = Math.ceil(BEAT_COOL_MS / 1000 / TICK) + 1;
    for (let i = 0; i < coolTicks; i++) updateWorld(world, idle, TICK);
    expect(world.beatHeat).toBe(0);
    expect(world.time).toBeGreaterThanOrEqual(BEAT_COOL_MS / 1000 - TICK);
  });

  it("breaks the streak on a wall nick and does not change speed/gap", () => {
    const world = worldWith("beat", 108, []);
    world.beatStreak = 6;
    world.beatHeat = beatIntensityFromStreak(6);
    world.course.keyframes = wideCorridor(100, 260);
    updateWorld(world, { ...idle, pointerActive: true, pointerX: 108 }, TICK);
    expect(world.nickTimer).toBeGreaterThan(0);
    expect(world.beatStreak).toBe(0);
    expect(world.alive).toBe(true);

    const heated = worldWith("beat", 180, []);
    heated.beatStreak = 8;
    heated.beatHeat = 1;
    const cold = worldWith("beat", 180, []);
    updateWorld(heated, idle, TICK);
    updateWorld(cold, idle, TICK);
    expect(heated.distance).toBeCloseTo(cold.distance, 8);
    expect(heated.x).toBeCloseTo(cold.x, 8);
  });

  it("leaves Control and Brake heat at zero", () => {
    for (const variant of ["control", "brake"] as const) {
      const y = beatDistance() * Math.ceil((DIST.openEnd + 80) / beatDistance());
      const world = worldWith(variant, 180, [onBeatGate(1, y)]);
      crossAt(world, y);
      expect(world.cleanPasses).toBe(1);
      expect(world.beatStreak).toBe(0);
      expect(world.beatHeat).toBe(0);
      expect(world.perfects).toBe(0);
    }
  });

  it("keeps reduced-motion audio heat without changing collision", () => {
    const y = beatDistance() * Math.ceil((DIST.openEnd + 80) / beatDistance());
    const world = worldWith("beat", 180, [onBeatGate(1, y)]);
    expect(world.reducedMotion).toBe(true);
    crossAt(world, y);
    expect(world.beatStreak).toBe(1);
    expect(world.beatHeat).toBeCloseTo(0.125, 8);
    expect(world.particles).toHaveLength(0);
  });
});
