import { describe, expect, it } from "vitest";
import { createWorld, skimJuice, updateWorld, worldScore } from "../world/simulate.ts";
import { computeScore, skimAward } from "../score.ts";
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
  world.obstacles = gates.map((g) => ({ ...g, passed: false, nicked: false, skimmed: false }));
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
  it("keeps combo on nick and scores only from skim cash + gated distance", () => {
    const first = gateSpec({ id: 1, y: DIST.openEnd + 40 });
    const second = gateSpec({ id: 2, y: DIST.openEnd + 140, left: 170, right: 290, baseCenter: 230 });
    const mid = (first.left + first.right) / 2;
    const world = worldWithGates(mid, [first, second]);
    tickUntil(world, mid, () => world.obstacles[0]!.passed);
    expect(world.alive).toBe(true);
    expect(world.combo).toBe(0);
    expect(world.skimCash).toBe(0);
    const peakBefore = world.comboPeak;

    const nickX = second.left + 6;
    tickUntil(world, nickX, () => world.obstacles[1]!.passed || !world.alive);
    expect(world.alive).toBe(true);
    expect(world.obstacles[1]!.nicked).toBe(true);
    expect(world.combo).toBe(0);
    expect(world.comboPeak).toBe(peakBefore);
    expect(world.nickTimer).toBeGreaterThan(0);
    expect(worldScore(world)).toBe(
      computeScore(world.distance, world.skimCash, world.comboPeak, world.skimEvents),
    );
  });

  it("does not increment combo on a center-clean gate after a nick", () => {
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
    expect(world.obstacles[1]!.skimmed).toBe(false);
    expect(world.cleanPasses).toBe(1);
    expect(world.combo).toBe(0);
    expect(world.skimCash).toBe(0);
  });

  it("increments combo on a skim-gated lip", () => {
    const gate = gateSpec();
    const nearX = gate.left + 5 + 14;
    const world = worldWithGates(nearX, [gate]);
    tickUntil(world, nearX, () => world.obstacles[0]!.passed);
    expect(world.alive).toBe(true);
    expect(world.obstacles[0]!.skimmed).toBe(true);
    expect(world.combo).toBe(1);
    expect(world.comboPeak).toBe(1);
    expect(world.skimCash).toBe(skimAward(1));
  });

  it("clears combo on death and keeps comboPeak", () => {
    const gate = gateSpec();
    const nearX = gate.left + 5 + 14;
    const world = worldWithGates(nearX, [gate]);
    tickUntil(world, nearX, () => world.combo >= 1);
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
  it("stacks on a near-miss then cashes only on the next skim-gated lip", () => {
    const near = gateSpec({ id: 1, y: DIST.openEnd + 50 });
    const skim = gateSpec({
      id: 2,
      y: DIST.openEnd + 180,
      left: 170,
      right: 290,
      baseCenter: 230,
    });
    const nearX = near.left + 5 + 14;
    const world = worldWithGates(nearX, [near, skim]);
    tickUntil(world, nearX, () => world.obstacles[0]!.passed);
    expect(world.alive).toBe(true);
    expect(world.obstacles[0]!.nicked).toBe(false);
    expect(world.cleanPasses).toBe(1);
    expect(world.combo).toBe(1);
    expect(world.tension).toBe(0);
    expect(world.skimCash).toBe(skimAward(1));

    const skimX = skim.left + 5 + 14;
    tickUntil(world, skimX, () => world.obstacles[1]!.passed);
    expect(world.cleanPasses).toBe(2);
    expect(world.combo).toBe(2);
    expect(world.skimCash).toBe(skimAward(1) + skimAward(1));
    expect(world.tension).toBe(0);
  });

  it("does not cash Tension on a center-clean lip", () => {
    const world = worldWithGates(118, []);
    world.course.keyframes = wideCorridor(100, 260);
    updateWorld(world, hold(118), TICK);
    expect(world.tension).toBe(1);
    expect(world.skimEvents).toBe(1);

    const clean = gateSpec({
      id: 2,
      y: world.distance + 80,
      left: 170,
      right: 290,
      baseCenter: 230,
    });
    world.obstacles = [{ ...clean, passed: false, nicked: false, skimmed: false }];
    const cleanX = (clean.left + clean.right) / 2;
    world.x = cleanX;
    world.prevX = cleanX;
    tickUntil(world, cleanX, () => world.obstacles[0]!.passed);
    expect(world.obstacles[0]!.skimmed).toBe(false);
    expect(world.skimCash).toBe(0);
    expect(world.combo).toBe(0);
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
    updateWorld(world, hold(118), TICK);
    expect(world.tension).toBe(1);
    expect(world.skimEvents).toBe(1);
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

  it("keeps Tension juice when a skim cashes on that lip", () => {
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
    expect(world.skimCash).toBe(skimAward(1));
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
