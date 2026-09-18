import { describe, expect, it } from "vitest";
import type { Intent } from "../../types.ts";
import { LANE_X } from "../variant.ts";
import {
  FIELD_W,
  POINTER_LERP,
  STEER_KEY_ACCEL,
  STEER_KEY_DECEL,
  STEER_SPEED,
  STEER_TAP_BIAS_CAP,
  STEER_TAP_BIAS_MS,
  TICK,
} from "../world/constants.ts";
import { createWorld, updateWorld } from "../world/simulate.ts";
import { createSteerSmoothState, stepSteerSmooth } from "../world/steer.ts";

const idle: Intent = {
  steer: 0,
  pointerActive: false,
  pointerX: 180,
  restart: false,
  toTitle: false,
};

const key = (steer: number, extra: Partial<Intent> = {}): Intent => ({
  ...idle,
  steer,
  ...extra,
});

const pointer = (x: number, extra: Partial<Intent> = {}): Intent => ({
  ...idle,
  pointerActive: true,
  pointerX: x,
  ...extra,
});

function wideCorridor() {
  return [
    { y: 0, left: 16, right: FIELD_W - 16, gateId: null },
    { y: 8000, left: 16, right: FIELD_W - 16, gateId: null },
  ];
}

function playfield(
  variant: "control" | "brake" | "beat" | "lanes" = "control",
  x = 180,
) {
  const world = createWorld(1, { daily: true, reducedMotion: true, variant });
  world.course.keyframes = wideCorridor();
  world.obstacles = [];
  world.x = x;
  world.prevX = x;
  if (variant === "lanes") {
    world.laneIndex = 1;
    world.laneFromX = x;
    world.laneToX = LANE_X[1]!;
    world.laneLerp = 1;
  }
  return world;
}

describe("keyboard steer constants", () => {
  it("keeps held-key max at 280 and under 300", () => {
    expect(STEER_SPEED).toBe(280);
    expect(STEER_SPEED).toBeLessThanOrEqual(300);
    expect(STEER_KEY_ACCEL).toBe(3.2);
    expect(STEER_KEY_DECEL).toBe(6.0);
    expect(STEER_TAP_BIAS_MS).toBe(80);
    expect(STEER_TAP_BIAS_CAP).toBe(0.35);
    expect(POINTER_LERP).toBe(11);
  });
});

describe("stepSteerSmooth ramp", () => {
  it("accels toward key intent and decels faster to 0", () => {
    const state = createSteerSmoothState();
    stepSteerSmooth(state, 1, 0.1);
    expect(state.steerSmooth).toBeCloseTo(STEER_KEY_ACCEL * 0.1, 8);

    const held = createSteerSmoothState();
    stepSteerSmooth(held, 1, 1);
    expect(held.steerSmooth).toBe(1);

    const releasing = { ...held };
    stepSteerSmooth(releasing, 0, 1 / STEER_KEY_DECEL);
    expect(releasing.steerSmooth).toBeCloseTo(0, 8);

    const accelTime = 1 / STEER_KEY_ACCEL;
    const decelTime = 1 / STEER_KEY_DECEL;
    expect(decelTime).toBeLessThan(accelTime);
    expect(accelTime).toBeCloseTo(0.3125, 6);
    expect(decelTime).toBeCloseTo(1 / 6, 6);
  });

  it("caps a new press during the first 80ms, then allows full accel", () => {
    const fromRest = createSteerSmoothState();
    stepSteerSmooth(fromRest, 1, STEER_TAP_BIAS_MS / 1000);
    expect(fromRest.steerSmooth).toBeCloseTo(STEER_KEY_ACCEL * (STEER_TAP_BIAS_MS / 1000), 8);
    expect(fromRest.steerSmooth).toBeLessThanOrEqual(STEER_TAP_BIAS_CAP);

    // Second tap while still coasting: leftover + accel would overshoot the nudge cap.
    const retap = createSteerSmoothState();
    retap.steerSmooth = 0.33;
    stepSteerSmooth(retap, 1, 0.07);
    expect(retap.steerPressAge).toBeLessThanOrEqual(STEER_TAP_BIAS_MS / 1000);
    expect(STEER_KEY_ACCEL * 0.07 + 0.33).toBeGreaterThan(STEER_TAP_BIAS_CAP);
    expect(retap.steerSmooth).toBe(STEER_TAP_BIAS_CAP);

    const held = { ...retap };
    stepSteerSmooth(held, 1, 0.1);
    expect(held.steerPressAge).toBeGreaterThan(STEER_TAP_BIAS_MS / 1000);
    expect(held.steerSmooth).toBeCloseTo(STEER_TAP_BIAS_CAP + STEER_KEY_ACCEL * 0.1, 8);
    expect(held.steerSmooth).toBeGreaterThan(STEER_TAP_BIAS_CAP);
  });

  it("does not snap leftover momentum when reversing during the tap window", () => {
    const state = createSteerSmoothState();
    state.steerSmooth = 1;
    state.steerKeyIntent = 1;
    state.steerPressAge = 1;
    stepSteerSmooth(state, -1, TICK);
    expect(state.steerSmooth).toBeCloseTo(1 - STEER_KEY_ACCEL * TICK, 8);
    expect(state.steerSmooth).toBeGreaterThan(STEER_TAP_BIAS_CAP);
  });
});

