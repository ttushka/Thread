import { describe, expect, it } from "vitest";
import {
  SAVE_KEY,
  dailyAttemptsFor,
  dailyBestFor,
  loadSave,
  noteDailyAttempt,
  recordDailyRun,
  recordEndlessBest,
  writeSave,
  type StorageLike,
} from "../persistence.ts";

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("thread.v1 persistence", () => {
  it("uses a single versioned key and empty-safe read", () => {
    expect(SAVE_KEY).toBe("thread.v1");
    const save = loadSave(new MemoryStorage());
    expect(save).toEqual({
      v: 1,
      endlessBest: 0,
      daily: { dateKey: "", best: 0, attempts: 0 },
    });
  });

  it("never throws on junk / unknown version", () => {
    const s = new MemoryStorage();
    s.setItem(SAVE_KEY, "not-json");
    expect(loadSave(s).v).toBe(1);
    s.setItem(SAVE_KEY, JSON.stringify({ v: 99, endlessBest: 12 }));
    expect(loadSave(s).endlessBest).toBe(0);
  });

  it("keeps endless best monotonic and writes the object schema", () => {
    const s = new MemoryStorage();
    let save = loadSave(s);
    save = recordEndlessBest(save, 100);
    save = recordEndlessBest(save, 80);
    save = recordEndlessBest(save, 140);
    writeSave(s, save);
    const round = loadSave(s);
    expect(round.endlessBest).toBe(140);
    expect(JSON.parse(s.getItem(SAVE_KEY)!)).toMatchObject({
      v: 1,
      endlessBest: 140,
    });
  });

  it("resets daily best when dateKey is not today", () => {
    const s = new MemoryStorage();
    let save = loadSave(s);
    save = noteDailyAttempt(save, "2026-09-16", "2026-09-16");
    save = recordDailyRun(save, "2026-09-16", 900, "2026-09-16");
    writeSave(s, save);
    save = loadSave(s);
    expect(dailyBestFor(save, "2026-09-17")).toBe(0);
    expect(dailyAttemptsFor(save, "2026-09-17")).toBe(0);
    save = noteDailyAttempt(save, "2026-09-17", "2026-09-17");
    expect(save.daily.dateKey).toBe("2026-09-17");
    expect(save.daily.best).toBe(0);
    expect(save.daily.attempts).toBe(1);
  });

  it("does not record archive daily scores onto today", () => {
    let save = loadSave(new MemoryStorage());
    save = noteDailyAttempt(save, "2026-09-10", "2026-09-17");
    save = recordDailyRun(save, "2026-09-10", 5000, "2026-09-17");
    expect(save.daily.dateKey).toBe("");
    expect(save.daily.best).toBe(0);
  });
});
