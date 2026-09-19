import { describe, expect, it } from "vitest";
import { createWorld, skimJuice, updateWorld, worldScore } from "../world/simulate.ts";
import { CLEAN_AWARD, cleanPassAward } from "../score.ts";
import { DIST, FIELD_W, GATE_LIP_THICKNESS, NEAR_MISS_MS, TICK } from "../world/constants.ts";
import type { Intent, ObstacleSpec } from "../../types.ts";

const hold = (x: number): Intent => ({
  steer: 0,
  pointerActive: true,
  pointerX: x,
  restart: false,
  toTitle: false,
});

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

function worldWithGates(x: number, gates: ObstacleSpec[]) {
  const world = createWorld(1, { daily: true, reducedMotion: true });
  world.course.keyframes = wideCorridor();
  world.obstacles = gates.map((g) => ({ ...g, passed: false, nicked: false }));
  world.distance = DIST.openEnd + 4;
  world.prevDistance = world.distance;
  world.x = x;
  world.prevX = x;
  return world;
}

function tickUntil(
  world: ReturnType<typeof createWorld>,
  x: number,
  pred: () => boolean,
  cap = 120,
): void {
  for (let i = 0; i < cap; i++) {
    updateWorld(world, hold(x), TICK);
    if (pred()) return;
  }
}

describe("combo", () => {
  it("keeps combo on nick and scores from the peak", () => {
    const first = gateSpec({ id: 1, y: DIST.openEnd + 40 });
    const second = gateSpec({ id: 2, y: DIST.openEnd + 140, left: 170, right: 290, baseCenter: 230 });
    const mid = (first.left + first.right) / 2;
    const world = worldWithGates(mid, [first, second]);
    tickUntil(world, mid, () => world.obstacles[0]!.passed);
    expect(world.alive).toBe(true);
    expect(world.combo).toBe(1);
    const peakBefore = world.comboPeak;

    const nickX = second.left + 6;
    tickUntil(world, nickX, () => world.obstacles[1]!.passed || !world.alive);
    expect(world.alive).toBe(true);
    expect(world.obstacles[1]!.nicked).toBe(true);
    expect(world.combo).toBe(1);
    expect(world.comboPeak).toBe(peakBefore);
    expect(world.nickTimer).toBeGreaterThan(0);
    expect(worldScore(world)).toBe(
      Math.floor(world.distance) + world.cleanAward + world.comboPeak * 25,
    );
  });

  it("increments combo on a clean gate after a nick", () => {
    const first = gateSpec({ id: 1, y: DIST.openEnd + 40 });
    const second = gateSpec({ id: 2, y: DIST.openEnd + 180 });
    const nickX = first.left + 6;
    const world = worldWithGates(nickX, [first, second]);
    tickUntil(world, nickX, () => world.obstacles[0]!.passed);
    expect(world.alive).toBe(true);
    expect(world.obstacles[0]!.nicked).toBe(true);
    expect(world.cleanPasses).toBe(0);
    expect(world.combo).toBe(0);
    expect(world.nickTimer).toBeGreaterThan(0);

    const cleanX = (second.left + second.right) / 2;
    tickUntil(world, cleanX, () => world.obstacles[1]!.passed || !world.alive, 180);
    expect(world.alive).toBe(true);
    expect(world.obstacles[1]!.nicked).toBe(false);
    expect(world.cleanPasses).toBe(1);
    expect(world.combo).toBe(1);
    expect(world.cleanAward).toBe(CLEAN_AWARD);
  });

  it("clears combo on death and keeps comboPeak", () => {
    const gate = gateSpec();
    const mid = (gate.left + gate.right) / 2;
    const world = worldWithGates(mid, [gate]);
    tickUntil(world, mid, () => world.combo >= 1);
    expect(world.combo).toBe(1);
    const peakBefore = world.comboPeak;

    tickUntil(world, 8, () => !world.alive);
    expect(world.alive).toBe(false);
    expect(world.combo).toBe(0);
    expect(world.comboPeak).toBe(peakBefore);
    expect(world.tension).toBe(0);
  });
});

