import type { StorageLike } from "./persistence.ts";

/** Local calendar days this browser played. Separate from `thread.v1` scores. */
export const PLAY_DAYS_KEY = "thread.v1.playDays";
export const PLAY_DAYS_KEEP = 14;
export const RECURRENT_WINDOW_DAYS = 7;
export const RECURRENCE_LINE =
  "You’re on a return streak — Daily tomorrow locks the habit.";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** Local timezone calendar date as YYYY-MM-DD. */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isDayKey(value: string): boolean {
  return DAY_RE.test(value);
}

/** De-dupe valid YYYY-MM-DD strings and keep the last 14 chronological days. */
export function normalizePlayDays(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const days: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !DAY_RE.test(item)) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    days.push(item);
  }
  days.sort();
  return days.length > PLAY_DAYS_KEEP ? days.slice(-PLAY_DAYS_KEEP) : days;
}

export function loadPlayDays(storage: StorageLike | null | undefined): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PLAY_DAYS_KEY);
    if (!raw) return [];
    return normalizePlayDays(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function writePlayDays(storage: StorageLike | null | undefined, days: string[]): void {
  if (!storage) return;
  try {
    storage.setItem(PLAY_DAYS_KEY, JSON.stringify(normalizePlayDays(days)));
  } catch {
    // Quota / private mode — play without this stub.
  }
}

/**
 * Record a local play day. Idempotent for the same date.
 * `today` is injectable so tests do not depend on the machine clock.
 */
export function recordPlayDay(
  storage: StorageLike | null | undefined,
  today: string = localDateKey(),
): string[] {
  const days = loadPlayDays(storage);
  if (!DAY_RE.test(today)) return days;
  if (!days.includes(today)) days.push(today);
  const next = normalizePlayDays(days);
  writePlayDays(storage, next);
  return next;
}

/** Whole civil days from `from` to `to` (YYYY-MM-DD). */
export function civilDayDiff(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = Date.UTC(fy!, fm! - 1, fd!);
  const b = Date.UTC(ty!, tm! - 1, td!);
  return Math.round((b - a) / MS_PER_DAY);
}

/** Distinct stored days that fall in `[today - 6, today]` (7 local calendar days). */
export function uniqueDaysInLast7(days: readonly string[], today: string): number {
  const unique = new Set<string>();
  for (const day of days) {
    if (!DAY_RE.test(day)) continue;
    const diff = civilDayDiff(day, today);
    if (diff >= 0 && diff < RECURRENT_WINDOW_DAYS) unique.add(day);
  }
  return unique.size;
}

export function isRecurrentCandidate(days: readonly string[], today: string): boolean {
  return uniqueDaysInLast7(days, today) >= 2;
}

export function debugPlayDaysEnabled(search: string): boolean {
  const q = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(q).get("debug") === "1";
}
