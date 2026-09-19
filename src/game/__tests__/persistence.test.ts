import { describe, expect, it } from "vitest";
import {
  SAVE_KEY,
  BRAKE_SKIM_TEACH_KEY,
  BEAT_SKIM_TEACH_KEY,
  SKIM_SCORE_TEACH_KEY,
  dailyAttemptsFor,
  dailyBestFor,
  loadSave,
  noteDailyAttempt,
  recordDailyRun,
  recordEndlessBest,
  withMuted,
  withReducedMotion,
  withBrakeHudPos,
  brakeHudPos,
  brakeSkimTeachSeen,
  markBrakeSkimTeachSeen,
  beatSkimTeachSeen,
  markBeatSkimTeachSeen,
  skimScoreTeachSeen,
  markSkimScoreTeachSeen,
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

  it("persists muted without dropping reduced motion", () => {
    const s = new MemoryStorage();
    let save = loadSave(s);
    save = withReducedMotion(save, true);
    save = withMuted(save, true);
    writeSave(s, save);
    const round = loadSave(s);
    expect(round.settings?.reducedMotion).toBe(true);
    expect(round.settings?.muted).toBe(true);
    save = withMuted(round, false);
    writeSave(s, save);
    expect(loadSave(s).settings?.muted).toBe(false);
    expect(loadSave(s).settings?.reducedMotion).toBe(true);
  });

  it("persists Brake HUD park keyed by variant without dropping mute", () => {
    const s = new MemoryStorage();
    let save = loadSave(s);
    save = withMuted(save, true);
    save = withBrakeHudPos(save, { x: 24, y: 640 });
    writeSave(s, save);
    const round = loadSave(s);
    expect(round.settings?.muted).toBe(true);
    expect(brakeHudPos(round)).toEqual({ x: 24, y: 640 });
    save = withBrakeHudPos(round, null);
    writeSave(s, save);
    expect(brakeHudPos(loadSave(s))).toBeNull();
    expect(loadSave(s).settings?.muted).toBe(true);
  });

  it("persists Brake skim teach as a dedicated key, independent of thread.v1", () => {
    const s = new MemoryStorage();
    expect(BRAKE_SKIM_TEACH_KEY).toBe("thread.v1.brakeSkimTeachSeen");
    expect(brakeSkimTeachSeen(s)).toBe(false);
    markBrakeSkimTeachSeen(s);
    expect(s.getItem(BRAKE_SKIM_TEACH_KEY)).toBe("1");
    expect(brakeSkimTeachSeen(s)).toBe(true);
    expect(s.getItem(SAVE_KEY)).toBeNull();
    s.setItem(SAVE_KEY, JSON.stringify({ v: 1, endlessBest: 9, daily: { dateKey: "", best: 0 } }));
    expect(brakeSkimTeachSeen(s)).toBe(true);
    s.setItem(BRAKE_SKIM_TEACH_KEY, "");
    expect(brakeSkimTeachSeen(s)).toBe(false);
  });

  it("persists Beat skim teach as a dedicated key, independent of thread.v1", () => {
    const s = new MemoryStorage();
    expect(BEAT_SKIM_TEACH_KEY).toBe("thread.v1.beatSkimTeachSeen");
    expect(beatSkimTeachSeen(s)).toBe(false);
    markBeatSkimTeachSeen(s);
    expect(s.getItem(BEAT_SKIM_TEACH_KEY)).toBe("1");
    expect(beatSkimTeachSeen(s)).toBe(true);
    expect(s.getItem(SAVE_KEY)).toBeNull();
    expect(s.getItem(BRAKE_SKIM_TEACH_KEY)).toBeNull();
    s.setItem(SAVE_KEY, JSON.stringify({ v: 1, endlessBest: 9, daily: { dateKey: "", best: 0 } }));
    expect(beatSkimTeachSeen(s)).toBe(true);
    s.setItem(BEAT_SKIM_TEACH_KEY, "");
    expect(beatSkimTeachSeen(s)).toBe(false);
  });

  it("persists first-run score teach as a dedicated key, independent of thread.v1", () => {
    const s = new MemoryStorage();
    expect(SKIM_SCORE_TEACH_KEY).toBe("thread.v1.skimScoreTeachSeen");
    expect(skimScoreTeachSeen(s)).toBe(false);
    markSkimScoreTeachSeen(s);
    expect(s.getItem(SKIM_SCORE_TEACH_KEY)).toBe("1");
    expect(skimScoreTeachSeen(s)).toBe(true);
    expect(s.getItem(SAVE_KEY)).toBeNull();
    expect(s.getItem(BRAKE_SKIM_TEACH_KEY)).toBeNull();
    expect(s.getItem(BEAT_SKIM_TEACH_KEY)).toBeNull();
    s.setItem(SKIM_SCORE_TEACH_KEY, "");
    expect(skimScoreTeachSeen(s)).toBe(false);
  });
});
