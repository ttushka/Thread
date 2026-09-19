import type { ThreadSaveV1 } from "../types.ts";

export const SAVE_KEY = "thread.v1";
/** One-time Brake skim teach. Survives runs; cleared only by a settings wipe. */
export const BRAKE_SKIM_TEACH_KEY = "thread.v1.brakeSkimTeachSeen";
/** One-time Beat skim-on-pulse teach. Survives runs; cleared only by a settings wipe. */
export const BEAT_SKIM_TEACH_KEY = "thread.v1.beatSkimTeachSeen";

const EMPTY: ThreadSaveV1 = {
  v: 1,
  endlessBest: 0,
  daily: { dateKey: "", best: 0, attempts: 0 },
};

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function emptySave(): ThreadSaveV1 {
  return {
    v: 1,
    endlessBest: 0,
    daily: { dateKey: "", best: 0, attempts: 0 },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Read `thread.v1`. Missing or unknown versions reset safely and never throw.
 */
export function loadSave(storage: StorageLike | null | undefined): ThreadSaveV1 {
  if (!storage) return emptySave();
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return emptySave();
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || parsed.v !== 1) return emptySave();

    const dailyRaw = isObject(parsed.daily) ? parsed.daily : {};
    const settingsRaw = isObject(parsed.settings) ? parsed.settings : undefined;

    const save: ThreadSaveV1 = {
      v: 1,
      endlessBest: Math.max(0, Math.floor(asFiniteNumber(parsed.endlessBest, 0))),
      daily: {
        dateKey: typeof dailyRaw.dateKey === "string" ? dailyRaw.dateKey : "",
        best: Math.max(0, Math.floor(asFiniteNumber(dailyRaw.best, 0))),
        attempts: Math.max(0, Math.floor(asFiniteNumber(dailyRaw.attempts, 0))),
      },
    };

    if (settingsRaw) {
      save.settings = {
        reducedMotion: Boolean(settingsRaw.reducedMotion),
        muted: Boolean(settingsRaw.muted),
      };
      const hudRaw = isObject(settingsRaw.hud) ? settingsRaw.hud : undefined;
      const brakeRaw = hudRaw && isObject(hudRaw.brake) ? hudRaw.brake : undefined;
      if (brakeRaw) {
        const x = asFiniteNumber(brakeRaw.x, Number.NaN);
        const y = asFiniteNumber(brakeRaw.y, Number.NaN);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          save.settings.hud = { brake: { x, y } };
        }
      }
    }
    return save;
  } catch {
    return emptySave();
  }
}

export function brakeSkimTeachSeen(storage: StorageLike | null | undefined): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(BRAKE_SKIM_TEACH_KEY) === "1";
  } catch {
    return false;
  }
}

export function markBrakeSkimTeachSeen(storage: StorageLike | null | undefined): void {
  if (!storage) return;
  try {
    storage.setItem(BRAKE_SKIM_TEACH_KEY, "1");
  } catch {
    // Quota / private mode — teach may reappear this session.
  }
}

export function beatSkimTeachSeen(storage: StorageLike | null | undefined): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(BEAT_SKIM_TEACH_KEY) === "1";
  } catch {
    return false;
  }
}

export function markBeatSkimTeachSeen(storage: StorageLike | null | undefined): void {
  if (!storage) return;
  try {
    storage.setItem(BEAT_SKIM_TEACH_KEY, "1");
  } catch {
    // Quota / private mode — teach may reappear this session.
  }
}

export function writeSave(storage: StorageLike | null | undefined, save: ThreadSaveV1): void {
  if (!storage) return;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Quota / private mode — play without persistence.
  }
}

export function dailyBestFor(save: ThreadSaveV1, dateKey: string): number {
  return save.daily.dateKey === dateKey ? save.daily.best : 0;
}

export function dailyAttemptsFor(save: ThreadSaveV1, dateKey: string): number {
  if (save.daily.dateKey !== dateKey) return 0;
  return save.daily.attempts ?? 0;
}

export function recordEndlessBest(save: ThreadSaveV1, score: number): ThreadSaveV1 {
  return {
    ...save,
    endlessBest: Math.max(save.endlessBest, Math.max(0, Math.floor(score))),
  };
}

export function recordDailyRun(
  save: ThreadSaveV1,
  dateKey: string,
  score: number,
  today: string,
): ThreadSaveV1 {
  if (dateKey !== today) return save;
  const sameDay = save.daily.dateKey === dateKey;
  const prevBest = sameDay ? save.daily.best : 0;
  const prevAttempts = sameDay ? (save.daily.attempts ?? 0) : 0;
  return {
    ...save,
    daily: {
      dateKey,
      best: Math.max(prevBest, Math.max(0, Math.floor(score))),
      attempts: prevAttempts,
    },
  };
}

export function noteDailyAttempt(save: ThreadSaveV1, dateKey: string, today: string): ThreadSaveV1 {
  if (dateKey !== today) return save;
  const sameDay = save.daily.dateKey === dateKey;
  return {
    ...save,
    daily: {
      dateKey,
      best: sameDay ? save.daily.best : 0,
      attempts: (sameDay ? (save.daily.attempts ?? 0) : 0) + 1,
    },
  };
}

export function withReducedMotion(save: ThreadSaveV1, reducedMotion: boolean): ThreadSaveV1 {
  return {
    ...save,
    settings: { ...save.settings, reducedMotion },
  };
}

export function withMuted(save: ThreadSaveV1, muted: boolean): ThreadSaveV1 {
  return {
    ...save,
    settings: { ...save.settings, muted },
  };
}

export function brakeHudPos(save: ThreadSaveV1): { x: number; y: number } | null {
  const pos = save.settings?.hud?.brake;
  if (!pos) return null;
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
  return { x: pos.x, y: pos.y };
}

export function withBrakeHudPos(
  save: ThreadSaveV1,
  pos: { x: number; y: number } | null,
): ThreadSaveV1 {
  const settings = { ...save.settings };
  const hud = { ...settings.hud };
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    hud.brake = { x: pos.x, y: pos.y };
    settings.hud = hud;
  } else {
    delete hud.brake;
    if (Object.keys(hud).length > 0) settings.hud = hud;
    else delete settings.hud;
  }
  return { ...save, settings };
}

export { EMPTY as EMPTY_SAVE };
