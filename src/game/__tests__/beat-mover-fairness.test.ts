import { describe, expect, it } from "vitest";
import type { Intent } from "../../types.ts";
import { dailySeed, SEED_VERSION } from "../seed.ts";
import { BRAKE_SLOW, BEAT_BPM, BEAT_SKIM_EARLY_MS, BEAT_SKIM_MS } from "../variant.ts";
import {
  BASE_SPEED,
  BEAT_MOVER_APPROACH,
  BEAT_MOVER_MIN_OPEN_S,
  BEAT_MOVER_MOTION,
  CX,
  DIST,
  LIP_TELEGRAPH_MIN_S,
  MOVER_MOTION,
  NEAR_MISS_BAND,
  NICK_BAND,
  ROOM_A,
  THREAD_RADIUS,
  TICK,
  isRoomALiveOpening,
  openingIncludesCx,
} from "../world/constants.ts";
import {
  cxFitsMoverGap,
  cxOpenWindowAtContact,
  generateCourse,
  isMoverSnapPhase,
  moverContactTime,
  moverGap,
  sampleWalls,
  searchMoverPhase,
  streamEvents,
} from "../world/course.ts";
import { checkCourseLayout, scoringGates, simulateCenterHold } from "../world/agency.ts";
import { createWorld, updateWorld } from "../world/simulate.ts";
import dailyStream from "../__fixtures__/daily-stream-2026-09-17.json";

const DATES = ["2026-09-17", "2026-09-18", "2026-01-01", "2026-12-31", "2027-06-06"];
const ENDLESS_SEEDS = [1, 42, 0x4eadc0de, 0xc0ffee];

function gauntletMovers(course: ReturnType<typeof generateCourse>) {
  return course.obstacles
    .filter((o) => o.kind === "mover" && o.y >= DIST.roomBEnd && o.y <= DIST.roomCEnd)
    .sort((a, b) => a.y - b.y || a.id - b.id);
}

function peakGapSpeed(amplitude: number, period: number): number {
  return (Math.PI * 2 * amplitude) / period;
}

function approachLip(course: ReturnType<typeof generateCourse>, moverY: number) {
  const gates = scoringGates(course).filter((g) => g.y < moverY - 1e-6);
  return gates[gates.length - 1] ?? null;
}

const hold = (x: number, extra: Partial<Intent> = {}): Intent => ({
  steer: 0,
  pointerActive: true,
  pointerX: x,
  restart: false,
  toTitle: false,
  ...extra,
});

describe("BEAT-MOVER-FAIRNESS-v1 tokens", () => {
  it("locks a louder Beat pass band than Control — not a ±ms tweak", () => {
    expect(BEAT_MOVER_MOTION.gapMin).toBeGreaterThanOrEqual(MOVER_MOTION.gapMax);
    expect(BEAT_MOVER_MOTION.gapMin - MOVER_MOTION.gapMin).toBeGreaterThanOrEqual(20);
    expect(BEAT_MOVER_MOTION.amplitudeMax).toBeLessThan(MOVER_MOTION.amplitudeMin);
    expect(BEAT_MOVER_MOTION.periodMin).toBeGreaterThan(MOVER_MOTION.periodMax);
    expect(BEAT_MOVER_MIN_OPEN_S).toBe(LIP_TELEGRAPH_MIN_S);
    expect(BEAT_MOVER_MIN_OPEN_S).toBeGreaterThanOrEqual(60 / BEAT_BPM - 0.03);
    expect(BEAT_MOVER_APPROACH.pad / BASE_SPEED).toBeGreaterThanOrEqual(LIP_TELEGRAPH_MIN_S);
    expect(BEAT_MOVER_APPROACH.pad).toBeGreaterThanOrEqual(120);
    expect(BEAT_MOVER_APPROACH.minOffset).toBe(40);
    expect(BEAT_MOVER_APPROACH.gapMin).toBeGreaterThanOrEqual(134);
    expect(BEAT_MOVER_APPROACH.minOffset).toBeLessThan(64);

    const controlPeak = peakGapSpeed(MOVER_MOTION.amplitudeMax, MOVER_MOTION.periodMin);
    const beatPeak = peakGapSpeed(BEAT_MOVER_MOTION.amplitudeMax, BEAT_MOVER_MOTION.periodMin);
    expect(beatPeak).toBeLessThan(controlPeak * 0.65);
    expect(beatPeak * LIP_TELEGRAPH_MIN_S).toBeLessThan(BEAT_MOVER_MOTION.gapMin);

    // Control tokens stay put (Brake-main / Slice C).
    expect(MOVER_MOTION.gapMin).toBe(100);
    expect(MOVER_MOTION.amplitudeMin).toBe(48);
    expect(MOVER_MOTION.periodMin).toBe(2.8);
    expect(BRAKE_SLOW).toBe(0.45);
    expect(BEAT_SKIM_EARLY_MS).toBe(240);
    expect(BEAT_SKIM_MS).toBe(180);
    expect(SEED_VERSION).toBe(10);
  });
});

