import { describe, expect, it } from "vitest";
import type { Intent, ObstacleSpec } from "../../types.ts";
import { Game } from "../Game.ts";
import { markSkimScoreTeachSeen, type StorageLike } from "../persistence.ts";
import { EDGE_RAIL_ART } from "../render/draw.ts";
import { skimAward } from "../score.ts";
import { SCORE_SKIM_TEACH } from "../variant.ts";
import {
  DIST,
  FIELD_W,
  GATE_LIP_THICKNESS,
  NEAR_MISS_BAND,
  NICK_BAND,
  TICK,
} from "../world/constants.ts";
import { classifyGapHit } from "../world/collision.ts";
import { closerRailSide, railBloomHeat, railBloomOn, railContact, railProximity, railScoreBloomOn, RAIL_VISUAL_BAND } from "../world/rail.ts";
import { createWorld, updateWorld } from "../world/simulate.ts";

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

function worldWith(
  x: number,
  opts: { reducedMotion?: boolean; variant?: "control" | "brake" | "beat"; walls?: { left: number; right: number } } = {},
) {
  const world = createWorld(1, {
    daily: true,
    reducedMotion: opts.reducedMotion ?? false,
    variant: opts.variant ?? "control",
  });
  const walls = opts.walls ?? { left: 100, right: 260 };
  world.course.keyframes = wideCorridor(walls.left, walls.right);
  world.obstacles = [];
  world.distance = DIST.openEnd + 4;
  world.prevDistance = world.distance;
  world.x = x;
  world.prevX = x;
  return world;
}

describe("IDENTITY-EDGE-RAIL-v1 — band invitation, not a tightrope", () => {
  it("does not retune nick / near-miss colliders", () => {
    expect(NICK_BAND).toBe(8);
    expect(NEAR_MISS_BAND).toBe(12);
    expect(EDGE_RAIL_ART.contactBand).toBeGreaterThan(NEAR_MISS_BAND + NICK_BAND);
    expect(RAIL_VISUAL_BAND).toBeGreaterThan(NEAR_MISS_BAND + NICK_BAND);
    expect(classifyGapHit(180, 100, 260)).toBe("none");
    expect(classifyGapHit(118, 100, 260)).toBe("nearMiss");
    expect(classifyGapHit(108, 100, 260)).toBe("nick");
  });

  it("treats the skim/nick band as a ride, center as off-rail", () => {
    expect(closerRailSide(118, 100, 260)).toBe("left");
    expect(closerRailSide(242, 100, 260)).toBe("right");
    expect(railProximity(0)).toBe(1);
    expect(railProximity(NICK_BAND + NEAR_MISS_BAND - 1)).toBe(1);
    expect(railProximity(NICK_BAND + NEAR_MISS_BAND + 8)).toBeGreaterThan(0);
    expect(railProximity(NICK_BAND + NEAR_MISS_BAND + 8)).toBeLessThan(1);
    expect(railProximity(80)).toBe(0);
    const center = worldWith(180);
    expect(railContact(center).riding).toBe(false);
    expect(railBloomOn(center)).toBe(false);
    expect(railBloomHeat(center)).toBe(0);

    const skim = worldWith(118);
    updateWorld(skim, hold(118), TICK);
    expect(railContact(skim).riding).toBe(true);
    expect(railContact(skim).side).toBe("left");
    expect(railContact(skim).proximity).toBe(1);
    expect(railBloomOn(skim)).toBe(true);
    expect(railBloomHeat(skim)).toBe(1);
  });
});

