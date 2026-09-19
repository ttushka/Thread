import { describe, expect, it } from "vitest";
import type { Intent, ObstacleSpec } from "../../types.ts";
import { Game } from "../Game.ts";
import { markSkimScoreTeachSeen, type StorageLike } from "../persistence.ts";
import { SCORE_TICK_ART, WALL_ART, scoreTickLocalEdgeOn, withScoreTickEdge } from "../render/draw.ts";
import { skimAward } from "../score.ts";
import {
  DIST,
  FIELD_W,
  GATE_LIP_THICKNESS,
  SCORE_TICK_FILAMENT_MS,
  SCORE_TICK_HUD_MS,
  TICK,
} from "../world/constants.ts";
import {
  createWorld,
  scoreTickEdgeOn,
  scoreTickFilamentOn,
  scoreTickHudOn,
  updateWorld,
} from "../world/simulate.ts";
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
  opts: { reducedMotion?: boolean; variant?: "control" | "brake" | "beat" } = {},
) {
  const world = createWorld(1, {
    daily: true,
    reducedMotion: opts.reducedMotion ?? false,
    variant: opts.variant ?? "control",
  });
  world.course.keyframes = wideCorridor();
  world.obstacles = gates.map((g) => ({ ...g, passed: false, nicked: false, skimmed: false }));
  world.distance = DIST.openEnd + 4;
  world.prevDistance = world.distance;
  world.x = x;
  world.prevX = x;
  return world;
}

function cashSkimLip(reducedMotion = false) {
  const gate = gateSpec({ id: 1, y: DIST.openEnd + 80 });
  const nearX = gate.left + 5 + 14;
  const world = worldWithGates(nearX, [gate], { reducedMotion });
  world.distance = gate.y - 0.5;
  world.prevDistance = gate.y - 2;
  updateWorld(world, hold(nearX), TICK);
  return { world, gate, nearX };
}