describe("tension", () => {
  it("stacks on a near-miss then multiplies the next Clean Pass award", () => {
    const near = gateSpec({ id: 1, y: DIST.openEnd + 50 });
    const clean = gateSpec({
      id: 2,
      y: DIST.openEnd + 180,
      left: 170,
      right: 290,
      baseCenter: 230,
    });
    // innerL = 75; nick < 8px; near-miss 8–20px inside the inner edge.
    const nearX = near.left + 5 + 14;
    const world = worldWithGates(nearX, [near, clean]);
    tickUntil(world, nearX, () => world.obstacles[0]!.passed);
    expect(world.alive).toBe(true);
    expect(world.obstacles[0]!.nicked).toBe(false);
    expect(world.cleanPasses).toBe(1);
    expect(world.combo).toBe(1);
    expect(world.tension).toBe(0);
    expect(world.cleanAward).toBe(cleanPassAward(1));

    const cleanX = (clean.left + clean.right) / 2;
    tickUntil(world, cleanX, () => world.obstacles[1]!.passed);
    expect(world.cleanPasses).toBe(2);
    expect(world.combo).toBe(2);
    expect(world.cleanAward).toBe(cleanPassAward(1) + CLEAN_AWARD);
    expect(world.tension).toBe(0);
  });

  it("does not clear Tension on nick", () => {
    const first = gateSpec({ id: 1, y: DIST.openEnd + 50 });
    const second = gateSpec({ id: 2, y: DIST.openEnd + 160 });
    const world = worldWithGates(130, [first, second]);
    world.tension = 2;
    world.tensionTimer = 1.2;
    const nickX = first.left + 6;
    tickUntil(world, nickX, () => world.obstacles[0]!.passed || !world.alive);
    expect(world.alive).toBe(true);
    expect(world.obstacles[0]!.nicked).toBe(true);
    expect(world.tension).toBe(2);
    expect(world.combo).toBe(0);
  });

  it("clears Tension on death", () => {
    const world = worldWithGates(180, []);
    world.course.keyframes = wideCorridor(100, 260);
    world.tension = 3;
    world.tensionTimer = 1.2;
    tickUntil(world, 8, () => !world.alive);
    expect(world.alive).toBe(false);
    expect(world.combo).toBe(0);
    expect(world.tension).toBe(0);
  });

  it("caps Tension at 3 and rate-limits gains", () => {
    const world = worldWithGates(118, []);
    world.course.keyframes = wideCorridor(100, 260);
    // innerL = 105; nick to 113; near-miss to 125. x=118 is a wall near-miss.
    updateWorld(world, hold(118), TICK);
    expect(world.tension).toBe(1);
    const firstPulseAt = world.time;
    for (let i = 0; i < 10; i++) updateWorld(world, hold(118), TICK);
    expect(world.tension).toBe(1);
    tickUntil(world, 118, () => world.tension >= 2, 20);
    expect(world.tension).toBe(2);
    expect(world.time - firstPulseAt).toBeGreaterThanOrEqual(0.2 - 1e-6);
    for (let i = 0; i < 80; i++) updateWorld(world, hold(118), TICK);
    expect(world.tension).toBe(3);
    expect(world.alive).toBe(true);
  });

  it("keeps Tension and near-miss juice when a skim cashes a Clean Pass", () => {
    const gate = gateSpec({ id: 1, y: DIST.openEnd + 80 });
    const nearX = gate.left + 5 + 14;
    const world = worldWithGates(nearX, [gate]);
    world.reducedMotion = false;
    world.distance = gate.y - 0.5;
    world.prevDistance = gate.y - 2;
    updateWorld(world, hold(nearX), TICK);
    expect(world.alive).toBe(true);
    expect(world.obstacles[0]!.passed).toBe(true);
    expect(world.obstacles[0]!.nicked).toBe(false);
    expect(world.cleanPasses).toBe(1);
    expect(world.cleanAward).toBe(cleanPassAward(1));
    expect(world.tension).toBe(0);
    expect(world.edgeSkimPulse).toBe(true);
    expect(world.nearMissTimer).toBeCloseTo(NEAR_MISS_MS / 1000, 5);
    expect(skimJuice(world)).toBeGreaterThan(0);
    expect(world.particles.length).toBeGreaterThan(0);
    const gapCenter = (gate.left + gate.right) / 2;
    expect(world.particles.some((p) => Math.abs(p.x - nearX) < 0.01)).toBe(true);
    expect(world.particles.every((p) => Math.abs(p.x - gapCenter) < 0.01)).toBe(false);
  });
});
