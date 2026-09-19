import { describe, expect, it } from "vitest";
import type { Intent, ObstacleSpec } from "../../types.ts";
import { DIST, FIELD_W, GATE_LIP_THICKNESS, TICK } from "../world/constants.ts";
import { createWorld, updateWorld } from "../world/simulate.ts";

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

function take(world: ReturnType<typeof createWorld>) {
  const out = world.sfx.slice();
  world.sfx.length = 0;
  return out;
}

describe("sfx cues", () => {
  it("emits nick only when nickTimer was 0", () => {
    const first = gateSpec({ id: 1, y: DIST.openEnd + 40 });
    const second = gateSpec({
      id: 2,
      y: DIST.openEnd + 50,
      left: first.left,
      right: first.right,
      baseCenter: first.baseCenter,
    });
    const nickX = first.left + 6;
    const world = worldWithGates(nickX, [first, second]);
    tickUntil(world, nickX, () => world.obstacles[0]!.nicked);
    expect(take(world).filter((c) => c === "nick")).toEqual(["nick"]);
    expect(world.nickTimer).toBeGreaterThan(0);

    tickUntil(world, nickX, () => world.obstacles[1]!.nicked || !world.alive);
    expect(world.obstacles[1]!.nicked).toBe(true);
    expect(world.alive).toBe(true);
    expect(take(world).filter((c) => c === "nick")).toEqual([]);
  });

  it("emits clean once per skim-gated lip, not on a center-clean through", () => {
    const gate = gateSpec();
    const mid = (gate.left + gate.right) / 2;
    const world = worldWithGates(mid, [gate]);
    tickUntil(world, mid, () => world.cleanPasses >= 1);
    expect(take(world).filter((c) => c === "clean")).toEqual([]);

    const skim = gateSpec({ id: 2, y: world.distance + 80 });
    const nearX = skim.left + 5 + 14;
    world.obstacles.push({ ...skim, passed: false, nicked: false, skimmed: false });
    world.x = nearX;
    world.prevX = nearX;
    tickUntil(world, nearX, () => world.obstacles[1]!.passed);
    expect(take(world).filter((c) => c === "clean")).toEqual(["clean"]);
    for (let i = 0; i < 8; i++) updateWorld(world, hold(nearX), TICK);
    expect(take(world).filter((c) => c === "clean")).toEqual([]);
  });

  it("emits tension on a near-miss and death on a snag", () => {
    const world = worldWithGates(118, []);
    world.course.keyframes = wideCorridor(100, 260);
    updateWorld(world, hold(118), TICK);
    expect(take(world)).toEqual(["tension"]);

    tickUntil(world, 8, () => !world.alive);
    expect(world.alive).toBe(false);
    expect(take(world).filter((c) => c === "death")).toEqual(["death"]);
  });

  it("emits clear instead of death on a daily finish", () => {
    const world = createWorld(1, { daily: true, reducedMotion: true });
    world.course.finishY = 90;
    world.obstacles.length = 0;
    for (let i = 0; i < 90 && !world.cleared; i++) {
      updateWorld(world, hold(FIELD_W / 2), TICK);
    }
    expect(world.cleared).toBe(true);
    const cues = take(world);
    expect(cues).toContain("clear");
    expect(cues).not.toContain("death");
  });
});
