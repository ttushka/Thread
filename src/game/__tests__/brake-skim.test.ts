import { describe, expect, it } from "vitest";
import type { Intent } from "../../types.ts";
import { Game } from "../Game.ts";
import {
  BRAKE_SKIM_TEACH_KEY,
  brakeSkimTeachSeen,
  markBrakeSkimTeachSeen,
  type StorageLike,
} from "../persistence.ts";
import {
  BEAT_PULSE_SCALE_MAX,
  BEAT_SKIM_PARTICLE_BASE,
  BRAKE_SKIM_HEAT,
  BRAKE_SKIM_TEACH,
  BRAKE_SKIM_TEACH_S,
  VARIANT_TEACH,
  beatSkimParticleCount,
  beatSkimScale,
  brakeSkimScale,
  brakeSkimTeachOpacity,
} from "../variant.ts";
import { DIST, FIELD_W, TICK } from "../world/constants.ts";
import { createWorld, skimJuice, updateWorld } from "../world/simulate.ts";

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

function worldWith(variant: "control" | "brake" | "beat", x: number, reducedMotion = false) {
  const world = createWorld(1, { daily: true, reducedMotion, variant });
  world.course.keyframes = wideCorridor(100, 260);
  world.obstacles = [];
  world.distance = DIST.openEnd + 4;
  world.prevDistance = world.distance;
  world.x = x;
  world.prevX = x;
  return world;
}

function skimWall(variant: "control" | "brake" | "beat", brake = false, reducedMotion = false) {
  const world = worldWith(variant, 118, reducedMotion);
  updateWorld(world, hold(118, { brake }), TICK);
  return world;
}

function maxSpeed(world: ReturnType<typeof createWorld>): number {
  return Math.max(0, ...world.particles.map((p) => Math.hypot(p.vx, p.vy)));
}

function skimBrakeGame(storage: StorageLike | null, extra: Partial<Intent> = {}) {
  const game = new Game(storage, { endlessSeed: 1, variant: "brake" });
  game.startEndless();
  const world = game.world!;
  world.course.keyframes = wideCorridor(100, 260);
  world.obstacles = [];
  world.distance = DIST.openEnd + 4;
  world.prevDistance = world.distance;
  world.x = 118;
  world.prevX = 118;
  game.tick(hold(118, { brake: true, ...extra }), TICK);
  return game;
}

describe("BRAKE-SKIM-NARRATIVE-v1 tokens", () => {
  it("locks the one-time teach copy, duration, and pulse cap", () => {
    expect(BRAKE_SKIM_TEACH).toBe("Skim while slow — that's the craft.");
    expect(BRAKE_SKIM_TEACH_KEY).toBe("thread.v1.brakeSkimTeachSeen");
    expect(BRAKE_SKIM_TEACH_S).toBeCloseTo(3.5, 8);
    expect(brakeSkimTeachOpacity(0)).toBe(1);
    expect(brakeSkimTeachOpacity(3)).toBe(1);
    expect(brakeSkimTeachOpacity(3.25)).toBeCloseTo(0.5, 5);
    expect(brakeSkimTeachOpacity(3.5)).toBe(0);
    expect(BRAKE_SKIM_HEAT).toBe(0.5);
    expect(brakeSkimScale()).toBe(beatSkimScale(BRAKE_SKIM_HEAT));
    expect(brakeSkimScale()).toBeGreaterThan(1);
    expect(brakeSkimScale()).toBeLessThanOrEqual(BEAT_PULSE_SCALE_MAX);
    expect(beatSkimParticleCount(BRAKE_SKIM_HEAT)).toBeGreaterThan(BEAT_SKIM_PARTICLE_BASE);
  });
});

describe("BRAKE-SKIM-NARRATIVE-v1 pulse", () => {
  it("uses a stronger teal/ink pulse only when Brake is held", () => {
    const control = skimWall("control");
    const free = skimWall("brake", false);
    const held = skimWall("brake", true);

    expect(control.brakeSkimPulse).toBe(false);
    expect(control.brakeSkimEvent).toBe(false);
    expect(free.brakeSkimPulse).toBe(false);
    expect(free.brakeSkimEvent).toBe(false);
    expect(held.braking).toBe(true);
    expect(held.brakeSkimPulse).toBe(true);
    expect(held.brakeSkimEvent).toBe(true);
    expect(held.nearMissTimer).toBeGreaterThan(0);

    expect(control.particles).toHaveLength(beatSkimParticleCount(0));
    expect(free.particles).toHaveLength(control.particles.length);
    expect(held.particles).toHaveLength(beatSkimParticleCount(BRAKE_SKIM_HEAT));
    expect(held.particles.filter((p) => p.ink).length).toBe(
      beatSkimParticleCount(BRAKE_SKIM_HEAT) - BEAT_SKIM_PARTICLE_BASE,
    );
    expect(held.particles.filter((p) => !p.ink).length).toBe(BEAT_SKIM_PARTICLE_BASE);
    expect(control.particles.every((p) => !p.ink)).toBe(true);
    expect(free.particles.every((p) => !p.ink)).toBe(true);

    expect(maxSpeed(held) / maxSpeed(control)).toBeCloseTo(brakeSkimScale(), 8);
    expect(maxSpeed(held) / maxSpeed(control)).toBeLessThanOrEqual(BEAT_PULSE_SCALE_MAX + 1e-9);
    expect(skimJuice(held)).toBe(BRAKE_SKIM_HEAT);
    expect(skimJuice(control)).toBe(0);
    expect(skimJuice(free)).toBe(0);

    expect(held.tension).toBe(1);
    expect(control.tension).toBe(1);
    expect(held.x).toBeCloseTo(control.x, 8);
    expect(held.combo).toBe(0);
    expect(held.cleanPasses).toBe(0);
  });

  it("leaves Control and Beat pulse paths untouched", () => {
    const control = skimWall("control");
    const beat = skimWall("beat");
    expect(control.brakeSkimPulse).toBe(false);
    expect(beat.brakeSkimPulse).toBe(false);
    expect(control.brakeSkimEvent).toBe(false);
    expect(beat.brakeSkimEvent).toBe(false);
    expect(control.particles).toHaveLength(beatSkimParticleCount(0));
    expect(beat.particles).toHaveLength(beatSkimParticleCount(0));
    expect(control.particles.every((p) => !p.ink)).toBe(true);
    expect(beat.particles.every((p) => !p.ink)).toBe(true);
    expect(control.beatStreak).toBe(0);
    expect(beat.beatStreak).toBe(1);
    expect(control.tension).toBe(1);
    expect(beat.tension).toBe(1);
  });

  it("respects reduced motion for the pulse and still signals the skim", () => {
    const world = skimWall("brake", true, true);
    expect(world.reducedMotion).toBe(true);
    expect(world.brakeSkimEvent).toBe(true);
    expect(world.brakeSkimPulse).toBe(false);
    expect(world.particles).toHaveLength(0);
    expect(world.tension).toBe(1);
    expect(skimJuice(world)).toBe(0);
  });
});

