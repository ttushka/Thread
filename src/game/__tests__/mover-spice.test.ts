import { describe, expect, it } from "vitest";
import { BRAKE_SLOW, BEAT_SKIM_EARLY_MS, BEAT_SKIM_FORGIVE_STREAK, CONTROL_SKIM_HEAT } from "../variant.ts";
import { dailySeed } from "../seed.ts";
import {
  BASE_SPEED,
  DIST,
  LIP_TELEGRAPH_MIN_S,
  ROOM_C,
  MOVER_MOTION,
} from "../world/constants.ts";
import { generateCourse, isMoverSnapPhase, moverContactTime, cxFitsMoverGap } from "../world/course.ts";
import { checkCourseLayout } from "../world/agency.ts";

const DATES = ["2026-09-17", "2026-09-18", "2026-01-01", "2026-12-31", "2027-06-06"];
const ENDLESS_SEEDS = [1, 42, 0x4eadc0de, 0xc0ffee];

function bandMovers(course: ReturnType<typeof generateCourse>) {
  return course.obstacles
    .filter((o) => o.kind === "mover" && o.y >= DIST.roomBEnd && o.y <= DIST.roomCEnd)
    .sort((a, b) => a.y - b.y || a.id - b.id);
}

/** Peak lateral speed of the oscillating gap (px/s). */
function peakGapSpeed(amplitude: number, period: number): number {
  return (Math.PI * 2 * amplitude) / period;
}

describe("Room C — mover gauntlet (readable mid)", () => {
  it("locks 4-mover gauntlet placement and readable-mid motion tokens", () => {
    expect(ROOM_C.count).toBe(4);
    expect(ROOM_C.firstMin).toBe(160);
    expect(ROOM_C.firstMax).toBe(260);
    expect(ROOM_C.spacingMin).toBe(240);
    expect(ROOM_C.spacingMax).toBe(340);
    expect(ROOM_C.spacingMin / BASE_SPEED).toBeGreaterThanOrEqual(LIP_TELEGRAPH_MIN_S);
    expect(MOVER_MOTION.gapMin).toBe(100);
    expect(MOVER_MOTION.gapMax).toBe(120);
    expect(MOVER_MOTION.amplitudeMin).toBe(48);
    expect(MOVER_MOTION.amplitudeMax).toBe(64);
    expect(MOVER_MOTION.amplitudeRetryCap).toBe(72);
    expect(MOVER_MOTION.periodMin).toBe(2.8);
    expect(MOVER_MOTION.periodMax).toBe(3.4);
    // Readable mid: 0.6s telegraph travel at the start-range peak stays under a gap-width.
    const startPeak = peakGapSpeed(MOVER_MOTION.amplitudeMax, MOVER_MOTION.periodMin);
    expect(startPeak * LIP_TELEGRAPH_MIN_S).toBeLessThan(MOVER_MOTION.gapMax);
    expect(LIP_TELEGRAPH_MIN_S).toBe(0.6);
  });

  it("places four movers in the 40–60s band on Daily, Endless, and Beat", () => {
    for (const date of DATES) {
      for (const variant of [undefined, "beat"] as const) {
        const course = generateCourse(dailySeed(date), { daily: true, variant });
        const movers = bandMovers(course);
        expect(movers.length, `${date} ${variant ?? "control"}`).toBe(ROOM_C.count);
        expect((movers[1]!.y - movers[0]!.y) / BASE_SPEED).toBeGreaterThanOrEqual(LIP_TELEGRAPH_MIN_S);
        expect(movers[0]!.y).toBeGreaterThanOrEqual(DIST.roomBEnd + ROOM_C.firstMin);
        expect(movers[0]!.y).toBeLessThanOrEqual(DIST.roomBEnd + ROOM_C.firstMax);
        expect(movers[movers.length - 1]!.y).toBeLessThanOrEqual(DIST.roomCEnd - ROOM_C.tailPad);
      }
    }
    for (const seed of ENDLESS_SEEDS) {
      const course = generateCourse(seed, { daily: false, endlessHorizon: DIST.roomCEnd + 80 });
      expect(bandMovers(course).length, String(seed)).toBe(ROOM_C.count);
    }
  });

  it("keeps generated motion in the readable-mid band and never snap-shuts", () => {
    const samples = [
      ...DATES.map((date) => generateCourse(dailySeed(date), { daily: true })),
      ...ENDLESS_SEEDS.map((seed) => generateCourse(seed, { daily: false, endlessHorizon: DIST.roomCEnd + 80 })),
    ];
    for (const course of samples) {
      expect(checkCourseLayout(course)).toEqual([]);
      for (const m of bandMovers(course)) {
        expect(m.amplitude).toBeGreaterThanOrEqual(MOVER_MOTION.amplitudeMin - 1e-6);
        expect(m.amplitude).toBeLessThanOrEqual(MOVER_MOTION.amplitudeRetryCap + 1e-6);
        expect(m.period).toBeGreaterThanOrEqual(MOVER_MOTION.periodMin - 1e-6);
        expect(m.period).toBeLessThanOrEqual(MOVER_MOTION.periodMax + 1e-6);
        expect(peakGapSpeed(m.amplitude, m.period) * LIP_TELEGRAPH_MIN_S).toBeLessThan(MOVER_MOTION.gapMax);
        expect(isMoverSnapPhase(m)).toBe(false);
        const tContact = moverContactTime(m);
        expect(cxFitsMoverGap(m, tContact - LIP_TELEGRAPH_MIN_S) && !cxFitsMoverGap(m, tContact)).toBe(false);
      }
    }
  });

  it("does not retune Brake assist or Slice A/B skim tokens", () => {
    expect(BRAKE_SLOW).toBe(0.45);
    expect(CONTROL_SKIM_HEAT).toBe(0.55);
    expect(BEAT_SKIM_EARLY_MS).toBe(240);
    expect(BEAT_SKIM_FORGIVE_STREAK).toBe(3);
  });
});
