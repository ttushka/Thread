import { describe, expect, it } from "vitest";
import { RESULT_NO_SKIM, SCORE_SKIM_TEACH } from "../variant.ts";
import { THROUGH_AWARD } from "../score.ts";
import { dailySeed } from "../seed.ts";
import {
  BASE_SPEED,
  CX,
  DIST,
  LIP_TELEGRAPH_MIN_S,
  MOVER_MOTION,
  ROOM_A,
  ROOM_B,
  ROOM_C,
  STEER_KEY_ACCEL,
  STEER_KEY_DECEL,
  STEER_KEY_TAP_CAP,
  STEER_KEY_TAP_MS,
  STEER_SPEED,
  TICK,
  isRoomALiveOpening,
  openingIncludesCx,
  roomAt,
} from "../world/constants.ts";
import { generateCourse, isMoverSnapPhase, sampleWalls } from "../world/course.ts";
import { checkCourseLayout, scoringGates, simulateCenterHold } from "../world/agency.ts";
import { createWorld, updateWorld, worldScore } from "../world/simulate.ts";

const DATES = ["2026-09-17", "2026-09-18", "2026-01-01", "2026-12-31", "2027-06-06"];
const ENDLESS_SEEDS = [1, 42, 0x4eadc0de, 0xc0ffee];

function gauntletMovers(course: ReturnType<typeof generateCourse>) {
  return course.obstacles
    .filter((o) => o.kind === "mover" && o.y >= DIST.roomBEnd && o.y <= DIST.roomCEnd)
    .sort((a, b) => a.y - b.y || a.id - b.id);
}

