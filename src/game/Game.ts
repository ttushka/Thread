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
  withBrakeHudPos,
  brakeHudPos,
  withMuted,
  withReducedMotion,
  writeSave,
  brakeSkimTeachSeen,
  markBrakeSkimTeachSeen,
  beatSkimTeachSeen,
  markBeatSkimTeachSeen,
  skimScoreTeachSeen,
  markSkimScoreTeachSeen,
} from "./persistence.ts";
import { dailyRunSeed } from "./modes/daily.ts";
import { endlessSeed } from "./modes/endless.ts";
import { utcDateKey } from "./seed.ts";
import { formatDailyShare, dailyDeepLink } from "./share.ts";
import {
  VARIANT_LABEL,
  VARIANT_TEACH,
  inRunTeachOpacity,
  brakeSkimTeachOpacity,
  beatSkimTeachOpacity,
  BRAKE_SKIM_TEACH,
  BEAT_SKIM_TEACH,
  SCORE_SKIM_TEACH,
  skimScoreTeachOpacity,
  RESULT_NO_SKIM,
  type ExperimentVariant,
} from "./variant.ts";
import { createWorld, deathPhase, updateWorld, worldScore, type World } from "./world/simulate.ts";
import {
  RECURRENCE_LINE,
  isRecurrentCandidate,
  loadPlayDays,
  localDateKey,
  recordPlayDay,
  uniqueDaysInLast7,
} from "./playDays.ts";

export type GameSnapshot = {
  screen: Screen;
  mode: Mode;
  dateKey: string;
  seed: number;
  score: number;
  combo: number;
  comboPeak: number;
  cleanPasses: number;
  skimEvents: number;
  throughFlash: boolean;
  scoreTick: boolean;
  noSkimResult: string | null;
  perfects: number;
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
  variant: ExperimentVariant;
  variantLabel: string;
  teach: string;
  teachOpacity: number;
  braking: boolean;
  beatMuted: boolean;
  recurrentCandidate: boolean;
  playDaysCount: number;
  recurrenceLine: string | null;
};

export class Game {
  screen: Screen = "title";
  mode: Mode = "endless";
  dateKey = utcDateKey();
  seed = 1;
  world: World | null = null;
  save: ThreadSaveV1;
  variant: ExperimentVariant = "control";
  beatMuted = false;
  private storage: StorageLike | null;
  private injectedEndless: number | undefined;
  private ended = false;
  /** Latched until overlayReady so Enter during the death freeze is not dropped. */
  private restartQueued = false;
  private sfxQueue: SfxCue[] = [];
  /** Age in seconds while Brake skim teach is showing; `done` until the next run. */
  private brakeSkimTeach: { age: number } | "done" | null = null;
  private brakeSkimTeachSeen = false;
  /** Age in seconds while Beat skim teach is showing; `done` until the next run. */
  private beatSkimTeach: { age: number } | "done" | null = null;
  private beatSkimTeachSeen = false;
  /** Age in seconds while first-run score teach is showing; `done` until the next run. */
  private skimScoreTeach: { age: number } | "done" | null = null;
  private skimScoreTeachSeen = false;
  private playDays: string[] = [];
  private playDayNoted = false;

  constructor(storage: StorageLike | null, opts?: { endlessSeed?: number; variant?: ExperimentVariant }) {
    this.storage = storage;
    this.save = loadSave(storage);
    this.injectedEndless = opts?.endlessSeed;
    if (opts?.variant) this.variant = opts.variant;
    this.brakeSkimTeachSeen = brakeSkimTeachSeen(storage);
    this.beatSkimTeachSeen = beatSkimTeachSeen(storage);
    this.skimScoreTeachSeen = skimScoreTeachSeen(storage);
    this.playDays = loadPlayDays(storage);
  }

  setVariant(variant: ExperimentVariant): void {
    this.variant = variant;
  }

