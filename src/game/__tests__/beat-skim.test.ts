import { describe, expect, it } from "vitest";
import type { Intent, ObstacleSpec } from "../../types.ts";
import { Game } from "../Game.ts";
import {
  BEAT_SKIM_TEACH_KEY,
  beatSkimTeachSeen,
  markBeatSkimTeachSeen,
  type StorageLike,
} from "../persistence.ts";
import { CLEAN_AWARD, cleanPassAward } from "../score.ts";
import {
  BEAT_SKIM_MS,
  BEAT_SKIM_EARLY_MS,
  BEAT_SKIM_FORGIVE_STREAK,
  BEAT_SKIM_TEACH,
  BEAT_SKIM_TEACH_S,
  BEAT_PULSE_SCALE_MAX,
  CONTROL_SKIM_HEAT,
  VARIANT_TEACH,
  beatIntensityFromStreak,
  beatSkimParticleCount,
  beatSkimScale,
  beatSkimTeachOpacity,
} from "../variant.ts";
import {
  BASE_SPEED,
  DIST,
  FIELD_W,
  GATE_LIP_THICKNESS,
  TENSION_GAIN_LOCK_MS,
  TICK,
} from "../world/constants.ts";
import { beatDistance, beatPeriod, isSkimTiming, msToNearestBeat, skimWindowMs } from "../world/beat.ts";
import { createWorld, updateWorld } from "../world/simulate.ts";