describe("BEAT-MOVER-FAIRNESS-v1 pass windows", () => {
  it("gives every Beat Daily/Endless gauntlet mover a ≥0.6s CX-open band and no snap-shut", () => {
    for (const date of DATES) {
      const course = generateCourse(dailySeed(date), { daily: true, variant: "beat" });
      expect(course.variant).toBe("beat");
      expect(checkCourseLayout(course), date).toEqual([]);
      const movers = gauntletMovers(course);
      expect(movers.length, date).toBe(4);
      for (const m of movers) {
        expect(isMoverSnapPhase(m), date).toBe(false);
        expect(m.gapWidth, date).toBeGreaterThanOrEqual(BEAT_MOVER_MOTION.gapMin - 1e-6);
        expect(m.gapWidth, date).toBeLessThanOrEqual(BEAT_MOVER_MOTION.gapMax + 1e-6);
        expect(m.amplitude, date).toBeLessThanOrEqual(BEAT_MOVER_MOTION.amplitudeRetryCap + 1e-6);
        expect(m.period, date).toBeGreaterThanOrEqual(BEAT_MOVER_MOTION.periodMin - 1e-6);
        const open = cxOpenWindowAtContact(m);
        expect(open, `${date} mover ${m.id}`).toBeGreaterThanOrEqual(BEAT_MOVER_MIN_OPEN_S - 1e-3);
        expect(cxFitsMoverGap(m, moverContactTime(m)), date).toBe(true);
      }
    }
    for (const seed of ENDLESS_SEEDS) {
      const course = generateCourse(seed, {
        daily: false,
        variant: "beat",
        endlessHorizon: DIST.roomCEnd + 80,
      });
      for (const m of gauntletMovers(course)) {
        expect(isMoverSnapPhase(m), String(seed)).toBe(false);
        expect(cxOpenWindowAtContact(m), String(seed)).toBeGreaterThanOrEqual(BEAT_MOVER_MIN_OPEN_S - 1e-3);
      }
    }
  });

  it("keeps Control movers on the punish/readable-mid path and Daily goldens", () => {
    const seed = dailySeed("2026-09-17");
    expect(streamEvents(generateCourse(seed, { daily: true }), 16)).toEqual(dailyStream.events);
    expect(streamEvents(generateCourse(seed, { daily: true, variant: "brake" }), 16)).toEqual(
      dailyStream.events,
    );

    for (const date of DATES) {
      const course = generateCourse(dailySeed(date), { daily: true });
      expect(course.variant ?? "control").toBe("control");
      expect(checkCourseLayout(course), date).toEqual([]);
      for (const m of gauntletMovers(course)) {
        expect(m.gapWidth, date).toBeLessThanOrEqual(MOVER_MOTION.gapMax + 1e-6);
        expect(m.period, date).toBeLessThanOrEqual(MOVER_MOTION.periodMax + 1e-6);
        expect(isMoverSnapPhase(m), date).toBe(false);
        // Control still prefers telegraphed center-punish — not the Beat open band.
        expect(cxFitsMoverGap(m, moverContactTime(m)), date).toBe(false);
      }
    }
  });

  it("prefers longest CX-open when searching Beat phases, still rejecting snap-shut", () => {
    const base = {
      id: 1,
      kind: "mover" as const,
      y: 4000,
      left: 162,
      right: 298,
      thickness: 14,
      baseCenter: 230,
      gapWidth: 136,
      amplitude: 34,
      period: 4.0,
      phase: 0,
    };
    const open = searchMoverPhase(base, "open");
    expect(open.snap).toBe(false);
    expect(open.kills).toBe(false);
    expect(open.openWindow).toBeGreaterThanOrEqual(BEAT_MOVER_MIN_OPEN_S);
    const punish = searchMoverPhase(base, "punish");
    expect(punish.snap).toBe(false);
    expect(punish.phase).not.toBe(open.phase);
  });
});