describe("IDENTITY-EDGE-RAIL-v1 — heat follows skim, not Brake", () => {
  it("blooms the rail on a live skim and attaches louder heat to a score tick", () => {
    const gate = gateSpec();
    const nearX = gate.left + 5 + 14;
    const world = worldWith(nearX, { walls: { left: 16, right: FIELD_W - 16 } });
    world.obstacles = [{ ...gate, passed: false, nicked: false, skimmed: false }];
    world.distance = gate.y - 0.5;
    world.prevDistance = gate.y - 2;
    world.x = nearX;
    world.prevX = nearX;
    updateWorld(world, hold(nearX), TICK);

    expect(world.skimCash).toBe(skimAward(1));
    expect(world.scoreTickEvent).toBe(true);
    expect(railContact(world).riding).toBe(true);
    expect(railScoreBloomOn(world)).toBe(true);
    expect(railBloomHeat(world)).toBe(1);
    expect(world.scoreTickSide).toBe("left");
  });

  it("does not light the rail or pay skim when Brake is held in the center", () => {
    const gate = gateSpec({ left: 100, right: 260, baseCenter: 180, gapWidth: 160 });
    const mid = (gate.left + gate.right) / 2;
    const world = worldWith(mid, { variant: "brake", walls: { left: 16, right: FIELD_W - 16 } });
    world.obstacles = [{ ...gate, passed: false, nicked: false, skimmed: false }];
    world.distance = gate.y - 0.5;
    world.prevDistance = gate.y - 2;
    world.x = mid;
    world.prevX = mid;
    updateWorld(world, hold(mid, { brake: true }), TICK);

    expect(world.braking).toBe(true);
    expect(world.obstacles[0]!.skimmed).toBe(false);
    expect(world.skimEvents).toBe(0);
    expect(world.skimCash).toBe(0);
    expect(world.scoreTickEvent).toBe(false);
    expect(railContact(world).riding).toBe(false);
    expect(railBloomOn(world)).toBe(false);
    expect(railBloomHeat(world)).toBe(0);
    expect(railScoreBloomOn(world)).toBe(false);
  });

  it("still slows with Brake and blooms only when actually skimming", () => {
    const gate = gateSpec();
    const nearX = gate.left + 5 + 14;
    const world = worldWith(nearX, { variant: "brake", walls: { left: 16, right: FIELD_W - 16 } });
    world.obstacles = [{ ...gate, passed: false, nicked: false, skimmed: false }];
    world.distance = gate.y - 0.5;
    world.prevDistance = gate.y - 2;
    world.x = nearX;
    world.prevX = nearX;
    const before = world.distance;
    updateWorld(world, hold(nearX, { brake: true }), TICK);

    expect(world.braking).toBe(true);
    expect(world.distance - before).toBeLessThan(90 * TICK);
    expect(world.obstacles[0]!.skimmed).toBe(true);
    expect(world.skimCash).toBe(skimAward(1));
    expect(railBloomOn(world)).toBe(true);
    expect(railBloomHeat(world)).toBe(1);
  });

  it("keeps the idle silhouette under reduced motion and skips bloom", () => {
    const world = worldWith(118, { reducedMotion: true });
    updateWorld(world, hold(118), TICK);
    expect(world.skimEvents).toBe(1);
    expect(railContact(world).riding).toBe(true);
    expect(railBloomHeat(world)).toBe(0);
    expect(railBloomOn(world)).toBe(false);
    expect(EDGE_RAIL_ART.idleWidth).toBeGreaterThan(0);
    expect(EDGE_RAIL_ART.idleAlpha).toBeGreaterThan(0);
  });
});

describe("IDENTITY-EDGE-RAIL-v1 — first-run line", () => {
  it("shows the rail score line once on a fresh browser", () => {
    const storage = new MemoryStorage();
    const game = new Game(storage, { endlessSeed: 1 });
    game.startEndless();
    expect(game.snapshot().teach).toBe(SCORE_SKIM_TEACH);
    expect(game.snapshot().teach).toBe("Ride the edge rail \u2014 that\u2019s the score.");
    expect(game.snapshot().teachOpacity).toBe(1);
  });

  it("does not re-show after the existing first-run flag", () => {
    const storage = new MemoryStorage();
    markSkimScoreTeachSeen(storage);
    const game = new Game(storage, { endlessSeed: 1 });
    game.startEndless();
    expect(game.snapshot().teach).not.toBe(SCORE_SKIM_TEACH);
  });
});
