import { describe, expect, it } from "vitest";
import type { Intent, ObstacleSpec } from "../../types.ts";
import { dailySeed } from "../seed.ts";
import { hitObstacle } from "../world/collision.ts";
import {
  BASE_SPEED,
  CX,
  DIST,
  FIELD_W,
  GATE_LIP_THICKNESS,
  LIP_TELEGRAPH_MIN_S,
  MOVER_BAND,
  POINTER_LERP,
  STEER_SPEED,
  TICK,
  THROUGH_FLASH_MS,
} from "../world/constants.ts";
import { generateCourse, slabPair } from "../world/course.ts";
import { createWorld, updateWorld } from "../world/simulate.ts";
import { scoringGates } from "../world/agency.ts";

const hold = (x: number): Intent => ({
  steer: 0,
  pointerActive: true,
  pointerX: x,
  restart: false,
  toTitle: false,
});

function wideCorridor() {
  return [
    { y: 0, left: 16, right: FIELD_W - 16, gateId: null },
    { y: 8000, left: 16, right: FIELD_W - 16, gateId: null },
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

function worldWithGate(opts: { reducedMotion: boolean; x: number; gate?: ObstacleSpec }) {
  const world = createWorld(1, { daily: true, reducedMotion: opts.reducedMotion });
  const gate = opts.gate ?? gateSpec();
  world.course.keyframes = wideCorridor();
  world.obstacles = [{ ...gate, passed: false, nicked: false }];
  world.distance = DIST.openEnd + 4;
  world.prevDistance = world.distance;
  world.x = opts.x;
  world.prevX = opts.x;
  return { world, gate };
}

function tickUntil(world: ReturnType<typeof createWorld>, x: number, pred: () => boolean, cap = 90) {
  for (let i = 0; i < cap; i++) {
    updateWorld(world, hold(x), TICK);
    if (pred()) return;
  }
}

describe("pinch readability — static lips", () => {
  it("draws every scoring gate as a 10–14px slab pair at gate y", () => {
    const course = generateCourse(dailySeed("2026-09-17"), { daily: true });
    const gates = scoringGates(course);
    expect(gates.length).toBeGreaterThan(0);
    for (const g of gates) {
      expect(g.thickness).toBeGreaterThanOrEqual(10);
      expect(g.thickness).toBeLessThanOrEqual(14);
      const bars = slabPair(g.y, g.thickness, { left: g.left, right: g.right });
      expect(bars.left.x).toBe(0);
      expect(bars.left.w).toBe(g.left);
      expect(bars.right.x).toBe(g.right);
      expect(bars.right.w).toBe(FIELD_W - g.right);
      expect(bars.left.h).toBe(g.thickness);
      expect(bars.right.h).toBe(g.thickness);
      expect(bars.left.y).toBe(g.y - g.thickness / 2);
      expect(g.amplitude).toBe(0);
    }
  });

  it("keeps movers as mid-spice seasoning, not the common beat", () => {
    const course = generateCourse(dailySeed("2026-09-17"), { daily: true });
    const firstMinute = course.obstacles.filter((o) => o.y <= DIST.rhythmEnd);
    const gates = firstMinute.filter((o) => o.kind === "gate");
    const movers = firstMinute.filter((o) => o.kind === "mover");
    expect(gates.length).toBeGreaterThanOrEqual(8);
    expect(movers.length).toBe(MOVER_BAND.count);
    expect(gates.length).toBeGreaterThan(movers.length * 3);

    const early = gates.filter((g) => g.y <= DIST.moverEnd);
    expect(early.length).toBeGreaterThanOrEqual(20);
    for (let i = 1; i < early.length; i++) {
      expect((early[i]!.y - early[i - 1]!.y) / BASE_SPEED).toBeGreaterThanOrEqual(
        LIP_TELEGRAPH_MIN_S - 1e-6,
      );
    }
  });
});

describe("pinch readability — lip contact", () => {
  it("kills when the thread hits a gate lip face (same as a wall death)", () => {
    const { world, gate } = worldWithGate({ reducedMotion: true, x: 40 });
    expect(hitObstacle(40, gate.y, gate, { left: gate.left, right: gate.right })).toBe("death");
    tickUntil(world, 40, () => !world.alive);
    expect(world.alive).toBe(false);
    expect(world.cleanPasses).toBe(0);
    expect(world.obstacles[0]!.nicked).toBe(true);
  });

  it("nicks on a lip graze and withholds the clean pass", () => {
    const gate = gateSpec();
    const nickX = gate.left + 6;
    expect(hitObstacle(nickX, gate.y, gate, { left: gate.left, right: gate.right })).toBe("nick");
    const { world } = worldWithGate({ reducedMotion: true, x: nickX, gate });
    world.combo = 2;
    world.comboPeak = 2;
    tickUntil(world, nickX, () => world.obstacles[0]!.passed || !world.alive);
    expect(world.alive).toBe(true);
    expect(world.obstacles[0]!.nicked).toBe(true);
    expect(world.cleanPasses).toBe(0);
    expect(world.combo).toBe(2);
    expect(world.nickTimer).toBeGreaterThan(0);
  });
});

describe("pinch readability — through is not combo food", () => {
  it("shows a gray through flash and does not tick combo or thread juice", () => {
    const gate = gateSpec();
    const x = (gate.left + gate.right) / 2;
    const { world } = worldWithGate({ reducedMotion: false, x, gate });
    tickUntil(world, x, () => world.cleanPasses >= 1);
    expect(world.alive).toBe(true);
    expect(world.cleanPasses).toBe(1);
    expect(world.combo).toBe(0);
    expect(world.skimCash).toBe(0);
    expect(world.skimEvents).toBe(0);
    expect(world.throughTimer).toBeCloseTo(THROUGH_FLASH_MS / 1000, 5);
    expect(world.nearMissTimer).toBe(0);
    expect(world.particles).toEqual([]);
    expect(world.tension).toBe(0);
  });

  it("still marks through under reduced motion without juice", () => {
    const gate = gateSpec();
    const x = (gate.left + gate.right) / 2;
    const { world } = worldWithGate({ reducedMotion: true, x, gate });
    tickUntil(world, x, () => world.cleanPasses >= 1);
    expect(world.cleanPasses).toBe(1);
    expect(world.combo).toBe(0);
    expect(world.nearMissTimer).toBe(0);
    expect(world.particles).toEqual([]);
    expect(world.throughTimer).toBeCloseTo(THROUGH_FLASH_MS / 1000, 5);
  });
});

describe("pinch readability — protected feel", () => {
  it("does not retune steer", () => {
    expect(STEER_SPEED).toBe(280);
    expect(POINTER_LERP).toBe(11);
    expect(CX).toBe(180);
  });
});