describe("BEAT-MOVER-FAIRNESS-v1 approach lips", () => {
  it("softens offset/gap on Beat lips immediately before movers and keeps a pad", () => {
    for (const date of DATES) {
      const beat = generateCourse(dailySeed(date), { daily: true, variant: "beat" });
      const control = generateCourse(dailySeed(date), { daily: true });
      const movers = gauntletMovers(beat);
      for (const m of movers) {
        const prev = approachLip(beat, m.y);
        expect(prev, date).toBeTruthy();
        const dy = m.y - prev!.y;
        expect(dy, `${date} approach dy ${m.id}`).toBeGreaterThanOrEqual(BEAT_MOVER_APPROACH.pad - 1e-6);
        if (prev!.y >= DIST.roomBEnd) {
          expect(prev!.gapWidth, date).toBeGreaterThanOrEqual(BEAT_MOVER_APPROACH.gapMin - 1e-6);
          expect(Math.abs(prev!.baseCenter - CX), date).toBeLessThan(BEAT_MOVER_APPROACH.minOffset + 14);
          expect(openingIncludesCx(prev!.left, prev!.right), `${date} approach CX ${prev!.id}`).toBe(true);
        }
        const w0 = sampleWalls(beat.keyframes, prev!.y);
        const w1 = sampleWalls(beat.keyframes, m.y);
        const curve = (Math.abs(w1.left - w0.left) + Math.abs(w1.right - w0.right)) / dy;
        expect(curve, `${date} curve ${m.id}`).toBeLessThan(1.6);
      }

      const controlMovers = gauntletMovers(control);
      const beatOff: number[] = [];
      const controlOff: number[] = [];
      for (const m of movers) {
        const prev = approachLip(beat, m.y);
        if (prev && prev.y >= DIST.roomBEnd) beatOff.push(Math.abs(prev.baseCenter - CX));
      }
      for (const m of controlMovers) {
        const prev = approachLip(control, m.y);
        if (prev && prev.y >= DIST.roomBEnd) controlOff.push(Math.abs(prev.baseCenter - CX));
      }
      if (beatOff.length && controlOff.length) {
        const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        expect(avg(beatOff), date).toBeLessThan(avg(controlOff) - 8);
      }
    }
  });
});

describe("BEAT-MOVER-FAIRNESS-v1 isolation", () => {
  it("does not re-hard Soft-friends Room A on Beat or Control", () => {
    expect(ROOM_A.teachGapMin).toBe(196);
    expect(ROOM_A.calmGapMin).toBeGreaterThanOrEqual(250);
    expect(DIST.openEnd).toBe(800);

    for (const variant of [undefined, "beat"] as const) {
      for (const date of DATES) {
        const course = generateCourse(dailySeed(date), { daily: true, variant });
        const roomA = scoringGates(course).filter((g) => isRoomALiveOpening(g.y));
        expect(roomA.length, `${date} ${variant}`).toBeGreaterThanOrEqual(3);
        for (const g of roomA) {
          expect(openingIncludesCx(g.left, g.right), `${date} ${variant} ${g.id}`).toBe(true);
        }
        const world = simulateCenterHold(dailySeed(date), true);
        expect(world.distance, date).toBeGreaterThanOrEqual(DIST.roomAEnd);
        expect(world.distance, date).toBeLessThan(DIST.roomBEnd);
      }
    }
  });
});

describe("BEAT-MOVER-FAIRNESS-v1 skim-slo-mo", () => {
  it("lets a Beat skim ride the near-miss band through a gauntlet mover", () => {
    const wide = [
      { y: 0, left: 16, right: 344, gateId: null },
      { y: 8000, left: 16, right: 344, gateId: null },
    ];
    for (const date of DATES) {
      const course = generateCourse(dailySeed(date), { daily: true, variant: "beat" });
      const mover = gauntletMovers(course)[0]!;
      const world = createWorld(dailySeed(date), {
        daily: true,
        reducedMotion: true,
        variant: "beat",
      });
      world.course.keyframes = wide;
      world.obstacles = [{ ...mover, passed: false, nicked: false }];
      world.distance = mover.y - 80;
      world.prevDistance = world.distance - BASE_SPEED * TICK;
      world.time = world.distance / BASE_SPEED;

      const seedGap = moverGap(mover, world.time);
      const seedX =
        mover.baseCenter >= CX
          ? seedGap.right - THREAD_RADIUS - NICK_BAND - NEAR_MISS_BAND * 0.45
          : seedGap.left + THREAD_RADIUS + NICK_BAND + NEAR_MISS_BAND * 0.45;
      world.x = seedX;
      world.prevX = seedX;

      const cap = Math.ceil(3 / TICK);
      for (let i = 0; i < cap; i++) {
        const gap = moverGap(mover, world.time);
        const x =
          mover.baseCenter >= CX
            ? gap.right - THREAD_RADIUS - NICK_BAND - NEAR_MISS_BAND * 0.45
            : gap.left + THREAD_RADIUS + NICK_BAND + NEAR_MISS_BAND * 0.45;
        updateWorld(world, hold(x), TICK);
        if (!world.alive || world.distance > mover.y + 40) break;
      }
      expect(world.alive, date).toBe(true);
      expect(world.distance, date).toBeGreaterThan(mover.y);
      expect(world.obstacles[0]!.passed, date).toBe(true);
      expect(world.skimEvents + (world.nearMissTimer > 0 ? 1 : 0), date).toBeGreaterThan(0);
    }
  });
});