const hold = (x: number): Intent => ({
  steer: 0,
  pointerActive: true,
  pointerX: x,
  restart: false,
  toTitle: false,
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

function worldWith(variant: "control" | "brake" | "beat", x: number, gates: ObstacleSpec[]) {
  const world = createWorld(1, { daily: true, reducedMotion: true, variant });
  world.course.keyframes = wideCorridor();
  world.obstacles = gates.map((g) => ({ ...g, passed: false, nicked: false }));
  world.distance = DIST.openEnd + 4;
  world.prevDistance = world.distance;
  world.x = x;
  world.prevX = x;
  return world;
}

function skimWall(variant: "control" | "brake" | "beat", time: number) {
  const world = worldWith(variant, 118, []);
  world.course.keyframes = wideCorridor(100, 260);
  world.time = time - TICK;
  updateWorld(world, hold(118), TICK);
  return world;
}

function onBeatGate(id: number, y: number): ObstacleSpec {
  return gateSpec({ id, y, left: 100, right: 260, baseCenter: 180, gapWidth: 160 });
}

function crossAt(world: ReturnType<typeof createWorld>, y: number, extra: Partial<Intent> = {}): void {
  world.time = y / BASE_SPEED - TICK;
  world.distance = y - BASE_SPEED * TICK * 0.5;
  world.prevDistance = world.distance - BASE_SPEED * TICK;
  updateWorld(world, { ...idle, touchScoring: false, ...extra }, TICK);
}

describe("BEAT-SKIM-MASTERY-v1", () => {
  it("uses the Perfect clock for a ±180ms skim window at streak ≥ 3", () => {
    expect(skimWindowMs(BEAT_SKIM_FORGIVE_STREAK)).toBe(BEAT_SKIM_MS);
    expect(isSkimTiming(0, BEAT_SKIM_FORGIVE_STREAK)).toBe(true);
    expect(isSkimTiming(BEAT_SKIM_MS / 1000, BEAT_SKIM_FORGIVE_STREAK)).toBe(true);
    expect(isSkimTiming(BEAT_SKIM_MS / 1000 + 0.001, BEAT_SKIM_FORGIVE_STREAK)).toBe(false);
    expect(msToNearestBeat(BEAT_SKIM_MS / 1000)).toBeCloseTo(BEAT_SKIM_MS, 6);
  });

  it("credits beatStreak once when a near-miss starts in the skim window", () => {
    const world = skimWall("beat", 0);
    expect(world.tension).toBe(1);
    expect(world.nearMissTimer).toBeGreaterThan(0);
    expect(world.beatSkimEvent).toBe(true);
    expect(world.beatStreak).toBe(1);
    expect(world.beatHeat).toBeCloseTo(beatIntensityFromStreak(1), 8);
    expect(msToNearestBeat(world.time)).toBeLessThanOrEqual(BEAT_SKIM_MS);
    expect(world.reducedMotion).toBe(true);
    expect(world.particles).toHaveLength(0);
  });

  it("credits under reduced-motion and still breaks on nick", () => {
    const world = skimWall("beat", 0);
    expect(world.reducedMotion).toBe(true);
    expect(world.beatStreak).toBe(1);
    expect(world.particles).toHaveLength(0);

    world.x = 108;
    world.prevX = 108;
    updateWorld(world, hold(108), TICK);
    expect(world.alive).toBe(true);
    expect(world.nickTimer).toBeGreaterThan(0);
    expect(world.beatStreak).toBe(0);
  });

  it("ignores a second near-miss on the same beat index", () => {
    const beatT = beatPeriod();
    const firstT = beatT - (BEAT_SKIM_MS / 1000 - 0.02);
    const world = skimWall("beat", firstT);
    expect(world.beatStreak).toBe(1);
    expect(world.tension).toBe(1);

    const wait = Math.ceil(TENSION_GAIN_LOCK_MS / 1000 / TICK) + 2;
    for (let i = 0; i < wait; i++) updateWorld(world, hold(118), TICK);
    expect(world.tension).toBe(2);
    expect(msToNearestBeat(world.time)).toBeLessThanOrEqual(BEAT_SKIM_MS);
    expect(world.beatStreak).toBe(1);
    expect(world.beatHeat).toBeCloseTo(beatIntensityFromStreak(1), 8);
  });

  it("does not double Perfect + skim on the same beat — still +1 total", () => {
    const y = beatDistance() * Math.ceil((DIST.openEnd + 80) / beatDistance());
    const world = worldWith("beat", 118, [onBeatGate(1, y)]);
    world.x = 118;
    world.prevX = 118;
    crossAt(world, y);
    expect(world.cleanPasses).toBe(1);
    expect(world.perfects).toBe(1);
    expect(world.sfx).toContain("tension");
    expect(world.cleanAward).toBe(cleanPassAward(1));
    expect(world.cleanAward).toBeGreaterThan(CLEAN_AWARD);
    expect(world.beatStreak).toBe(1);
    expect(world.beatHeat).toBeCloseTo(beatIntensityFromStreak(1), 8);
  });

  it("does not latch a skim-teach event on a centered Perfect with no near-miss", () => {
    const y = beatDistance() * Math.ceil((DIST.openEnd + 80) / beatDistance());
    const world = worldWith("beat", 180, [onBeatGate(1, y)]);
    world.x = 180;
    world.prevX = 180;
    crossAt(world, y);
    expect(world.cleanPasses).toBe(1);
    expect(world.perfects).toBe(1);
    expect(world.beatStreak).toBe(1);
    expect(world.nearMissTimer).toBe(0);
    expect(world.beatSkimEvent).toBe(false);
  });

  it("does not credit a near-miss outside the early ±240ms window", () => {
    const world = skimWall("beat", BEAT_SKIM_EARLY_MS / 1000 + 0.02);
    expect(world.tension).toBe(1);
    expect(world.nearMissTimer).toBeGreaterThan(0);
    expect(world.beatSkimEvent).toBe(false);
    expect(world.beatStreak).toBe(0);
    expect(world.beatHeat).toBe(0);
    expect(msToNearestBeat(world.time)).toBeGreaterThan(BEAT_SKIM_EARLY_MS);
  });

  it("leaves Control and Brake streak/heat untouched", () => {
    for (const variant of ["control", "brake"] as const) {
      const world = skimWall(variant, 0);
      expect(world.tension).toBe(1);
      expect(world.beatStreak).toBe(0);
      expect(world.beatHeat).toBe(0);
      expect(world.beatSkimEvent).toBe(false);
      expect(world.perfects).toBe(0);
    }
  });

  it("scales near-miss juice with current heat without changing physics", () => {
    const cold = worldWith("beat", 118, []);
    cold.reducedMotion = false;
    cold.course.keyframes = wideCorridor(100, 260);
    cold.time = BEAT_SKIM_EARLY_MS / 1000 + 0.02 - TICK;
    updateWorld(cold, hold(118), TICK);
    expect(cold.beatStreak).toBe(0);
    expect(cold.particles).toHaveLength(beatSkimParticleCount(0));
    expect(cold.particles.every((p) => !p.ink)).toBe(true);

    const hot = worldWith("beat", 118, []);
    hot.reducedMotion = false;
    hot.course.keyframes = wideCorridor(100, 260);
    hot.beatStreak = 8;
    hot.beatHeat = 1;
    hot.time = BEAT_SKIM_EARLY_MS / 1000 + 0.02 - TICK;
    updateWorld(hot, hold(118), TICK);
    expect(hot.beatStreak).toBe(7);
    expect(hot.particles).toHaveLength(beatSkimParticleCount(1));
    expect(hot.particles.filter((p) => p.ink).length).toBe(4);
    expect(hot.particles.filter((p) => !p.ink).length).toBe(4);
    expect(hot.particles.some((p) => Math.hypot(p.vx, p.vy) > 18)).toBe(true);
    const hotSp = Math.max(...hot.particles.map((p) => Math.hypot(p.vx, p.vy)));
    const coldSp = Math.max(...cold.particles.map((p) => Math.hypot(p.vx, p.vy)));
    expect(hotSp / coldSp).toBeCloseTo(beatSkimScale(1), 8);
    expect(hotSp / coldSp).toBeLessThanOrEqual(BEAT_PULSE_SCALE_MAX + 1e-9);
    expect(hot.distance).toBeCloseTo(cold.distance, 8);
    expect(hot.x).toBeCloseTo(cold.x, 8);

    const control = worldWith("control", 118, []);
    control.reducedMotion = false;
    control.course.keyframes = wideCorridor(100, 260);
    control.time = BEAT_SKIM_EARLY_MS / 1000 + 0.02 - TICK;
    updateWorld(control, hold(118), TICK);
    expect(control.particles).toHaveLength(beatSkimParticleCount(CONTROL_SKIM_HEAT));
    expect(control.beatStreak).toBe(0);
    expect(control.distance).toBeCloseTo(cold.distance, 8);
  });
});

describe("BEAT-FORGIVE-RUNG-v1", () => {
  it("widens the on-pulse skim window to ±240ms while streak < 3", () => {
    expect(skimWindowMs(0)).toBe(BEAT_SKIM_EARLY_MS);
    expect(skimWindowMs(2)).toBe(BEAT_SKIM_EARLY_MS);
    expect(isSkimTiming(BEAT_SKIM_EARLY_MS / 1000, 0)).toBe(true);
    expect(isSkimTiming(BEAT_SKIM_EARLY_MS / 1000 + 0.001, 0)).toBe(false);

    const early = skimWall("beat", BEAT_SKIM_MS / 1000 + 0.02);
    expect(msToNearestBeat(early.time)).toBeGreaterThan(BEAT_SKIM_MS);
    expect(msToNearestBeat(early.time)).toBeLessThanOrEqual(BEAT_SKIM_EARLY_MS);
    expect(early.beatSkimEvent).toBe(true);
    expect(early.beatStreak).toBe(1);
  });

  it("restores the ±180ms mastery window at streak ≥ 3", () => {
    expect(skimWindowMs(3)).toBe(BEAT_SKIM_MS);
    expect(skimWindowMs(8)).toBe(BEAT_SKIM_MS);
    expect(isSkimTiming(BEAT_SKIM_MS / 1000, 3)).toBe(true);
    expect(isSkimTiming(BEAT_SKIM_MS / 1000 + 0.001, 3)).toBe(false);

    const world = worldWith("beat", 118, []);
    world.course.keyframes = wideCorridor(100, 260);
    world.beatStreak = 3;
    world.beatHeat = beatIntensityFromStreak(3);
    world.time = BEAT_SKIM_MS / 1000 + 0.02 - TICK;
    updateWorld(world, hold(118), TICK);
    expect(msToNearestBeat(world.time)).toBeGreaterThan(BEAT_SKIM_MS);
    expect(msToNearestBeat(world.time)).toBeLessThanOrEqual(BEAT_SKIM_EARLY_MS);
    expect(world.beatSkimEvent).toBe(false);
    expect(world.beatStreak).toBe(2);
  });

  it("drops streak by exactly −1 on an off-pulse near-miss, without wiping heat", () => {
    const world = worldWith("beat", 118, []);
    world.course.keyframes = wideCorridor(100, 260);
    world.beatStreak = 5;
    world.beatHeat = beatIntensityFromStreak(5);
    const heatBefore = world.beatHeat;
    world.time = BEAT_SKIM_EARLY_MS / 1000 + 0.02 - TICK;
    updateWorld(world, hold(118), TICK);
    expect(world.tension).toBe(1);
    expect(world.beatSkimEvent).toBe(false);
    expect(world.beatStreak).toBe(4);
    expect(world.beatHeat).toBeGreaterThan(beatIntensityFromStreak(4));
    expect(world.beatHeat).toBeGreaterThan(heatBefore * 0.5);
    expect(world.beatHeat).toBeLessThanOrEqual(heatBefore);
    expect(msToNearestBeat(world.time)).toBeGreaterThan(BEAT_SKIM_EARLY_MS);
  });

  it("floors an off-pulse miss at streak 0 and leaves Control/Brake at 0", () => {
    const beat = skimWall("beat", BEAT_SKIM_EARLY_MS / 1000 + 0.02);
    expect(beat.beatStreak).toBe(0);
    expect(beat.beatHeat).toBe(0);
    for (const variant of ["control", "brake"] as const) {
      const world = worldWith(variant, 118, []);
      world.course.keyframes = wideCorridor(100, 260);
      world.beatStreak = 4;
      world.time = BEAT_SKIM_EARLY_MS / 1000 + 0.02 - TICK;
      updateWorld(world, hold(118), TICK);
      expect(world.beatStreak).toBe(0);
      expect(world.beatHeat).toBe(0);
      expect(world.beatSkimEvent).toBe(false);
    }
  });
});

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function skimBeatGame(storage: StorageLike | null, extra: Partial<Intent> = {}) {
  const game = new Game(storage, { endlessSeed: 1, variant: "beat" });
  game.startEndless();
  const world = game.world!;
  world.course.keyframes = wideCorridor(100, 260);
  world.obstacles = [];
  world.distance = DIST.openEnd + 4;
  world.prevDistance = world.distance;
  world.x = 118;
  world.prevX = 118;
  world.time = 0;
  game.tick({ ...hold(118), ...extra }, TICK);
  return game;
}

describe("BEAT-TEACH-SKIM-ON-PULSE-v1 tokens", () => {
  it("locks picker copy, one-time craft line, flag, and fade", () => {
    expect(VARIANT_TEACH.beat).toBe("Skim the wall on the pulse \u2014 that\u2019s the craft. Click optional.");
    expect(BEAT_SKIM_TEACH).toBe("Skim on the pulse \u2014 that\u2019s the craft.");
    expect(BEAT_SKIM_TEACH_KEY).toBe("thread.v1.beatSkimTeachSeen");
    expect(BEAT_SKIM_TEACH_S).toBeCloseTo(3.5, 8);
    expect(beatSkimTeachOpacity(0)).toBe(1);
    expect(beatSkimTeachOpacity(3)).toBe(1);
    expect(beatSkimTeachOpacity(3.25)).toBeCloseTo(0.5, 5);
    expect(beatSkimTeachOpacity(3.5)).toBe(0);
    expect(VARIANT_TEACH.beat).not.toMatch(/wrong|missed/i);
    expect(BEAT_SKIM_TEACH).not.toMatch(/wrong|missed/i);
    expect(VARIANT_TEACH.control).toBe("Skim the edge \u2014 that\u2019s the craft.");
    expect(VARIANT_TEACH.brake).toBe("Hold Brake (or Space) to slow. Steer the gaps.");
  });
});

describe("BEAT-TEACH-SKIM-ON-PULSE-v1 teach", () => {
  it("shows the fade line once, then sets the localStorage flag", () => {
    const storage = new MemoryStorage();
    const game = skimBeatGame(storage);
    const snap = game.snapshot();
    expect(snap.variant).toBe("beat");
    expect(snap.teach).toBe(BEAT_SKIM_TEACH);
    expect(snap.teachOpacity).toBe(1);
    expect(game.world!.beatStreak).toBe(1);
    expect(storage.getItem(BEAT_SKIM_TEACH_KEY)).toBe("1");
    expect(beatSkimTeachSeen(storage)).toBe(true);

    for (let i = 0; i < Math.round(3 / TICK); i++) game.tick(hold(180), TICK);
    expect(game.snapshot().teach).toBe(BEAT_SKIM_TEACH);
    expect(game.snapshot().teachOpacity).toBe(1);

    for (let i = 0; i < Math.round(0.6 / TICK); i++) game.tick(hold(180), TICK);
    expect(game.snapshot().teachOpacity).toBe(0);
    expect(game.snapshot().teach).toBe(VARIANT_TEACH.beat);
  });

  it("does not re-show after the flag is set, including a new session", () => {
    const storage = new MemoryStorage();
    markBeatSkimTeachSeen(storage);
    const game = skimBeatGame(storage);
    expect(game.snapshot().teach).toBe(VARIANT_TEACH.beat);
    expect(game.snapshot().teachOpacity).toBe(1);
    expect(game.world!.beatSkimEvent).toBe(false);
    expect(game.world!.beatStreak).toBe(1);

    const again = skimBeatGame(storage);
    expect(again.snapshot().teach).toBe(VARIANT_TEACH.beat);
    expect(again.snapshot().teach).not.toBe(BEAT_SKIM_TEACH);
    expect(storage.getItem(BEAT_SKIM_TEACH_KEY)).toBe("1");
  });

  it("still teaches under mute and reduced motion", () => {
    const storage = new MemoryStorage();
    const game = new Game(storage, { endlessSeed: 1, variant: "beat" });
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
    world.time = 0;
    game.tick(hold(118), TICK);
    expect(game.snapshot().muted).toBe(true);
    expect(game.snapshot().reducedMotion).toBe(true);
    expect(game.snapshot().teach).toBe(BEAT_SKIM_TEACH);
    expect(game.snapshot().teachOpacity).toBe(1);
    expect(world.particles).toHaveLength(0);
    expect(storage.getItem(BEAT_SKIM_TEACH_KEY)).toBe("1");
  });

  it("does not fire teach or flag on Control, Brake, or an off-pulse skim", () => {
    const storage = new MemoryStorage();
    for (const variant of ["control", "brake"] as const) {
      const game = new Game(storage, { endlessSeed: 1, variant });
      game.startEndless();
      const world = game.world!;
      world.course.keyframes = wideCorridor(100, 260);
      world.obstacles = [];
      world.distance = DIST.openEnd + 4;
      world.prevDistance = world.distance;
      world.x = 118;
      world.prevX = 118;
      world.time = 0;
      game.tick(hold(118), TICK);
      expect(game.snapshot().teach).toBe(VARIANT_TEACH[variant]);
      expect(game.snapshot().teach).not.toBe(BEAT_SKIM_TEACH);
      expect(world.beatSkimEvent).toBe(false);
      expect(world.beatStreak).toBe(0);
    }
    expect(storage.getItem(BEAT_SKIM_TEACH_KEY)).toBeNull();
    expect(beatSkimTeachSeen(storage)).toBe(false);

    const miss = new Game(storage, { endlessSeed: 1, variant: "beat" });
    miss.startEndless();
    const world = miss.world!;
    world.course.keyframes = wideCorridor(100, 260);
    world.obstacles = [];
    world.distance = DIST.openEnd + 4;
    world.prevDistance = world.distance;
    world.x = 118;
    world.prevX = 118;
    world.time = BEAT_SKIM_EARLY_MS / 1000 + 0.02 - TICK;
    miss.tick(hold(118), TICK);
    expect(miss.snapshot().teach).toBe(VARIANT_TEACH.beat);
    expect(miss.snapshot().teach).not.toBe(BEAT_SKIM_TEACH);
    expect(world.beatSkimEvent).toBe(false);
    expect(world.beatStreak).toBe(0);
    expect(storage.getItem(BEAT_SKIM_TEACH_KEY)).toBeNull();
  });
});