  toggleBeatMute(): void {
    this.beatMuted = !this.beatMuted;
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

  brakeHudPos(): { x: number; y: number } | null {
    return brakeHudPos(this.save);
  }

  setBrakeHudPos(pos: { x: number; y: number } | null): void {
    this.save = withBrakeHudPos(this.save, pos);
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
    this.brakeSkimTeach = null;
    this.beatSkimTeach = null;
    this.skimScoreTeach = null;
  }

  private beginRun(): void {
    this.ended = false;
    this.restartQueued = false;
    this.brakeSkimTeach = null;
    this.beatSkimTeach = null;
    this.skimScoreTeach = null;
    this.playDayNoted = false;
    this.world = createWorld(this.seed, {
      daily: this.mode === "daily",
      reducedMotion: Boolean(this.save.settings?.reducedMotion),
      variant: this.variant,
    });
    this.screen = "play";
    this.notePlayDay();
    this.beginSkimScoreTeach();
  }

  private notePlayDay(): void {
    this.playDays = recordPlayDay(this.storage, localDateKey());
    this.playDayNoted = true;
  }

  tick(intent: Intent, dt: number): void {
    if (this.screen === "title") return;

    if (this.screen === "play" && !this.playDayNoted && hasPlayInput(intent)) {
      this.notePlayDay();
    }

    if (this.world && (this.screen === "play" || this.screen === "dead" || this.screen === "cleared")) {
      updateWorld(this.world, this.screen === "play" ? intent : idleIntent(), dt);
      this.takeSfx();
      if (this.screen === "play") {
        this.stepBrakeSkimTeach(dt);
        this.stepBeatSkimTeach(dt);
        this.stepSkimScoreTeach(dt);
      }
      this.noteBrakeSkim();
      this.noteBeatSkim();
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

  private noteBrakeSkim(): void {
    if (!this.world?.brakeSkimEvent) return;
    this.world.brakeSkimEvent = false;
    if (this.variant !== "brake") return;
    if (this.brakeSkimTeachSeen) return;
    this.brakeSkimTeachSeen = true;
    markBrakeSkimTeachSeen(this.storage);
    this.brakeSkimTeach = { age: 0 };
    this.skimScoreTeach = "done";
  }

  private stepBrakeSkimTeach(dt: number): void {
    if (!this.brakeSkimTeach || this.brakeSkimTeach === "done") return;
    this.brakeSkimTeach.age += dt;
    if (brakeSkimTeachOpacity(this.brakeSkimTeach.age) <= 0) this.brakeSkimTeach = "done";
  }

  private noteBeatSkim(): void {
    if (!this.world?.beatSkimEvent) return;
    this.world.beatSkimEvent = false;
    if (this.variant !== "beat") return;
    if (this.beatSkimTeachSeen) return;
    this.beatSkimTeachSeen = true;
    markBeatSkimTeachSeen(this.storage);
    this.beatSkimTeach = { age: 0 };
    this.skimScoreTeach = "done";
  }

  private stepBeatSkimTeach(dt: number): void {
    if (!this.beatSkimTeach || this.beatSkimTeach === "done") return;
    this.beatSkimTeach.age += dt;
    if (beatSkimTeachOpacity(this.beatSkimTeach.age) <= 0) this.beatSkimTeach = "done";
  }

  private beginSkimScoreTeach(): void {
    if (this.skimScoreTeachSeen) return;
    this.skimScoreTeachSeen = true;
    markSkimScoreTeachSeen(this.storage);
    this.skimScoreTeach = { age: 0 };
  }

  private stepSkimScoreTeach(dt: number): void {
    if (!this.skimScoreTeach || this.skimScoreTeach === "done") return;
    this.skimScoreTeach.age += dt;
    if (skimScoreTeachOpacity(this.skimScoreTeach.age) <= 0) this.skimScoreTeach = "done";
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

    const skimTeach = this.brakeSkimTeach;
    const beatTeach = this.beatSkimTeach;
    const scoreTeach = this.skimScoreTeach;
    let teach = VARIANT_TEACH[this.variant];
    let teachOpacity = this.screen === "play" && world ? inRunTeachOpacity(world.time) : 0;
    if (this.screen === "play" && scoreTeach && scoreTeach !== "done") {
      teach = SCORE_SKIM_TEACH;
      teachOpacity = skimScoreTeachOpacity(scoreTeach.age);
    }
    if (this.screen === "play" && skimTeach && skimTeach !== "done") {
      teach = BRAKE_SKIM_TEACH;
      teachOpacity = brakeSkimTeachOpacity(skimTeach.age);
    }
    if (this.screen === "play" && beatTeach && beatTeach !== "done") {
      teach = BEAT_SKIM_TEACH;
      teachOpacity = beatSkimTeachOpacity(beatTeach.age);
    }
    const oneShotDone =
      scoreTeach === "done" || skimTeach === "done" || beatTeach === "done";
    if (oneShotDone && teach === VARIANT_TEACH[this.variant]) teachOpacity = 0;

    const todayLocal = localDateKey();
    const recurrentCandidate = isRecurrentCandidate(this.playDays, todayLocal);

    return {
      screen: this.screen,
      mode: this.mode,
      dateKey: this.dateKey,
      seed: this.seed,
      score,
      combo: world?.combo ?? 0,
      comboPeak: world?.comboPeak ?? 0,
      cleanPasses: world?.cleanPasses ?? 0,
      skimEvents: world?.skimEvents ?? 0,
      throughFlash: Boolean(world && world.throughTimer > 0),
      scoreTick: Boolean(world?.scoreTickEvent),
      noSkimResult:
        (this.screen === "dead" || this.screen === "cleared") && (world?.skimEvents ?? 0) === 0
          ? RESULT_NO_SKIM
          : null,
      perfects: world?.perfects ?? 0,
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
      variant: this.variant,
      variantLabel: VARIANT_LABEL[this.variant],
      teach,
      teachOpacity,
      braking: Boolean(world?.braking),
      beatMuted: this.beatMuted,
      recurrentCandidate,
      playDaysCount: uniqueDaysInLast7(this.playDays, todayLocal),
      recurrenceLine: recurrentCandidate ? RECURRENCE_LINE : null,
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
    brake: false,
    laneDelta: 0,
    touchScoring: false,
  };
}

function hasPlayInput(intent: Intent): boolean {
  return (
    intent.pointerActive ||
    intent.steer !== 0 ||
    Boolean(intent.brake) ||
    Boolean(intent.laneDelta)
  );
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
