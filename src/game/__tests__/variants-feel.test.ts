import { describe, expect, it } from "vitest";
import type { Intent, ObstacleSpec } from "../../types.ts";
import {
  BRAKE_SLOW,
  BEAT_BPM,
  BEAT_PERFECT_MS_KEY,
  BEAT_PERFECT_MS_TOUCH,
  LANE_LERP_MS,
  LANE_X,
} from "../variant.ts";
import { computeScore } from "../score.ts";
import {
  BASE_SPEED,
  DIST,
  FIELD_W,
  GATE_LIP_THICKNESS,
  NICK_SLOW,
  TENSION_GAIN_LOCK_MS,
  TICK,
} from "../world/constants.ts";
import { beatDistance, isPerfectTiming, msToNearestBeat, quantizeLipY } from "../world/beat.ts";
import { generateCourse } from "../world/course.ts";
import { scoringGates } from "../world/agency.ts";
import { createWorld, updateWorld, worldScore } from "../world/simulate.ts";
import { neighborLaneBlocked } from "../world/lanes.ts";

const hold = (x: number, extra: Partial<Intent> = {}): Intent => ({
  steer: 0,
  pointerActive: true,
  pointerX: x,
  restart: false,
  toTitle: false,
  ...extra,
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

function worldWith(
  variant: "control" | "brake" | "beat" | "lanes",
  x: number,
  gates: ObstacleSpec[],
) {
  const world = createWorld(1, { daily: true, reducedMotion: true, variant });
  world.course.keyframes = wideCorridor();
  world.obstacles = gates.map((g) => ({ ...g, passed: false, nicked: false }));
  world.distance = DIST.openEnd + 4;
  world.prevDistance = world.distance;
  world.x = x;
  world.prevX = x;
  if (variant === "lanes") {
    world.laneIndex = x < 120 ? 0 : x < 240 ? 1 : 2;
    world.laneFromX = x;
    world.laneToX = LANE_X[world.laneIndex]!;
    world.laneLerp = 1;
  }
  return world;
}

describe("feel-sanity 1 — brake+nick cap at NICK_SLOW", () => {
  it("does not stack below NICK_SLOW", () => {
    expect(BRAKE_SLOW * NICK_SLOW).toBeLessThan(NICK_SLOW);
    const world = worldWith("brake", 180, []);
    world.nickTimer = 1;
    const before = world.distance;
    updateWorld(world, hold(180, { brake: true }), TICK);
    const advanced = world.distance - before;
    expect(advanced).toBeCloseTo(BASE_SPEED * NICK_SLOW * TICK, 8);
    expect(advanced).toBeGreaterThanOrEqual(BASE_SPEED * NICK_SLOW * TICK - 1e-9);
  });

  it("brakes without nicking, and does not reset combo or Tension", () => {
    const world = worldWith("brake", 180, []);
    world.combo = 4;
    world.tension = 2;
    world.tensionTimer = 1;
    updateWorld(world, hold(180, { brake: true }), TICK);
    expect(world.braking).toBe(true);
    expect(world.combo).toBe(4);
    expect(world.tension).toBe(2);
    expect(world.nickTimer).toBe(0);
    const dt = world.distance - (DIST.openEnd + 4);
    expect(dt).toBeCloseTo(BASE_SPEED * BRAKE_SLOW * TICK, 8);
  });
});

describe("feel-sanity 2 — brake does not steal steer", () => {
  it("applies analog pointer steer while brake is held", () => {
    const world = worldWith("brake", 180, []);
    updateWorld(world, hold(240, { brake: true, pointerActive: true }), TICK);
    expect(world.braking).toBe(true);
    expect(world.x).toBeGreaterThan(180);
    expect(world.x).toBeLessThan(240);
  });
});

describe("feel-sanity 3 — beat lips keep a 1-beat gap", () => {
  it("quantizes with a minimum one-beat gap", () => {
    const step = beatDistance(BEAT_BPM);
    expect(step).toBeCloseTo(BASE_SPEED * (60 / 96), 8);
    const a = quantizeLipY(500, 0);
    const b = quantizeLipY(a + 10, a);
    expect(b - a).toBeGreaterThanOrEqual(step - 1e-6);
  });

  it("enforces the gap on generated Beat courses", () => {
    const step = beatDistance();
    const course = generateCourse(1, { daily: true, variant: "beat" });
    const gates = scoringGates(course);
    expect(gates.length).toBeGreaterThan(3);
    for (let i = 1; i < gates.length; i++) {
      expect(gates[i]!.y - gates[i - 1]!.y).toBeGreaterThanOrEqual(step - 1e-6);
    }
    for (const g of gates) {
      const n = g.y / step;
      expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-6);
    }
  });
});

describe("feel-sanity 4 — Perfect windows touch vs keyboard", () => {
  it("uses ±120ms touch and ±100ms keyboard", () => {
    expect(BEAT_PERFECT_MS_TOUCH).toBe(120);
    expect(BEAT_PERFECT_MS_KEY).toBe(100);
    const period = 60 / BEAT_BPM;
    expect(isPerfectTiming(0, false)).toBe(true);
    expect(isPerfectTiming(0.1, false)).toBe(true);
    expect(isPerfectTiming(0.11, false)).toBe(false);
    expect(isPerfectTiming(0.11, true)).toBe(true);
    expect(isPerfectTiming(0.13, true)).toBe(false);
    expect(msToNearestBeat(period)).toBeCloseTo(0, 6);
  });

  it("still Perfects a beat-center lip but does not pay like a skim", () => {
    const y = beatDistance() * Math.ceil((DIST.openEnd + 80) / beatDistance());
    const gate = gateSpec({ y, left: 100, right: 260, baseCenter: 180, gapWidth: 160 });
    const world = worldWith("beat", 180, [gate]);
    world.time = y / BASE_SPEED - TICK;
    world.distance = y - BASE_SPEED * TICK * 0.5;
    world.prevDistance = world.distance - BASE_SPEED * TICK;
    updateWorld(world, { ...idle, touchScoring: false }, TICK);
    expect(world.cleanPasses).toBe(1);
    expect(world.perfects).toBe(1);
    expect(world.combo).toBe(0);
    expect(world.skimCash).toBe(0);
    expect(world.skimEvents).toBe(0);
    expect(worldScore(world)).toBe(0);
    expect(worldScore(world)).toBe(
      computeScore(world.distance, world.skimCash, world.comboPeak, world.skimEvents),
    );
  });

  it("withholds Perfect when crossing 110ms off the beat on keyboard", () => {
    const y = beatDistance() * Math.ceil((DIST.openEnd + 80) / beatDistance());
    const gate = gateSpec({ y, left: 100, right: 260, baseCenter: 180, gapWidth: 160 });
    const world = worldWith("beat", 180, [gate]);
    world.time = y / BASE_SPEED + 0.11 - TICK;
    world.distance = y - BASE_SPEED * TICK * 0.5;
    world.prevDistance = world.distance - BASE_SPEED * TICK;
    updateWorld(world, { ...idle, touchScoring: false, pointerActive: false }, TICK);
    expect(world.cleanPasses).toBe(1);
    expect(world.perfects).toBe(0);
  });

  it("still Perfects that 110ms miss on touch", () => {
    const y = beatDistance() * Math.ceil((DIST.openEnd + 80) / beatDistance());
    const gate = gateSpec({ y, left: 100, right: 260, baseCenter: 180, gapWidth: 160 });
    const world = worldWith("beat", 180, [gate]);
    world.time = y / BASE_SPEED + 0.11 - TICK;
    world.distance = y - BASE_SPEED * TICK * 0.5;
    world.prevDistance = world.distance - BASE_SPEED * TICK;
    updateWorld(world, hold(180, { touchScoring: true }), TICK);
    expect(world.cleanPasses).toBe(1);
    expect(world.perfects).toBe(1);
  });
});

describe("feel-sanity 5 — lanes lerp invuln and blocked input", () => {
  it("snaps to 90 / 180 / 270 within 80ms", () => {
    const world = worldWith("lanes", 180, []);
    expect(world.x).toBe(180);
    updateWorld(world, { ...idle, laneDelta: 1 }, TICK);
    const cap = Math.ceil(LANE_LERP_MS / 1000 / TICK);
    expect(cap * TICK).toBeGreaterThanOrEqual(LANE_LERP_MS / 1000);
    for (let i = 0; i < cap; i++) updateWorld(world, idle, TICK);
    expect(world.x).toBe(270);
    expect(world.laneLerp).toBe(1);
    expect(world.laneIndex).toBe(2);
  });

  it("blocks input into a currently blocked lane", () => {
    const lip = gateSpec({
      y: DIST.openEnd + 4,
      left: 0,
      right: 240,
      baseCenter: 120,
      gapWidth: 240,
    });
    const world = worldWith("lanes", 180, [lip]);
    updateWorld(world, { ...idle, laneDelta: 1 }, TICK);
    expect(world.laneIndex).toBe(1);
    expect(world.x).toBe(180);
    expect(world.laneLerp).toBe(1);
  });

  it("does not kill while lerping through a slab on the destination", () => {
    const lip = gateSpec({
      y: DIST.openEnd + 4,
      left: 0,
      right: 100,
      baseCenter: 50,
      gapWidth: 100,
    });
    const world = worldWith("lanes", 180, [lip]);
    world.laneFromX = 180;
    world.laneToX = 270;
    world.laneIndex = 2;
    world.laneLerp = 0;
    for (let i = 0; i < 4; i++) {
      updateWorld(world, idle, TICK);
      expect(world.alive, `tick ${i}`).toBe(true);
      expect(world.laneLerp).toBeLessThan(1);
    }
  });
});

describe("feel-sanity 6 — lanes Tension uses tile-edge + main rate-limit", () => {
  it("pulses once at a blocked neighbor edge and rate-limits like main", () => {
    const lip = gateSpec({
      y: DIST.openEnd + 40,
      left: 120,
      right: 360,
      baseCenter: 240,
      gapWidth: 240,
      thickness: 80,
    });
    expect(neighborLaneBlocked(1, { left: lip.left, right: lip.right })).toBe(true);
    const world = worldWith("lanes", 180, [lip]);
    world.distance = DIST.openEnd + 40;
    world.prevDistance = world.distance;
    updateWorld(world, idle, TICK);
    expect(world.alive).toBe(true);
    expect(world.tension).toBe(1);
    const first = world.time;
    for (let i = 0; i < 10; i++) updateWorld(world, idle, TICK);
    expect(world.tension).toBe(1);
    expect(world.tensionGainLock).toBeGreaterThan(0);
    const wait = Math.ceil(TENSION_GAIN_LOCK_MS / 1000 / TICK) + 2;
    for (let i = 0; i < wait; i++) updateWorld(world, idle, TICK);
    expect(world.time - first).toBeGreaterThanOrEqual(TENSION_GAIN_LOCK_MS / 1000 - 1e-6);
    expect(world.tension).toBe(2);
  });
});

describe("lanes layout", () => {
  it("keeps at least one safe lane on Daily lips", () => {
    const course = generateCourse(7, { daily: true, variant: "lanes" });
    for (const o of course.obstacles) {
      const width = o.right - o.left;
      expect(width).toBeGreaterThanOrEqual(120 - 1e-6);
    }
  });
});
