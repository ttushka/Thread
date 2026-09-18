import { describe, expect, it } from "vitest";
import { Game } from "../Game.ts";
import type { StorageLike } from "../persistence.ts";
import {
  PLAY_DAYS_KEY,
  PLAY_DAYS_KEEP,
  RECURRENCE_LINE,
  debugPlayDaysEnabled,
  isRecurrentCandidate,
  loadPlayDays,
  localDateKey,
  normalizePlayDays,
  recordPlayDay,
  uniqueDaysInLast7,
} from "../playDays.ts";

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("playDays de-dupe", () => {
  it("uses the versioned localStorage key", () => {
    expect(PLAY_DAYS_KEY).toBe("thread.v1.playDays");
  });

  it("drops duplicates, junk, and keeps the last 14 chronological days", () => {
    const days: string[] = [];
    for (let i = 1; i <= 16; i++) days.push(`2026-08-${String(i).padStart(2, "0")}`);
    const messy = ["nope", "2026-08-03", ...days, 12, null, "2026-08-03"];
    const next = normalizePlayDays(messy);
    expect(next).toHaveLength(PLAY_DAYS_KEEP);
    expect(next[0]).toBe("2026-08-03");
    expect(next.at(-1)).toBe("2026-08-16");
    expect(new Set(next).size).toBe(PLAY_DAYS_KEEP);
  });

  it("recording the same local day twice writes one entry", () => {
    const s = new MemoryStorage();
    expect(recordPlayDay(s, "2026-09-18")).toEqual(["2026-09-18"]);
    expect(recordPlayDay(s, "2026-09-18")).toEqual(["2026-09-18"]);
    expect(JSON.parse(s.getItem(PLAY_DAYS_KEY)!)).toEqual(["2026-09-18"]);
  });

  it("never throws on junk and never writes network-looking payloads", () => {
    const s = new MemoryStorage();
    s.setItem(PLAY_DAYS_KEY, "not-json");
    expect(loadPlayDays(s)).toEqual([]);
    s.setItem(PLAY_DAYS_KEY, JSON.stringify({ days: ["2026-09-18"] }));
    expect(loadPlayDays(s)).toEqual([]);
    const next = recordPlayDay(s, "2026-09-18");
    expect(next).toEqual(["2026-09-18"]);
    expect(s.getItem(PLAY_DAYS_KEY)).toBe(JSON.stringify(["2026-09-18"]));
  });
});

describe("playDays 7-day window", () => {
  const today = "2026-09-18";

  it("is not a candidate on a single day", () => {
    expect(uniqueDaysInLast7(["2026-09-18"], today)).toBe(1);
    expect(isRecurrentCandidate(["2026-09-18"], today)).toBe(false);
  });

  it("is a candidate with two distinct days inside the last 7", () => {
    expect(isRecurrentCandidate(["2026-09-17", "2026-09-18"], today)).toBe(true);
    expect(isRecurrentCandidate(["2026-09-12", "2026-09-18"], today)).toBe(true);
    expect(uniqueDaysInLast7(["2026-09-12", "2026-09-15", "2026-09-18"], today)).toBe(3);
  });

  it("ignores days at or beyond 7 days ago", () => {
    // last 7 local dates: 2026-09-12 .. 2026-09-18
    expect(isRecurrentCandidate(["2026-09-11", "2026-09-18"], today)).toBe(false);
    expect(uniqueDaysInLast7(["2026-09-11", "2026-09-18"], today)).toBe(1);
    expect(isRecurrentCandidate(["2026-09-01", "2026-09-10"], today)).toBe(false);
  });

  it("does not count future dates or duplicates toward the window", () => {
    expect(uniqueDaysInLast7(["2026-09-17", "2026-09-17", "2026-09-19"], today)).toBe(1);
    expect(isRecurrentCandidate(["2026-09-17", "2026-09-17"], today)).toBe(false);
  });
});

describe("playDays session start", () => {
  it("records local today on Endless start without touching thread.v1", () => {
    const storage = new MemoryStorage();
    const game = new Game(storage, { endlessSeed: 1 });
    expect(game.snapshot().recurrentCandidate).toBe(false);
    game.startEndless();
    const today = localDateKey();
    expect(JSON.parse(storage.getItem(PLAY_DAYS_KEY)!)).toEqual([today]);
    expect(storage.getItem("thread.v1")).toBeNull();
    game.startEndless();
    expect(JSON.parse(storage.getItem(PLAY_DAYS_KEY)!)).toEqual([today]);
  });

  it("flips recurrentCandidate when a prior day in the last 7 is stored", () => {
    const storage = new MemoryStorage();
    const today = localDateKey();
    const prior = new Date();
    prior.setDate(prior.getDate() - 2);
    recordPlayDay(storage, localDateKey(prior));
    const game = new Game(storage, { endlessSeed: 1 });
    expect(game.snapshot().recurrentCandidate).toBe(false);
    game.startEndless();
    expect(game.snapshot().recurrentCandidate).toBe(true);
    expect(game.snapshot().playDaysCount).toBe(2);
    expect(game.snapshot().recurrenceLine).toBe(RECURRENCE_LINE);
    expect(JSON.parse(storage.getItem(PLAY_DAYS_KEY)!)).toEqual([localDateKey(prior), today].sort());
  });

  it("exposes debug=1 only for the opt-in query", () => {
    expect(debugPlayDaysEnabled("?debug=1")).toBe(true);
    expect(debugPlayDaysEnabled("debug=1")).toBe(true);
    expect(debugPlayDaysEnabled("?daily=2026-09-18")).toBe(false);
    expect(debugPlayDaysEnabled("?debug=true")).toBe(false);
  });
});