describe("BIG-FEEL PR2 — Room A/B/C first minute", () => {
  it("locks the 0–15 / 15–40 / 40–60s marks at 90 u/s", () => {
    expect(DIST.openEnd).toBeGreaterThanOrEqual(800);
    expect(DIST.openEnd / BASE_SPEED).toBeCloseTo(800 / 90, 5);
    expect(DIST.roomAEnd / BASE_SPEED).toBeCloseTo(15, 5);
    expect(DIST.roomBEnd / BASE_SPEED).toBeCloseTo(40, 5);
    expect(DIST.roomCEnd / BASE_SPEED).toBeCloseTo(60, 5);
    expect(DIST.rhythmEnd).toBe(DIST.roomCEnd);
    expect(roomAt(0)).toBe("open");
    expect(roomAt(DIST.openEnd)).toBe("A");
    expect(roomAt(DIST.roomAEnd)).toBe("B");
    expect(roomAt(DIST.roomBEnd)).toBe("C");
    expect(roomAt(DIST.roomCEnd)).toBe("endless");
  });

  it("keeps Room A wide and Room B tighter — screenshot-loud corridor change", () => {
    expect(ROOM_A.gapMin).toBeGreaterThan(ROOM_B.gapMax);
    expect(ROOM_A.teachGapMin).toBeGreaterThan(ROOM_A.gapMax);
    expect(ROOM_A.teachGapMax).toBe(220);
    expect(ROOM_A.teachMinOffset).toBe(40);
    expect(ROOM_A.firstCount).toBe(1);
    expect(ROOM_A.firstStepMin).toBe(32);
    expect(ROOM_A.firstStepMax).toBe(40);
    expect(ROOM_A.calmGapMin).toBeGreaterThanOrEqual(250);
    expect(ROOM_A.calmGapMax).toBeGreaterThanOrEqual(ROOM_A.calmGapMin);
    expect(ROOM_A.minOffset).toBe(80);
    // First opening covers CX (180–220). Later A pinch look stays <171 but CX-live.
    expect(ROOM_A.teachGapMin).toBeGreaterThan(171);
    expect(ROOM_A.gapMax).toBeLessThan(171);
    expect(ROOM_A.minOffset).toBeGreaterThan(ROOM_B.minOffset);
    expect(ROOM_C.count).toBeGreaterThanOrEqual(3);
    expect(ROOM_A.stepMin / BASE_SPEED).toBeGreaterThanOrEqual(LIP_TELEGRAPH_MIN_S);
    expect(ROOM_B.stepMin / BASE_SPEED).toBeGreaterThanOrEqual(LIP_TELEGRAPH_MIN_S);
    expect(ROOM_C.spacingMin / BASE_SPEED).toBeGreaterThanOrEqual(LIP_TELEGRAPH_MIN_S);
    expect(LIP_TELEGRAPH_MIN_S).toBe(0.6);

    for (const date of DATES) {
      const course = generateCourse(dailySeed(date), { daily: true });
      const gates = scoringGates(course);
      const a = gates.filter((g) => roomAt(g.y) === "A");
      const b = gates.filter((g) => roomAt(g.y) === "B");
      expect(a.length, date).toBeGreaterThanOrEqual(3);
      expect(b.length, date).toBeGreaterThanOrEqual(6);
      const aMean = a.reduce((s, g) => s + g.gapWidth, 0) / a.length;
      const bMean = b.reduce((s, g) => s + g.gapWidth, 0) / b.length;
      expect(aMean, date).toBeGreaterThan(bMean + 30);
      const first = a.slice(0, ROOM_A.firstCount);
      expect(first.length, date).toBe(ROOM_A.firstCount);
      for (const g of first) {
        expect(g.gapWidth, `${date} A-first ${g.id}`).toBeGreaterThanOrEqual(ROOM_A.teachGapMin);
        expect(g.gapWidth, `${date} A-first ${g.id}`).toBeLessThanOrEqual(ROOM_A.teachGapMax);
      }
      const calmDy = a[1]!.y - a[0]!.y;
      expect(calmDy, `${date} A-open calm`).toBeGreaterThanOrEqual(ROOM_A.calmGapMin);
      expect(calmDy, `${date} A-open calm`).toBeLessThanOrEqual(ROOM_A.calmGapMax);
      for (const [i, g] of a.entries()) {
        expect(isRoomALiveOpening(g.y), `${date} A live ${g.id}`).toBe(true);
        expect(openingIncludesCx(g.left, g.right), `${date} A CX ${g.id}`).toBe(true);
        expect(g.gapWidth, `${date} A ${g.id}`).toBeGreaterThanOrEqual(ROOM_A.gapMin);
        if (i < ROOM_A.firstCount) {
          expect(g.gapWidth, `${date} A-open ${g.id}`).toBeGreaterThanOrEqual(ROOM_A.teachGapMin);
          expect(g.gapWidth, `${date} A-open ${g.id}`).toBeLessThanOrEqual(ROOM_A.teachGapMax);
          expect(Math.abs(g.baseCenter - CX), `${date} A-open off ${g.id}`).toBeGreaterThanOrEqual(
            ROOM_A.teachMinOffset - 1,
          );
        } else {
          expect(g.gapWidth, `${date} A-weave ${g.id}`).toBeGreaterThanOrEqual(ROOM_A.gapMin);
          expect(g.gapWidth, `${date} A-weave ${g.id}`).toBeLessThanOrEqual(ROOM_A.gapMax);
          expect(Math.abs(g.baseCenter - CX), `${date} A-weave off ${g.id}`).toBeGreaterThanOrEqual(40);
        }
      }
      for (const g of b) {
        expect(g.gapWidth, `${date} B ${g.id}`).toBeLessThanOrEqual(ROOM_B.gapMax);
        expect(Math.abs(g.baseCenter - CX), `${date} B ${g.id}`).toBeGreaterThanOrEqual(40);
        expect(openingIncludesCx(g.left, g.right), `${date} B CX-kill ${g.id}`).toBe(false);
      }
    }
  });

  it("places the mover gauntlet in Room C (40–60s), not in A/B", () => {
    expect(ROOM_C.count).toBe(4);
    expect(MOVER_MOTION.periodMin).toBe(2.8);
    expect(MOVER_MOTION.periodMax).toBe(3.4);

    for (const date of DATES) {
      for (const variant of [undefined, "beat"] as const) {
        const course = generateCourse(dailySeed(date), { daily: true, variant });
        const label = `${date} ${variant ?? "control"}`;
        expect(checkCourseLayout(course), label).toEqual([]);
        const early = course.obstacles.filter((o) => o.kind === "mover" && o.y < DIST.roomBEnd);
        expect(early, label).toEqual([]);
        const movers = gauntletMovers(course);
        expect(movers.length, label).toBe(ROOM_C.count);
        expect((movers[1]!.y - movers[0]!.y) / BASE_SPEED, label).toBeGreaterThanOrEqual(LIP_TELEGRAPH_MIN_S);
        for (const m of movers) {
          expect(isMoverSnapPhase(m), label).toBe(false);
          expect(m.period, label).toBeGreaterThanOrEqual(MOVER_MOTION.periodMin);
          expect(m.period, label).toBeLessThanOrEqual(MOVER_MOTION.periodMax);
        }
      }
    }
    for (const seed of ENDLESS_SEEDS) {
      const course = generateCourse(seed, { daily: false, endlessHorizon: DIST.roomCEnd + 80 });
      expect(gauntletMovers(course).length, String(seed)).toBe(ROOM_C.count);
      expect(course.obstacles.filter((o) => o.kind === "mover" && o.y < DIST.roomBEnd)).toEqual([]);
    }
  });

  it("continues A/B/C vocabulary after 60s (not a sine farm)", () => {
    for (const seed of ENDLESS_SEEDS) {
      const course = generateCourse(seed, { daily: false, endlessHorizon: DIST.roomCEnd + 3200 });
      const late = scoringGates(course).filter((g) => g.y > DIST.roomCEnd);
      expect(late.length, String(seed)).toBeGreaterThanOrEqual(8);
      const wide = late.filter((g) => g.gapWidth >= ROOM_A.gapMin - 1);
      const tight = late.filter((g) => g.gapWidth <= ROOM_B.gapMax + 1);
      expect(wide.length, `seed ${seed} wide`).toBeGreaterThan(0);
      expect(tight.length, `seed ${seed} tight`).toBeGreaterThan(0);
      const lateMovers = course.obstacles.filter((o) => o.kind === "mover" && o.y > DIST.roomCEnd);
      expect(lateMovers.length, `seed ${seed} movers`).toBeGreaterThanOrEqual(3);
      for (const g of late) {
        expect(openingIncludesCx(g.left, g.right), `seed ${seed} late CX-kill ${g.id}`).toBe(false);
      }
      for (let i = 1; i < late.length; i++) {
        const a = Math.sign(late[i - 1]!.baseCenter - CX);
        const b = Math.sign(late[i]!.baseCenter - CX);
        expect(a, `seed ${seed}`).not.toBe(b);
      }
    }
  });

  it("lets center-hold live through all of Room A, then CX-kills in Room B", () => {
    for (const date of DATES) {
      const world = simulateCenterHold(dailySeed(date), true);
      const roomA = scoringGates(world.course).filter((g) => isRoomALiveOpening(g.y));
      expect(roomA.length, date).toBeGreaterThanOrEqual(3);
      for (const g of roomA) {
        expect(openingIncludesCx(g.left, g.right), `${date} A CX ${g.id}`).toBe(true);
      }
      expect(world.alive, date).toBe(false);
      expect(world.distance, date).toBeGreaterThan(roomA[roomA.length - 1]!.y);
      expect(world.distance, date).toBeGreaterThanOrEqual(DIST.roomAEnd);
      expect(world.distance, date).toBeLessThan(DIST.roomBEnd);
      expect(checkCourseLayout(world.course), date).toEqual([]);
    }
  });

  it("scores 0 for a center through of Room A (PR1 skim-only)", () => {
    for (const date of DATES) {
      const world = createWorld(dailySeed(date), { daily: true, reducedMotion: true });
      const roomA = scoringGates(world.course).filter((g) => isRoomALiveOpening(g.y));
      const lastA = roomA[roomA.length - 1]!;
      const cap = Math.ceil(40 / TICK);
      for (let i = 0; i < cap; i++) {
        updateWorld(
          world,
          {
            steer: 0,
            pointerActive: false,
            pointerX: CX,
            restart: false,
            toTitle: false,
          },
          TICK,
        );
        if (!world.alive || world.distance > lastA.y + 20) break;
      }
      expect(world.alive, date).toBe(true);
      expect(world.distance, date).toBeGreaterThan(lastA.y);
      expect(world.skimEvents, date).toBe(0);
      expect(worldScore(world), date).toBe(0);
      expect(world.cleanPasses, date).toBeGreaterThan(0);
    }
  });

  it("lets a timid weave+Brake clear the first Room A opening", () => {
    const timidWeave = (seed: number, daily: boolean) => {
      const world = createWorld(seed, {
        daily,
        reducedMotion: true,
        variant: "brake",
        endlessHorizon: daily ? undefined : DIST.roomAEnd + 80,
      });
      const first = scoringGates(world.course).find((g) => roomAt(g.y) === "A");
      if (!first) throw new Error("no Room A gate");
      const side = Math.sign(first.baseCenter - CX) || 1;
      const x = CX + side * 8;
      const cap = Math.ceil(40 / TICK);
      for (let i = 0; i < cap; i++) {
        updateWorld(
          world,
          {
            steer: 0,
            pointerActive: true,
            pointerX: x,
            restart: false,
            toTitle: false,
            brake: world.distance >= DIST.openEnd,
          },
          TICK,
        );
        if (!world.alive || world.distance > first.y + 80) break;
      }
      return { world, first };
    };

    for (const seed of ENDLESS_SEEDS) {
      const { world, first } = timidWeave(seed, false);
      expect(world.alive, `endless ${seed}`).toBe(true);
      expect(world.distance, `endless ${seed}`).toBeGreaterThan(first.y);
      expect(first.y / BASE_SPEED, `endless ${seed}`).toBeGreaterThanOrEqual(800 / 90);
    }
    for (const date of DATES) {
      const { world, first } = timidWeave(dailySeed(date), true);
      expect(world.alive, date).toBe(true);
      expect(world.distance, date).toBeGreaterThan(first.y);
    }
  });

  it("lets weave+Brake clear Room A (soft-friends: reach Room B)", () => {
    const runWeaveBrake = (seed: number) => {
      const world = createWorld(seed, {
        daily: false,
        reducedMotion: true,
        variant: "brake",
        endlessHorizon: DIST.roomBEnd,
      });
      const gates = scoringGates(world.course).filter((g) => roomAt(g.y) === "A");
      expect(gates.length, `seed ${seed} A count`).toBeGreaterThanOrEqual(3);
      expect(gates[0]!.y, `seed ${seed} first lip`).toBeGreaterThanOrEqual(DIST.openEnd);
      expect(gates[0]!.y / BASE_SPEED, `seed ${seed} open`).toBeGreaterThanOrEqual(800 / 90);
      expect(gates[0]!.gapWidth, `seed ${seed} first`).toBeGreaterThanOrEqual(ROOM_A.teachGapMin);
      expect(gates[0]!.gapWidth, `seed ${seed} first`).toBeLessThanOrEqual(ROOM_A.teachGapMax);
      const calmDy = gates[1]!.y - gates[0]!.y;
      expect(calmDy, `seed ${seed} calm`).toBeGreaterThanOrEqual(ROOM_A.calmGapMin);
      expect(calmDy, `seed ${seed} calm`).toBeLessThanOrEqual(ROOM_A.calmGapMax);
      for (const g of gates) {
        expect(openingIncludesCx(g.left, g.right), `seed ${seed} A CX ${g.id}`).toBe(true);
      }
      const firstB = scoringGates(world.course).find((g) => roomAt(g.y) === "B");
      expect(firstB, `seed ${seed} Room B`).toBeTruthy();
      expect(openingIncludesCx(firstB!.left, firstB!.right), `seed ${seed} B CX-kill`).toBe(false);

      const cap = Math.ceil(90 / TICK);
      for (let i = 0; i < cap; i++) {
        const look = sampleWalls(world.course.keyframes, world.distance + 16);
        updateWorld(
          world,
          {
            steer: 0,
            pointerActive: true,
            pointerX: (look.left + look.right) / 2,
            restart: false,
            toTitle: false,
            brake: world.distance >= DIST.openEnd,
          },
          TICK,
        );
        if (!world.alive || world.distance >= DIST.roomAEnd) break;
      }
      return world;
    };

    for (const seed of ENDLESS_SEEDS) {
      const world = runWeaveBrake(seed);
      expect(world.alive, `endless ${seed}`).toBe(true);
      expect(world.distance, `endless ${seed}`).toBeGreaterThanOrEqual(DIST.roomAEnd);
      expect(roomAt(world.distance), `endless ${seed} room`).toBe("B");
    }
    for (const date of DATES) {
      const world = createWorld(dailySeed(date), {
        daily: true,
        reducedMotion: true,
        variant: "brake",
      });
      const cap = Math.ceil(90 / TICK);
      for (let i = 0; i < cap; i++) {
        const look = sampleWalls(world.course.keyframes, world.distance + 16);
        updateWorld(
          world,
          {
            steer: 0,
            pointerActive: true,
            pointerX: (look.left + look.right) / 2,
            restart: false,
            toTitle: false,
            brake: world.distance >= DIST.openEnd,
          },
          TICK,
        );
        if (!world.alive || world.distance >= DIST.roomAEnd) break;
      }
      expect(world.alive, date).toBe(true);
      expect(world.distance, date).toBeGreaterThanOrEqual(DIST.roomAEnd);
    }
  });

  it("does not reopen PR1 score/HUD or keyboard fine-steer", () => {
    expect(THROUGH_AWARD).toBe(0);
    expect(SCORE_SKIM_TEACH).toBe("Ride the edge rail \u2014 that\u2019s the score.");
    expect(RESULT_NO_SKIM).toBe("No skims — try the edge.");
    expect(STEER_SPEED).toBe(280);
    expect(STEER_KEY_ACCEL).toBe(3.2);
    expect(STEER_KEY_DECEL).toBe(6.0);
    expect(STEER_KEY_TAP_MS).toBe(80);
    expect(STEER_KEY_TAP_CAP).toBe(0.35);
  });
});