describe("ART-SKIM-TICK-JUICE-BUMP-v1 — award-tick juice", () => {
  it("latches filament, local edge, and HUD windows when a skim cashes", () => {
    const { world, gate, nearX } = cashSkimLip();
    expect(world.scoreTickEvent).toBe(true);
    expect(world.skimCash).toBe(skimAward(1));
    expect(world.scoreTickTimer).toBeCloseTo(SCORE_TICK_FILAMENT_MS / 1000, 5);
    expect(world.scoreTickLipId).toBe(gate.id);
    expect(world.scoreTickSide).toBe(nearX < (gate.left + gate.right) / 2 ? "left" : "right");
    expect(scoreTickFilamentOn(world)).toBe(true);
    expect(scoreTickEdgeOn(world)).toBe(true);
    expect(scoreTickHudOn(world)).toBe(true);
    expect(scoreTickLocalEdgeOn(world, gate.id, world.scoreTickSide!)).toBe(true);
    expect(scoreTickLocalEdgeOn(world, gate.id, world.scoreTickSide === "left" ? "right" : "left")).toBe(
      false,
    );
  });

  it("does not fire award juice on a wall graze that scores 0", () => {
    const world = worldWithGates(118, []);
    world.course.keyframes = wideCorridor(100, 260);
    updateWorld(world, hold(118), TICK);
    expect(world.skimEvents).toBe(1);
    expect(world.scoreTickEvent).toBe(false);
    expect(world.scoreTickTimer).toBe(0);
    expect(scoreTickFilamentOn(world)).toBe(false);
    expect(scoreTickEdgeOn(world)).toBe(false);
    expect(scoreTickHudOn(world)).toBe(false);
  });

  it("does not fire award juice on a center-clean through", () => {
    const gate = gateSpec();
    const mid = (gate.left + gate.right) / 2;
    const world = worldWithGates(mid, [gate]);
    world.distance = gate.y - 0.5;
    world.prevDistance = gate.y - 2;
    updateWorld(world, hold(mid), TICK);
    expect(world.throughEvent).toBe(true);
    expect(world.scoreTickEvent).toBe(false);
    expect(world.scoreTickTimer).toBe(0);
    expect(scoreTickHudOn(world)).toBe(false);
  });

  it("holds HUD 120ms, edge 100–140ms, filament 140–180ms, then settles", () => {
    const { world } = cashSkimLip();
    const stepsHud = Math.round(SCORE_TICK_HUD_MS / 1000 / TICK) - 1;
    for (let i = 0; i < stepsHud; i++) updateWorld(world, hold(world.x), TICK);
    expect(scoreTickHudOn(world)).toBe(true);
    expect(scoreTickEdgeOn(world)).toBe(true);
    expect(scoreTickFilamentOn(world)).toBe(true);

    const untilAfterHud = Math.round((SCORE_TICK_HUD_MS + 20) / 1000 / TICK) - stepsHud;
    for (let i = 0; i < untilAfterHud; i++) updateWorld(world, hold(world.x), TICK);
    expect(scoreTickHudOn(world)).toBe(false);
    expect(scoreTickFilamentOn(world)).toBe(true);

    const untilAfterFilament =
      Math.round((SCORE_TICK_FILAMENT_MS + 20) / 1000 / TICK) - stepsHud - untilAfterHud;
    for (let i = 0; i < untilAfterFilament; i++) updateWorld(world, hold(world.x), TICK);
    expect(scoreTickFilamentOn(world)).toBe(false);
    expect(scoreTickEdgeOn(world)).toBe(false);
    expect(world.scoreTickTimer).toBe(0);
  });

  it("exposes HUD scoreTick for the full punch window, not one frame", () => {
    const storage = new MemoryStorage();
    markSkimScoreTeachSeen(storage);
    const game = new Game(storage, { endlessSeed: 1 });
    game.startEndless();
    const world = game.world!;
    const gate = gateSpec({ id: 1, y: DIST.openEnd + 80 });
    const nearX = gate.left + 5 + 14;
    world.course.keyframes = wideCorridor();
    world.obstacles = [{ ...gate, passed: false, nicked: false, skimmed: false }];
    world.reducedMotion = false;
    world.distance = gate.y - 0.5;
    world.prevDistance = gate.y - 2;
    world.x = nearX;
    world.prevX = nearX;
    game.tick(hold(nearX), TICK);
    expect(game.snapshot().scoreTick).toBe(true);
    expect(game.snapshot().score).toBeGreaterThan(0);

    for (let i = 0; i < Math.round(0.1 / TICK); i++) game.tick(hold(nearX), TICK);
    expect(game.snapshot().scoreTick).toBe(true);

    for (let i = 0; i < Math.round(0.08 / TICK); i++) game.tick(hold(nearX), TICK);
    expect(game.snapshot().scoreTick).toBe(false);
  });

  it("keeps HUD color punch under reduced motion but skips playfield heat", () => {
    const { world, gate } = cashSkimLip(true);
    expect(scoreTickHudOn(world)).toBe(true);
    expect(scoreTickFilamentOn(world)).toBe(true);
    expect(scoreTickLocalEdgeOn(world, gate.id, world.scoreTickSide ?? "left")).toBe(false);
  });

  it("brightens the local lip edge to pinch-lip-edge, never teal", () => {
    const { world, gate } = cashSkimLip();
    const side = world.scoreTickSide!;
    const heated = withScoreTickEdge(world, gate.id, side, {
      fill: WALL_ART.mover,
      inner: WALL_ART.mover,
      edge: WALL_ART.moverEdge,
      lineWidth: WALL_ART.moverStroke,
    });
    expect(heated.edge).toBe(WALL_ART.pinchLipEdge);
    expect(heated.edge).toBe("#B8C0CC");
    expect(heated.edge).not.toBe(SCORE_TICK_ART.filament);
    expect(heated.lineWidth).toBeGreaterThan(WALL_ART.moverStroke);

    const other = withScoreTickEdge(world, gate.id, side === "left" ? "right" : "left", {
      fill: WALL_ART.pinchLip,
      inner: WALL_ART.pinchLip,
      edge: WALL_ART.obstacleEdge,
      lineWidth: WALL_ART.pinchLipStroke,
    });
    expect(other.edge).toBe(WALL_ART.obstacleEdge);
  });

  it("does not retune the score formula or graze-cash rule", () => {
    const { world } = cashSkimLip();
    expect(world.combo).toBe(1);
    expect(world.skimCash).toBe(skimAward(1));
    const graze = worldWithGates(118, []);
    graze.course.keyframes = wideCorridor(100, 260);
    updateWorld(graze, hold(118), TICK);
    expect(graze.skimCash).toBe(0);
    expect(graze.scoreTickTimer).toBe(0);
  });
});