describe("BRAKE-SKIM-NARRATIVE-v1 teach", () => {
  it("shows the fade line once, then sets the localStorage flag", () => {
    const storage = new MemoryStorage();
    const game = skimBrakeGame(storage);
    const snap = game.snapshot();
    expect(snap.variant).toBe("brake");
    expect(snap.teach).toBe(BRAKE_SKIM_TEACH);
    expect(snap.teachOpacity).toBe(1);
    expect(storage.getItem(BRAKE_SKIM_TEACH_KEY)).toBe("1");
    expect(brakeSkimTeachSeen(storage)).toBe(true);

    for (let i = 0; i < Math.round(3 / TICK); i++) game.tick(hold(180, { brake: true }), TICK);
    expect(game.snapshot().teach).toBe(BRAKE_SKIM_TEACH);
    expect(game.snapshot().teachOpacity).toBe(1);

    for (let i = 0; i < Math.round(0.6 / TICK); i++) game.tick(hold(180, { brake: true }), TICK);
    expect(game.snapshot().teachOpacity).toBe(0);
    expect(game.snapshot().teach).toBe(VARIANT_TEACH.brake);
  });

  it("does not re-show after the flag is set, including a new session", () => {
    const storage = new MemoryStorage();
    markBrakeSkimTeachSeen(storage);
    const game = skimBrakeGame(storage);
    expect(game.snapshot().teach).toBe(VARIANT_TEACH.brake);
    expect(game.snapshot().teachOpacity).toBe(1);
    expect(game.world!.brakeSkimEvent).toBe(false);
    expect(game.world!.brakeSkimPulse).toBe(true);

    const again = skimBrakeGame(storage);
    expect(again.snapshot().teach).toBe(VARIANT_TEACH.brake);
    expect(again.snapshot().teach).not.toBe(BRAKE_SKIM_TEACH);
    expect(storage.getItem(BRAKE_SKIM_TEACH_KEY)).toBe("1");
  });

  it("still teaches under mute and reduced motion", () => {
    const storage = new MemoryStorage();
    const game = new Game(storage, { endlessSeed: 1, variant: "brake" });
    game.toggleMuted();
    game.toggleReducedMotion();
    game.startEndless();
    const world = game.world!;
    world.course.keyframes = wideCorridor(100, 260);
    world.obstacles = [];
    world.distance = DIST.openEnd + 4;
    world.prevDistance = world.distance;
    world.x = 118;
    world.prevX = 118;
    game.tick(hold(118, { brake: true }), TICK);
    expect(game.snapshot().muted).toBe(true);
    expect(game.snapshot().reducedMotion).toBe(true);
    expect(game.snapshot().teach).toBe(BRAKE_SKIM_TEACH);
    expect(game.snapshot().teachOpacity).toBe(1);
    expect(world.particles).toHaveLength(0);
    expect(world.brakeSkimPulse).toBe(false);
    expect(storage.getItem(BRAKE_SKIM_TEACH_KEY)).toBe("1");
  });

  it("does not fire teach or flag on Control", () => {
    const storage = new MemoryStorage();
    const game = new Game(storage, { endlessSeed: 1, variant: "control" });
    game.startEndless();
    const world = game.world!;
    world.course.keyframes = wideCorridor(100, 260);
    world.obstacles = [];
    world.distance = DIST.openEnd + 4;
    world.prevDistance = world.distance;
    world.x = 118;
    world.prevX = 118;
    game.tick(hold(118, { brake: true }), TICK);
    expect(game.snapshot().teach).toBe(VARIANT_TEACH.control);
    expect(game.snapshot().teach).not.toBe(BRAKE_SKIM_TEACH);
    expect(world.brakeSkimEvent).toBe(false);
    expect(world.brakeSkimPulse).toBe(false);
    expect(world.particles).toHaveLength(beatSkimParticleCount(0));
    expect(storage.getItem(BRAKE_SKIM_TEACH_KEY)).toBeNull();
    expect(brakeSkimTeachSeen(storage)).toBe(false);
  });
});
