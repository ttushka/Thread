import { describe, expect, it } from "vitest";
import type { Intent, ObstacleSpec } from "../../types.ts";
import { CLEAN_AWARD, cleanPassAward } from "../score.ts";
import { BEAT_SKIM_MS, beatIntensityFromStreak, beatSkimParticleCount } from "../variant.ts";
import {
  BASE_SPEED,
  DIST,
  FIELD_W,
  GATE_LIP_THICKNESS,
  TENSION_GAIN_LOCK_MS,
  TICK,
} from "../world/constants.ts";
import { beatDistance, beatPeriod, isSkimTiming, msToNearestBeat } from "../world/beat.ts";
import { createWorld, updateWorld } from "../world/simulate.ts";

const hold = (x: number): Intent => ({
  steer: 0,
  pointerActive: true,
  pointerX: x,
  restart: false,
  toTitle: false,
});

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

function skimWall(variant: "control" | "brake" | "beat", time: number) {
  const world = worldWith(variant, 118, []);
  world.course.keyframes = wideCorridor(100, 260);
  world.time = time - TICK;
  updateWorld(world, hold(118), TICK);
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

describe("BEAT-SKIM-MASTERY-v1", () => {
  it("uses the Perfect clock for a ±180ms skim window", () => {
    expect(isSkimTiming(0)).toBe(true);
    expect(isSkimTiming(BEAT_SKIM_MS / 1000)).toBe(true);
    expect(isSkimTiming(BEAT_SKIM_MS / 1000 + 0.001)).toBe(false);
    expect(msToNearestBeat(BEAT_SKIM_MS / 1000)).toBeCloseTo(BEAT_SKIM_MS, 6);
  });

  it("credits beatStreak once when a near-miss starts in the skim window", () => {
    const world = skimWall("beat", 0);
    expect(world.tension).toBe(1);
    expect(world.nearMissTimer).toBeGreaterThan(0);
    expect(world.beatStreak).toBe(1);
    expect(world.beatHeat).toBeCloseTo(beatIntensityFromStreak(1), 8);
    expect(msToNearestBeat(world.time)).toBeLessThanOrEqual(BEAT_SKIM_MS);
  });

  it("ignores a second near-miss on the same beat index", () => {
    const beatT = beatPeriod();
    const firstT = beatT - (BEAT_SKIM_MS / 1000 - 0.02);
    const world = skimWall("beat", firstT);
    expect(world.beatStreak).toBe(1);
    expect(world.tension).toBe(1);

    const wait = Math.ceil(TENSION_GAIN_LOCK_MS / 1000 / TICK) + 2;
    for (let i = 0; i < wait; i++) updateWorld(world, hold(118), TICK);
    expect(world.tension).toBe(2);
    expect(msToNearestBeat(world.time)).toBeLessThanOrEqual(BEAT_SKIM_MS);
    expect(world.beatStreak).toBe(1);
    expect(world.beatHeat).toBeCloseTo(beatIntensityFromStreak(1), 8);
  });

  it("does not double Perfect + skim on the same beat — still +1 total", () => {
    const y = beatDistance() * Math.ceil((DIST.openEnd + 80) / beatDistance());
    const world = worldWith("beat", 118, [onBeatGate(1, y)]);
    world.x = 118;
    world.prevX = 118;
    crossAt(world, y);
    expect(world.cleanPasses).toBe(1);
    expect(world.perfects).toBe(1);
    expect(world.sfx).toContain("tension");
    expect(world.cleanAward).toBe(cleanPassAward(1));
    expect(world.cleanAward).toBeGreaterThan(CLEAN_AWARD);
    expect(world.beatStreak).toBe(1);
    expect(world.beatHeat).toBeCloseTo(beatIntensityFromStreak(1), 8);
  });

  it("does not credit a near-miss outside ±180ms", () => {
    const world = skimWall("beat", BEAT_SKIM_MS / 1000 + 0.02);
    expect(world.tension).toBe(1);
    expect(world.nearMissTimer).toBeGreaterThan(0);
    expect(world.beatStreak).toBe(0);
    expect(world.beatHeat).toBe(0);
    expect(msToNearestBeat(world.time)).toBeGreaterThan(BEAT_SKIM_MS);
  });

  it("leaves Control and Brake streak/heat untouched", () => {
    for (const variant of ["control", "brake"] as const) {
      const world = skimWall(variant, 0);
      expect(world.tension).toBe(1);
      expect(world.beatStreak).toBe(0);
      expect(world.beatHeat).toBe(0);
      expect(world.perfects).toBe(0);
    }
  });

  it("scales near-miss juice with current heat without changing physics", () => {
    const cold = worldWith("beat", 118, []);
    cold.reducedMotion = false;
    cold.course.keyframes = wideCorridor(100, 260);
    cold.time = BEAT_SKIM_MS / 1000 + 0.02 - TICK;
    updateWorld(cold, hold(118), TICK);
    expect(cold.beatStreak).toBe(0);
    expect(cold.particles).toHaveLength(beatSkimParticleCount(0));
    expect(cold.particles.every((p) => !p.ink)).toBe(true);

    const hot = worldWith("beat", 118, []);
    hot.reducedMotion = false;
    hot.course.keyframes = wideCorridor(100, 260);
    hot.beatStreak = 8;
    hot.beatHeat = 1;
    hot.time = BEAT_SKIM_MS / 1000 + 0.02 - TICK;
    updateWorld(hot, hold(118), TICK);
    expect(hot.beatStreak).toBe(8);
    expect(hot.particles).toHaveLength(beatSkimParticleCount(1));
    expect(hot.particles.filter((p) => p.ink).length).toBe(4);
    expect(hot.particles.filter((p) => !p.ink).length).toBe(4);
    expect(hot.distance).toBeCloseTo(cold.distance, 8);
    expect(hot.x).toBeCloseTo(cold.x, 8);

    const control = worldWith("control", 118, []);
    control.reducedMotion = false;
    control.course.keyframes = wideCorridor(100, 260);
    control.time = BEAT_SKIM_MS / 1000 + 0.02 - TICK;
    updateWorld(control, hold(118), TICK);
    expect(control.particles).toHaveLength(beatSkimParticleCount(0));
    expect(control.beatStreak).toBe(0);
    expect(control.distance).toBeCloseTo(cold.distance, 8);
  });
});
