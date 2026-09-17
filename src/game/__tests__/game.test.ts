import { describe, expect, it } from "vitest";
import { Game } from "../Game.ts";
import { isOverlayRetryTarget } from "../input.ts";
import { SAVE_KEY, type StorageLike } from "../persistence.ts";
import { DIST, TICK } from "../world/constants.ts";
import { createWorld, deathPhase } from "../world/simulate.ts";
import type { Intent } from "../../types.ts";

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const idle: Intent = {
  steer: 0,
  pointerActive: false,
  pointerX: 180,
  restart: false,
  toTitle: false,
};

describe("Game persistence", () => {
  it("writes thread.v1 after an Endless run ends", () => {
    const storage = new MemoryStorage();
    const game = new Game(storage, { endlessSeed: 42 });
    game.startEndless();
    expect(game.world).not.toBeNull();
    game.world!.distance = 400;
    game.world!.cleanPasses = 2;
    game.world!.cleanAward = 100;
    game.world!.comboPeak = 2;
    game.world!.alive = false;
    game.tick(idle, TICK);
    const raw = storage.getItem(SAVE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { v: number; endlessBest: number; daily: unknown };
    expect(parsed.v).toBe(1);
    expect(parsed.endlessBest).toBe(400 + 100 + 50);
    expect(parsed).not.toHaveProperty("thread_pb_endless");
  });

  it("restarts Daily from the same seed", () => {
    const game = new Game(new MemoryStorage());
    game.startDaily("2026-09-17");
    const seed = game.seed;
    game.world!.alive = false;
    game.tick({ ...idle, restart: true }, TICK);
    expect(game.seed).toBe(seed);
    if (game.world) game.world.deathAge = 0.25;
    game.tick({ ...idle, restart: true }, TICK);
    expect(game.mode).toBe("daily");
    expect(game.seed).toBe(seed);
    expect(game.screen).toBe("play");
  });
});

describe("death juice", () => {
  it("does not apply the fail flash while the thread is alive", () => {
    const world = createWorld(1, { daily: true, reducedMotion: false });
    expect(world.alive).toBe(true);
    expect(deathPhase(world).flash).toBe(0);
  });

  it("treats a clear as terminal overlay-ready even if alive was left true", () => {
    const world = createWorld(1, { daily: true, reducedMotion: false });
    world.cleared = true;
    world.alive = true;
    const phase = deathPhase(world);
    expect(phase.overlayReady).toBe(true);
    expect(phase.flash).toBe(0);
    expect(phase.dissolve).toBe(0);
  });
});

describe("Daily clear path", () => {
  it("forced finish shows result overlay, share copy, and accepts retry", () => {
    const game = new Game(new MemoryStorage());
    game.startDaily("2026-09-17");
    const world = game.world!;
    // Opening corridor is no-fail; land the finish line there so the sim must clear.
    world.course.finishY = 90;
    world.obstacles.length = 0;
    for (let i = 0; i < 90 && game.screen === "play"; i++) {
      game.tick(idle, TICK);
    }
    expect(game.screen).toBe("cleared");
    expect(world.cleared).toBe(true);
    expect(world.alive).toBe(false);
    const snap = game.snapshot();
    expect(snap.overlayReady).toBe(true);
    expect(snap.shareLine).toMatch(/beat my time/);
    expect(snap.shareLine).not.toMatch(/beat my score/);
    game.tick({ ...idle, restart: true }, TICK);
    expect(game.screen).toBe("play");
    expect(game.mode).toBe("daily");
    expect(game.dateKey).toBe("2026-09-17");
  });

  it("death share asks to beat the score, not a time", () => {
    const game = new Game(new MemoryStorage());
    game.startDaily("2026-09-17");
    game.world!.alive = false;
    game.tick(idle, TICK);
    expect(game.screen).toBe("dead");
    expect(game.snapshot().shareLine).toMatch(/beat my score/);
    expect(game.snapshot().shareLine).not.toMatch(/\btime\b/i);
  });
});

describe("sound setting", () => {
  it("toggles muted into thread.v1", () => {
    const storage = new MemoryStorage();
    const game = new Game(storage);
    expect(game.snapshot().muted).toBe(false);
    game.toggleMuted();
    expect(game.snapshot().muted).toBe(true);
    const parsed = JSON.parse(storage.getItem(SAVE_KEY)!) as { settings?: { muted?: boolean } };
    expect(parsed.settings?.muted).toBe(true);
    game.toggleMuted();
    expect(game.snapshot().muted).toBe(false);
  });

  it("drains death sfx once when a run snags", () => {
    const game = new Game(new MemoryStorage(), { endlessSeed: 1 });
    game.startEndless();
    const world = game.world!;
    world.course.keyframes = [
      { y: 0, left: 100, right: 260, gateId: null },
      { y: 8000, left: 100, right: 260, gateId: null },
    ];
    world.obstacles.length = 0;
    world.distance = DIST.openEnd + 20;
    world.prevDistance = world.distance;
    world.x = 8;
    game.tick({ ...idle, pointerActive: true, pointerX: 8 }, TICK);
    expect(game.screen).toBe("dead");
    expect(game.drainSfx()).toEqual(["death"]);
    game.tick(idle, TICK);
    expect(game.drainSfx()).toEqual([]);
  });
});

describe("restart queue", () => {
  it("keeps restart queued through the death freeze until overlayReady", () => {
    const game = new Game(new MemoryStorage(), { endlessSeed: 1 });
    game.startEndless();
    game.world!.alive = false;
    game.tick({ ...idle, restart: true }, TICK);
    expect(game.screen).toBe("dead");
    expect(deathPhase(game.world!).overlayReady).toBe(false);
    let restarted = false;
    for (let i = 0; i < 20; i++) {
      game.tick(idle, TICK);
      if (game.screen === "play") {
        restarted = true;
        break;
      }
    }
    expect(restarted).toBe(true);
  });

  it("restarts on the same tick once the overlay is already eligible", () => {
    const game = new Game(new MemoryStorage(), { endlessSeed: 1 });
    game.startEndless();
    game.world!.alive = false;
    game.tick(idle, TICK);
    game.world!.deathAge = 0.25;
    game.tick({ ...idle, restart: true }, TICK);
    expect(game.screen).toBe("play");
  });

  it("does not latch Enter pressed while still playing", () => {
    const game = new Game(new MemoryStorage(), { endlessSeed: 1 });
    game.startEndless();
    game.tick({ ...idle, restart: true }, TICK);
    expect(game.screen).toBe("play");
    game.world!.alive = false;
    game.tick(idle, TICK);
    expect(game.screen).toBe("dead");
    for (let i = 0; i < 20; i++) game.tick(idle, TICK);
    expect(game.screen).toBe("dead");
    expect(game.snapshot().overlayReady).toBe(true);
  });
});

describe("overlay tap retry", () => {
  it("retries from backdrop/panel, not from action buttons", () => {
    expect(isOverlayRetryTarget(null)).toBe(true);
    const panel = { closest: (sel: string) => (sel === "button" ? null : null) };
    expect(isOverlayRetryTarget(panel as unknown as EventTarget)).toBe(true);
    const btn = { closest: (sel: string) => (sel === "button" ? btn : null) };
    expect(isOverlayRetryTarget(btn as unknown as EventTarget)).toBe(false);
  });
});
