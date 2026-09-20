import { describe, expect, it } from "vitest";
import type { Intent, ObstacleSpec } from "../../types.ts";
import { Game } from "../Game.ts";
import {
  SKIM_SCORE_TEACH_KEY,
  markSkimScoreTeachSeen,
  skimScoreTeachSeen,
  type StorageLike,
} from "../persistence.ts";
import {
  RESULT_NO_SKIM,
  SCORE_SKIM_TEACH,
  SCORE_SKIM_TEACH_S,
  VARIANT_TEACH,
  skimScoreTeachOpacity,
} from "../variant.ts";
import { CLEAN_AWARD, THROUGH_AWARD, computeScore, skimAward } from "../score.ts";
import { DIST, FIELD_W, GATE_LIP_THICKNESS, NEAR_MISS_MS, TICK, THROUGH_FLASH_MS } from "../world/constants.ts";
import { createWorld, skimJuice, updateWorld, worldScore } from "../world/simulate.ts";

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const hold = (x: number, extra: Partial<Intent> = {}): Intent => ({
  steer: 0,
  pointerActive: true,
  pointerX: x,
  restart: false,
  toTitle: false,
  ...extra,
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

function worldWithGates(
  x: number,
  gates: ObstacleSpec[],
  variant: "control" | "brake" | "beat" = "control",
) {
  const world = createWorld(1, { daily: true, reducedMotion: true, variant });
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
  cap = 160,
  extra: Partial<Intent> = {},
): void {
  for (let i = 0; i < cap; i++) {
    updateWorld(world, hold(x, extra), TICK);
    if (pred()) return;
  }
}

describe("BIG-FEEL-REDESIGN-v1 PR1 — score gating", () => {
  it("pays 0 for a center-clean lip — through only, no combo, no cash", () => {
    const gate = gateSpec();
    const mid = (gate.left + gate.right) / 2;
    const world = worldWithGates(mid, [gate]);
    tickUntil(world, mid, () => world.obstacles[0]!.passed);
    expect(world.alive).toBe(true);
    expect(world.obstacles[0]!.skimmed).toBe(false);
    expect(world.cleanPasses).toBe(1);
    expect(world.combo).toBe(0);
    expect(world.comboPeak).toBe(0);
    expect(world.skimCash).toBe(THROUGH_AWARD);
    expect(world.skimEvents).toBe(0);
    expect(world.throughEvent).toBe(true);
    expect(world.throughTimer).toBeCloseTo(THROUGH_FLASH_MS / 1000, 5);
    expect(world.sfx).not.toContain("clean");
    expect(worldScore(world)).toBe(0);
    expect(worldScore(world)).toBe(computeScore(world.distance, world.skimCash, world.comboPeak, world.skimEvents));
  });

  it("cashes Tension only on a skim-gated lip", () => {
    const near = gateSpec({ id: 1, y: DIST.openEnd + 50 });
    const clean = gateSpec({
      id: 2,
      y: DIST.openEnd + 180,
      left: 170,
      right: 290,
      baseCenter: 230,
    });
    const nearX = near.left + 5 + 14;
    const world = worldWithGates(nearX, [near, clean]);
    tickUntil(world, nearX, () => world.obstacles[0]!.passed);
    expect(world.obstacles[0]!.skimmed).toBe(true);
    expect(world.skimEvents).toBeGreaterThan(0);
    expect(world.combo).toBe(1);
    expect(world.skimCash).toBe(skimAward(1));
    expect(world.tension).toBe(0);
    expect(worldScore(world)).toBeGreaterThan(0);

    const cleanX = (clean.left + clean.right) / 2;
    const cashBefore = world.skimCash;
    const comboBefore = world.combo;
    tickUntil(world, cleanX, () => world.obstacles[1]!.passed);
    expect(world.obstacles[1]!.skimmed).toBe(false);
    expect(world.combo).toBe(comboBefore);
    expect(world.skimCash).toBe(cashBefore);
    expect(world.throughEvent).toBe(true);
  });

  it("does not restore center-clean scoring while Brake is held", () => {
    const gate = gateSpec();
    const mid = (gate.left + gate.right) / 2;
    const world = worldWithGates(mid, [gate], "brake");
    tickUntil(world, mid, () => world.obstacles[0]!.passed, 160, { brake: true });
    expect(world.braking).toBe(true);
    expect(world.obstacles[0]!.skimmed).toBe(false);
    expect(world.combo).toBe(0);
    expect(world.skimCash).toBe(0);
    expect(world.skimEvents).toBe(0);
    expect(worldScore(world)).toBe(0);
  });

  it("lets Brake still skim-cash and slow without paying a center line", () => {
    const gate = gateSpec({ id: 1, y: DIST.openEnd + 80 });
    const nearX = gate.left + 5 + 14;
    const world = worldWithGates(nearX, [gate], "brake");
    world.reducedMotion = false;
    tickUntil(world, nearX, () => world.obstacles[0]!.passed, 160, { brake: true });
    expect(world.alive).toBe(true);
    expect(world.braking).toBe(true);
    expect(world.obstacles[0]!.skimmed).toBe(true);
    expect(world.combo).toBe(1);
    expect(world.skimCash).toBe(skimAward(1));
    expect(world.skimEvents).toBeGreaterThan(0);
    expect(world.comboPeak).toBe(1);
    expect(worldScore(world)).toBe(
      computeScore(world.distance, world.skimCash, world.comboPeak, world.skimEvents),
    );
    expect(worldScore(world)).toBeGreaterThan(world.skimCash);
  });

  it("does not let an off-skim Beat Perfect pay like a skim", () => {
    const gate = gateSpec({ left: 100, right: 260, baseCenter: 180, gapWidth: 160 });
    const mid = (gate.left + gate.right) / 2;
    const world = worldWithGates(mid, [gate], "beat");
    tickUntil(world, mid, () => world.obstacles[0]!.passed);
    expect(world.cleanPasses).toBe(1);
    expect(world.combo).toBe(0);
    expect(world.skimCash).toBe(0);
    expect(world.skimEvents).toBe(0);
    expect(worldScore(world)).toBe(0);
  });

  it("keeps skim juice on when a skim-gated lip cashes", () => {
    const gate = gateSpec({ id: 1, y: DIST.openEnd + 80 });
    const nearX = gate.left + 5 + 14;
    const world = worldWithGates(nearX, [gate]);
    world.reducedMotion = false;
    world.distance = gate.y - 0.5;
    world.prevDistance = gate.y - 2;
    updateWorld(world, hold(nearX), TICK);
    expect(world.obstacles[0]!.passed).toBe(true);
    expect(world.obstacles[0]!.skimmed).toBe(true);
    expect(world.skimCash).toBe(skimAward(1));
    expect(world.scoreTickEvent).toBe(true);
    expect(world.scoreTickTimer).toBeGreaterThan(0);
    expect(world.edgeSkimPulse).toBe(true);
    expect(world.nearMissTimer).toBeCloseTo(NEAR_MISS_MS / 1000, 5);
    expect(skimJuice(world)).toBeGreaterThan(0);
    expect(world.particles.length).toBeGreaterThan(0);
  });

  it("does not bank distance on a wall skim until a skim-gated lip", () => {
    const world = worldWithGates(118, []);
    world.course.keyframes = wideCorridor(100, 260);
    updateWorld(world, hold(118), TICK);
    expect(world.skimEvents).toBe(1);
    expect(world.combo).toBe(0);
    expect(world.tension).toBe(1);
    expect(world.scoreTickEvent).toBe(false);
    expect(world.scoreTickTimer).toBe(0);
    expect(worldScore(world)).toBe(0);
  });
});

describe("BIG-FEEL-REDESIGN-v1 PR1 — HUD honesty", () => {
  it("locks the first-run line, fade, and zero-skim result copy", () => {
    expect(SCORE_SKIM_TEACH).toBe("Ride the edge rail \u2014 that\u2019s the score.");
    expect(RESULT_NO_SKIM).toBe("No skims — try the edge.");
    expect(SKIM_SCORE_TEACH_KEY).toBe("thread.v1.skimScoreTeachSeen");
    expect(SCORE_SKIM_TEACH_S).toBeCloseTo(4, 8);
    expect(skimScoreTeachOpacity(0)).toBe(1);
    expect(skimScoreTeachOpacity(3.5)).toBe(1);
    expect(skimScoreTeachOpacity(3.75)).toBeCloseTo(0.5, 5);
    expect(skimScoreTeachOpacity(4)).toBe(0);
    expect(CLEAN_AWARD).toBe(50);
  });

  it("shows Ride the edge rail — that\u2019s the score. once, then sets the flag", () => {
    const storage = new MemoryStorage();
    const game = new Game(storage, { endlessSeed: 1 });
    game.startEndless();
    expect(game.snapshot().teach).toBe(SCORE_SKIM_TEACH);
    expect(game.snapshot().teachOpacity).toBe(1);
    expect(storage.getItem(SKIM_SCORE_TEACH_KEY)).toBe("1");
    expect(skimScoreTeachSeen(storage)).toBe(true);

    for (let i = 0; i < Math.round(3.5 / TICK); i++) game.tick(hold(180), TICK);
    expect(game.snapshot().teach).toBe(SCORE_SKIM_TEACH);
    expect(game.snapshot().teachOpacity).toBe(1);

    for (let i = 0; i < Math.round(0.6 / TICK); i++) game.tick(hold(180), TICK);
    expect(game.snapshot().teachOpacity).toBe(0);
    expect(game.snapshot().teach).toBe(VARIANT_TEACH.control);
  });

  it("does not re-show the score line after the flag is set", () => {
    const storage = new MemoryStorage();
    markSkimScoreTeachSeen(storage);
    const game = new Game(storage, { endlessSeed: 1 });
    game.startEndless();
    expect(game.snapshot().teach).toBe(VARIANT_TEACH.control);
    expect(game.snapshot().teach).not.toBe(SCORE_SKIM_TEACH);
    expect(game.snapshot().teachOpacity).toBe(1);
  });

  it("reports No skims — try the edge. when a run ends with skimEvents == 0", () => {
    const storage = new MemoryStorage();
    markSkimScoreTeachSeen(storage);
    const game = new Game(storage, { endlessSeed: 1 });
    game.startEndless();
    const world = game.world!;
    world.course.keyframes = wideCorridor(100, 260);
    world.obstacles.length = 0;
    world.distance = DIST.openEnd + 20;
    world.prevDistance = world.distance;
    world.x = 8;
    game.tick(hold(8), TICK);
    expect(game.screen).toBe("dead");
    expect(world.skimEvents).toBe(0);
    expect(game.snapshot().noSkimResult).toBe(RESULT_NO_SKIM);
    expect(game.snapshot().score).toBe(0);
  });

  it("exposes through flash and score-tick flags for the HUD", () => {
    const storage = new MemoryStorage();
    markSkimScoreTeachSeen(storage);
    const game = new Game(storage, { endlessSeed: 1 });
    game.startEndless();
    const world = game.world!;
    const gate = gateSpec();
    const mid = (gate.left + gate.right) / 2;
    world.course.keyframes = wideCorridor();
    world.obstacles = [{ ...gate, passed: false, nicked: false, skimmed: false }];
    world.distance = DIST.openEnd + 4;
    world.prevDistance = world.distance;
    world.x = mid;
    world.prevX = mid;
    tickUntil(world, mid, () => world.obstacles[0]!.passed);
    game.tick(hold(mid), TICK);
    const snap = game.snapshot();
    expect(snap.throughFlash).toBe(true);
    expect(snap.skimEvents).toBe(0);
    expect(snap.score).toBe(0);
  });
});
