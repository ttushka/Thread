import { describe, expect, it } from "vitest";
import type { Intent } from "../../types.ts";
import {
  CX,
  FIELD_W,
  POINTER_LERP,
  STEER_KEY_ACCEL,
  STEER_KEY_DECEL,
  STEER_KEY_TAP_CAP,
  STEER_KEY_TAP_MS,
  STEER_SPEED,
  TICK,
} from "../world/constants.ts";
import { createWorld, stepSteerSmooth, updateWorld } from "../world/simulate.ts";
import type { ExperimentVariant } from "../variant.ts";

const key = (steer: number): Intent => ({
  steer,
  pointerActive: false,
  pointerX: CX,
  restart: false,
  toTitle: false,
});

const pointerAt = (x: number, extra: Partial<Intent> = {}): Intent => ({
  steer: 0,
  pointerActive: true,
  pointerX: x,
  restart: false,
  toTitle: false,
  ...extra,
});

function openWorld(variant: ExperimentVariant = "control") {
  const world = createWorld(1, { daily: true, reducedMotion: true, variant });
  world.course.keyframes = [
    { y: 0, left: 16, right: FIELD_W - 16, gateId: null },
    { y: 8000, left: 16, right: FIELD_W - 16, gateId: null },
  ];
  world.obstacles = [];
  world.x = CX;
  world.prevX = CX;
  return world;
}

describe("KEYBOARD-STEER-FINE-v1 constants", () => {
  it("keeps max STEER_SPEED and locks the key ramp", () => {
    expect(STEER_SPEED).toBe(280);
    expect(POINTER_LERP).toBe(11);
    expect(STEER_KEY_ACCEL).toBe(3.2);
    expect(STEER_KEY_DECEL).toBe(6.0);
    expect(STEER_KEY_TAP_MS).toBe(80);
    expect(STEER_KEY_TAP_CAP).toBe(0.35);
  });
});

describe("stepSteerSmooth", () => {
  it("approaches ±1 at STEER_KEY_ACCEL and 0 at STEER_KEY_DECEL", () => {
    const press = stepSteerSmooth(0, 0, 1, TICK);
    expect(press.steerSmooth).toBeCloseTo(STEER_KEY_ACCEL * TICK, 10);
    expect(press.steerKeyAge).toBeCloseTo(TICK, 10);

    const held = stepSteerSmooth(press.steerSmooth, press.steerKeyAge, 1, TICK);
    expect(held.steerSmooth).toBeCloseTo(STEER_KEY_ACCEL * TICK * 2, 10);

    const released = stepSteerSmooth(0.5, 0.2, 0, TICK);
    expect(released.steerSmooth).toBeCloseTo(0.5 - STEER_KEY_DECEL * TICK, 10);
    expect(released.steerKeyAge).toBe(0);
  });

  it("caps |steerSmooth| at 0.35 during the first 80ms of a new press", () => {
    const tapped = stepSteerSmooth(0.8, 0, 1, TICK);
    expect(tapped.steerSmooth).toBeCloseTo(STEER_KEY_TAP_CAP, 10);
    expect(tapped.steerKeyAge).toBeLessThan(STEER_KEY_TAP_MS / 1000);

    let age = 0;
    let smooth = 0;
    const holdTicks = Math.ceil(STEER_KEY_TAP_MS / 1000 / TICK) + 8;
    for (let i = 0; i < holdTicks; i++) {
      const next = stepSteerSmooth(smooth, age, 1, TICK);
      smooth = next.steerSmooth;
      age = next.steerKeyAge;
    }
    expect(age).toBeGreaterThan(STEER_KEY_TAP_MS / 1000);
    expect(smooth).toBeGreaterThan(STEER_KEY_TAP_CAP);
    expect(smooth).toBeLessThanOrEqual(1);
  });
});

describe("keyboard steer in the world", () => {
  it("makes a short tap a small nudge, not a digital jump", () => {
    const world = openWorld();
    const digitalJump = STEER_SPEED * TICK * 2;
    updateWorld(world, key(1), TICK);
    updateWorld(world, key(1), TICK);
    for (let i = 0; i < 12; i++) updateWorld(world, key(0), TICK);
    const nudge = world.x - CX;
    expect(nudge).toBeGreaterThan(0);
    expect(nudge).toBeLessThan(digitalJump * 0.25);
    expect(world.steerSmooth).toBeCloseTo(0, 8);
  });

  it("reaches full STEER_SPEED while a key is held", () => {
    const world = openWorld();
    const rampTicks = Math.ceil(1 / STEER_KEY_ACCEL / TICK) + 2;
    for (let i = 0; i < rampTicks; i++) updateWorld(world, key(1), TICK);
    expect(world.steerSmooth).toBeCloseTo(1, 8);
    const x = world.x;
    updateWorld(world, key(1), TICK);
    expect(world.x - x).toBeCloseTo(STEER_SPEED * TICK, 8);
  });

  it("applies the same ramp in Brake and Beat continuous-steer modes", () => {
    for (const variant of ["brake", "beat"] as const) {
      const world = openWorld(variant);
      updateWorld(world, { ...key(1), brake: variant === "brake" }, TICK);
      expect(world.steerSmooth, variant).toBeCloseTo(STEER_KEY_ACCEL * TICK, 10);
      expect(world.x, variant).toBeGreaterThan(CX);
      expect(world.x - CX, variant).toBeCloseTo(world.steerSmooth * STEER_SPEED * TICK, 8);
    }
  });

  it("does not change the pointer/touch path even if a key is held", () => {
    const keyed = openWorld();
    const idleKeys = openWorld();
    updateWorld(keyed, pointerAt(240, { steer: 1 }), TICK);
    updateWorld(idleKeys, pointerAt(240, { steer: 0 }), TICK);
    expect(keyed.x).toBe(idleKeys.x);
    expect(keyed.steerSmooth).toBe(0);
    const expected = CX + (240 - CX) * (1 - Math.exp(-POINTER_LERP * TICK));
    expect(keyed.x).toBeCloseTo(expected, 8);
  });

  it("leaves Lanes on discrete laneDelta (keyboard ±1 does not analog-steer)", () => {
    const world = openWorld("lanes");
    expect(world.x).toBe(CX);
    updateWorld(world, key(1), TICK);
    expect(world.x).toBe(CX);
    expect(world.steerSmooth).toBe(0);
  });
});
