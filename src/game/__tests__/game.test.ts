import { describe, expect, it } from "vitest";
import { Game } from "../Game.ts";
import { SAVE_KEY, type StorageLike } from "../persistence.ts";
import { TICK } from "../world/constants.ts";
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
    // overlay not ready yet — still same run
    expect(game.seed).toBe(seed);
    if (game.world) game.world.deathAge = 0.25;
    game.tick({ ...idle, restart: true }, TICK);
    expect(game.mode).toBe("daily");
    expect(game.seed).toBe(seed);
    expect(game.screen).toBe("play");
  });
});