describe("keyboard steer in simulate", () => {
  it("makes a short tap a small nudge, not a digital lane jump", () => {
    const world = playfield();
    const tapTicks = 3;
    for (let i = 0; i < tapTicks; i++) updateWorld(world, key(1), TICK);
    for (let i = 0; i < 12 && Math.abs(world.steerSmooth) > 1e-6; i++) updateWorld(world, idle, TICK);
    const dx = world.x - 180;
    expect(dx).toBeGreaterThan(0.4);
    expect(dx).toBeLessThan(8);
    expect(dx).toBeLessThan(STEER_SPEED * tapTicks * TICK * 0.5);
  });

  it("reaches prior max steer feel within ~0.3s of hold", () => {
    const world = playfield();
    const holdS = 1 / STEER_KEY_ACCEL;
    const ticks = Math.ceil(holdS / TICK);
    for (let i = 0; i < ticks; i++) updateWorld(world, key(1), TICK);
    expect(world.time).toBeGreaterThanOrEqual(holdS - TICK);
    expect(world.time).toBeLessThan(0.35);
    expect(world.steerSmooth).toBeCloseTo(1, 8);

    const next = world.x;
    updateWorld(world, key(1), TICK);
    expect(world.x - next).toBeCloseTo(STEER_SPEED * TICK, 8);
  });

  it("keeps the analog pointer path unchanged", () => {
    const keys = playfield();
    const analog = playfield();
    keys.steerSmooth = 1;
    for (let i = 0; i < 8; i++) {
      updateWorld(keys, pointer(240, { steer: 1 }), TICK);
      updateWorld(analog, pointer(240), TICK);
    }
    expect(keys.x).toBe(analog.x);
    expect(keys.x).toBeGreaterThan(180);
    expect(keys.x).toBeLessThan(240);
  });

  it("ramps in control, beat, and brake, not lanes", () => {
    for (const variant of ["control", "beat", "brake"] as const) {
      const world = playfield(variant);
      updateWorld(world, key(1, { brake: variant === "brake" }), TICK);
      expect(world.steerSmooth, variant).toBeCloseTo(STEER_KEY_ACCEL * TICK, 8);
      expect(world.x, variant).toBeGreaterThan(180);
    }
    const lanes = playfield("lanes", 180);
    const x0 = lanes.x;
    for (let i = 0; i < 10; i++) updateWorld(lanes, key(1), TICK);
    expect(lanes.x).toBe(x0);
    expect(lanes.steerSmooth).toBe(0);
  });
});
