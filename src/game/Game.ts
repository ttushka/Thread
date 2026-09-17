import type { Mode, Screen, SfxCue, ThreadSaveV1 } from "../types.ts";
import type { Intent } from "../types.ts";
import {
  dailyAttemptsFor,
  dailyBestFor,
  loadSave,
  noteDailyAttempt,
  recordDailyRun,
  recordEndlessBest,
  type StorageLike,
  withMuted,
  withReducedMotion,
  writeSave,
} from "./persistence.ts";
import { dailyRunSeed } from "./modes/daily.ts";
import { endlessSeed } from "./modes/endless.ts";
import { utcDateKey } from "./seed.ts";
import { formatDailyShare, dailyDeepLink } from "./share.ts";
import { createWorld, deathPhase, updateWorld, worldScore, type World } from "./world/simulate.ts";

export type GameSnapshot = {
  screen: Screen;
  mode: Mode;
  dateKey: string;
  seed: number;
  score: number;
  combo: number;
  comboPeak: number;
  cleanPasses: number;
  distance: number;
  timeMs: number;
  endlessBest: number;
  dailyBest: number;
  dailyAttempts: number;
  shareLine: string | null;
  reducedMotion: boolean;
  overlayReady: boolean;
  today: string;
  archive: boolean;
  muted: boolean;
};

export class Game {
  screen: Screen = "title";
  mode: Mode = "endless";
  dateKey = utcDateKey();
  seed = 1;
  world: World | null = null;
  save: ThreadSaveV1;
  private storage: StorageLike | null;
  private injectedEndless: number | undefined;
  private ended = false;
  /** Latched until overlayReady so Enter during the death freeze is not dropped. */
  private restartQueued = false;
  private sfxQueue: SfxCue[] = [];

  constructor(storage: StorageLike | null, opts?: { endlessSeed?: number }) {
    this.storage = storage;
    this.save = loadSave(storage);
    this.injectedEndless = opts?.endlessSeed;
  }

  prefersReducedMotion(cssPrefers: boolean): void {
    if (this.save.settings?.reducedMotion !== undefined) return;
    this.save = withReducedMotion(this.save, cssPrefers);
  }

  toggleReducedMotion(): void {
    const next = !this.save.settings?.reducedMotion;
    this.save = withReducedMotion(this.save, next);
    writeSave(this.storage, this.save);
  }

  toggleMuted(): void {
    const next = !this.save.settings?.muted;
    this.save = withMuted(this.save, next);
    writeSave(this.storage, this.save);
  }

  drainSfx(): SfxCue[] {
    const out = this.sfxQueue;
    this.sfxQueue = [];
    return out;
  }

  startEndless(): void {
    this.mode = "endless";
    this.dateKey = utcDateKey();
    this.seed = endlessSeed(this.injectedEndless);
    this.beginRun();
  }

  startDaily(dateKey?: string): void {
    const today = utcDateKey();
    this.mode = "daily";
    this.dateKey = dateKey ?? today;
    this.seed = dailyRunSeed(this.dateKey);
    this.save = noteDailyAttempt(this.save, this.dateKey, today);
    writeSave(this.storage, this.save);
    this.beginRun();
  }

  restart(): void {
    if (this.mode === "daily") this.startDaily(this.dateKey);
    else this.startEndless();
  }

  toTitle(): void {
    this.screen = "title";
    this.world = null;
    this.ended = false;
    this.restartQueued = false;
  }

  private beginRun(): void {
    this.ended = false;
    this.restartQueued = false;
    this.world = createWorld(this.seed, {
      daily: this.mode === "daily",
      reducedMotion: Boolean(this.save.settings?.reducedMotion),
    });
    this.screen = "play";
  }

  tick(intent: Intent, dt: number): void {
    if (this.screen === "title") return;

    if (this.world && (this.screen === "play" || this.screen === "dead" || this.screen === "cleared")) {
      updateWorld(this.world, this.screen === "play" ? intent : idleIntent(), dt);
      this.takeSfx();
    }

    if (this.screen === "play" && this.world) {
      if (this.world.cleared) {
        this.finishRun("cleared");
      } else if (!this.world.alive) {
        this.finishRun("dead");
      }
    }

    const onResult = this.screen === "dead" || this.screen === "cleared";
    if (intent.restart && onResult) this.restartQueued = true;

    const overlayReady = this.world ? deathPhase(this.world).overlayReady : true;
    if (this.restartQueued && overlayReady && onResult) {
      this.restartQueued = false;
      this.restart();
      return;
    }
    if (intent.toTitle) this.toTitle();
  }

  private takeSfx(): void {
    if (!this.world || this.world.sfx.length === 0) return;
    this.sfxQueue.push(...this.world.sfx);
    this.world.sfx.length = 0;
  }

  private finishRun(kind: "dead" | "cleared"): void {
    if (this.ended || !this.world) return;
    this.ended = true;
    this.screen = kind;
    const today = utcDateKey();
    const score = worldScore(this.world);
    if (this.mode === "endless") {
      this.save = recordEndlessBest(this.save, score);
    } else {
      this.save = recordDailyRun(this.save, this.dateKey, score, today);
    }
    writeSave(this.storage, this.save);
  }

  snapshot(): GameSnapshot {
    const today = utcDateKey();
    const world = this.world;
    const score = world ? worldScore(world) : 0;
    const timeMs = world ? world.time * 1000 : 0;
    const url = dailyDeepLink(this.dateKey, publicBaseUrl());
    const shareLine =
      this.mode === "daily" && (this.screen === "dead" || this.screen === "cleared")
        ? formatDailyShare({
            dateKey: this.dateKey,
            score,
            timeMs,
            seed: this.seed,
            url,
            cleared: this.screen === "cleared",
          })
        : null;

    return {
      screen: this.screen,
      mode: this.mode,
      dateKey: this.dateKey,
      seed: this.seed,
      score,
      combo: world?.combo ?? 0,
      comboPeak: world?.comboPeak ?? 0,
      cleanPasses: world?.cleanPasses ?? 0,
      distance: world?.distance ?? 0,
      timeMs,
      endlessBest: this.save.endlessBest,
      dailyBest: dailyBestFor(this.save, today),
      dailyAttempts: dailyAttemptsFor(this.save, today),
      shareLine,
      reducedMotion: Boolean(this.save.settings?.reducedMotion),
      overlayReady: world ? deathPhase(world).overlayReady : true,
      today,
      archive: this.mode === "daily" && this.dateKey !== today,
      muted: Boolean(this.save.settings?.muted),
    };
  }
}

function idleIntent(): Intent {
  return {
    steer: 0,
    pointerActive: false,
    pointerX: 0,
    restart: false,
    toTitle: false,
  };
}

function publicBaseUrl(): string | undefined {
  const baked = import.meta.env.VITE_PUBLIC_URL;
  if (baked) return baked;
  if (typeof window !== "undefined") {
    const u = new URL(window.location.href);
    u.search = "";
    u.hash = "";
    return u.toString();
  }
  return undefined;
}
