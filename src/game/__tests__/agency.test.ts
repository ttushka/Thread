import { describe, expect, it } from "vitest";
import { dailySeed } from "../seed.ts";
import { generateCourse } from "../world/course.ts";
import { checkCourseLayout, scoringGates, simulateCenterHold } from "../world/agency.ts";
import {
  BASE_SPEED,
  CX,
  DIST,
  LIP_TELEGRAPH_MIN_S,
  ROOM_A,
  ROOM_B,
  ROOM_C,
  MOVER_MOTION,
  isRoomALiveOpening,
  openingIncludesCx,
} from "../world/constants.ts";

const DATES = ["2026-09-17", "2026-09-18", "2026-01-01", "2026-12-31", "2027-06-06"];
const ENDLESS_SEEDS = [1, 42, 0x4eadc0de, 0xc0ffee];

describe("Daily agency validators", () => {
  it("rejects a center-hold that reaches finishY", () => {
    for (const date of DATES) {
      const world = simulateCenterHold(dailySeed(date), true);
      expect(world.cleared, date).toBe(false);
      expect(world.alive, date).toBe(false);
      expect(world.course.finishY, date).not.toBeNull();
      expect(world.distance, date).toBeLessThan(world.course.finishY!);
    }
  });

  it("kills center-hold in Room B, not mid–Room A or at the finish", () => {
    for (const date of DATES) {
      const world = simulateCenterHold(dailySeed(date), true);
      const roomA = scoringGates(world.course).filter((g) => isRoomALiveOpening(g.y));
      expect(world.distance, date).toBeGreaterThan(roomA[roomA.length - 1]!.y);
      expect(world.distance, date).toBeGreaterThanOrEqual(DIST.roomAEnd);
      expect(world.distance, date).toBeLessThan(DIST.roomBEnd);
      expect(world.distance, date).toBeLessThan(world.course.finishY!);
    }
  });

  it("has no scoring gate with |center-CX| < 40 after open", () => {
    for (const date of DATES) {
      const course = generateCourse(dailySeed(date), { daily: true });
      for (const g of scoringGates(course)) {
        if (g.y < DIST.openEnd) continue;
        expect(Math.abs(g.baseCenter - CX), `${date} gate ${g.id}`).toBeGreaterThanOrEqual(40);
        if (isRoomALiveOpening(g.y)) {
          expect(openingIncludesCx(g.left, g.right), `${date} Room A ${g.id}`).toBe(true);
        }
      }
    }
  });

  it("places at least 8 scoring gates in the first minute", () => {
    for (const date of DATES) {
      const course = generateCourse(dailySeed(date), { daily: true });
      const n = scoringGates(course).filter((g) => g.y >= DIST.openEnd && g.y <= DIST.rhythmEnd).length;
      expect(n, date).toBeGreaterThanOrEqual(8);
    }
  });

  it("keeps Room A/B lips telegraphed and dense enough to force skim", () => {
    expect(ROOM_A.stepMin).toBe(104);
    expect(ROOM_B.stepMin).toBe(92);
    expect(ROOM_A.teachMinOffset).toBe(40);
    expect(ROOM_A.minOffset).toBe(80);
    expect(ROOM_B.minOffset).toBe(68);
    expect(LIP_TELEGRAPH_MIN_S).toBe(0.6);
    expect(ROOM_A.stepMin / BASE_SPEED).toBeGreaterThanOrEqual(LIP_TELEGRAPH_MIN_S);
    expect(ROOM_B.stepMin / BASE_SPEED).toBeGreaterThanOrEqual(LIP_TELEGRAPH_MIN_S);

    for (const date of DATES) {
      const course = generateCourse(dailySeed(date), { daily: true });
      const weave = scoringGates(course).filter((g) => g.y >= DIST.openEnd && g.y < DIST.roomBEnd);
      expect(weave.length, date).toBeGreaterThanOrEqual(12);
      for (let i = 1; i < weave.length; i++) {
        const dy = weave[i]!.y - weave[i - 1]!.y;
        expect(dy / BASE_SPEED, date).toBeGreaterThanOrEqual(LIP_TELEGRAPH_MIN_S - 1e-6);
      }
    }
    for (const seed of ENDLESS_SEEDS) {
      const course = generateCourse(seed, { daily: false, endlessHorizon: DIST.roomBEnd + 200 });
      const weave = scoringGates(course).filter((g) => g.y >= DIST.openEnd && g.y < DIST.roomBEnd);
      expect(weave.length, String(seed)).toBeGreaterThanOrEqual(12);
    }
  });

  it("places the Room C mover gauntlet without snap-shut", () => {
    expect(ROOM_C.count).toBe(4);
    expect(ROOM_C.firstMin).toBe(160);
    expect(ROOM_C.firstMax).toBe(260);
    expect(ROOM_C.spacingMin / BASE_SPEED).toBeGreaterThanOrEqual(LIP_TELEGRAPH_MIN_S);
    expect(MOVER_MOTION.amplitudeMin).toBe(48);
    expect(MOVER_MOTION.amplitudeMax).toBe(64);
    expect(MOVER_MOTION.amplitudeRetryCap).toBe(72);
    expect(MOVER_MOTION.periodMin).toBe(2.8);
    expect(MOVER_MOTION.periodMax).toBe(3.4);

    for (const date of DATES) {
      const course = generateCourse(dailySeed(date), { daily: true });
      expect(checkCourseLayout(course), date).toEqual([]);
    }
    for (const seed of ENDLESS_SEEDS) {
      const course = generateCourse(seed, { daily: false, endlessHorizon: DIST.roomCEnd + 200 });
      const movers = course.obstacles
        .filter((o) => o.kind === "mover" && o.y >= DIST.roomBEnd && o.y <= DIST.roomCEnd)
        .sort((a, b) => a.y - b.y);
      expect(movers.length, String(seed)).toBe(ROOM_C.count);
      expect((movers[1]!.y - movers[0]!.y) / BASE_SPEED, String(seed)).toBeGreaterThanOrEqual(LIP_TELEGRAPH_MIN_S);
    }
  });

  it("fails if consecutive scoring gates do not alternate across CX", () => {
    for (const date of DATES) {
      const course = generateCourse(dailySeed(date), { daily: true });
      const gates = scoringGates(course).filter((g) => g.y >= DIST.openEnd);
      for (let i = 1; i < gates.length; i++) {
        const a = Math.sign(gates[i - 1]!.baseCenter - CX);
        const b = Math.sign(gates[i]!.baseCenter - CX);
        expect(a, `${date} ${gates[i - 1]!.id}`).not.toBe(0);
        expect(b, `${date} ${gates[i]!.id}`).not.toBe(0);
        expect(a, `${date} ${gates[i - 1]!.id}→${gates[i]!.id}`).not.toBe(b);
      }
    }
  });

  it("passes the full layout check on Daily goldens and nearby days", () => {
    for (const date of DATES) {
      const course = generateCourse(dailySeed(date), { daily: true });
      expect(checkCourseLayout(course), date).toEqual([]);
    }
  });

  it("layout check fails a center-highway scoring gate", () => {
    const course = generateCourse(dailySeed("2026-09-17"), { daily: true });
    const g = scoringGates(course).find((o) => o.y >= DIST.openEnd);
    expect(g).toBeTruthy();
    g!.baseCenter = CX;
    g!.left = CX - 70;
    g!.right = CX + 70;
    g!.gapWidth = 140;
    const errors = checkCourseLayout(course);
    expect(errors.some((e) => e.includes("|center-CX|") || e.includes("covers CX") || e.includes("alternation"))).toBe(
      true,
    );
  });
});

describe("Endless weave after openEnd", () => {
  it("keeps alternating forced offsets (no center highway)", () => {
    for (const seed of ENDLESS_SEEDS) {
      const course = generateCourse(seed, { daily: false, endlessHorizon: 8000 });
      const gates = scoringGates(course).filter((g) => g.y >= DIST.openEnd);
      expect(gates.length, String(seed)).toBeGreaterThanOrEqual(8);
      for (const g of gates) {
        expect(Math.abs(g.baseCenter - CX), `seed ${seed} gate ${g.id}`).toBeGreaterThanOrEqual(40);
      }
      for (let i = 1; i < gates.length; i++) {
        const a = Math.sign(gates[i - 1]!.baseCenter - CX);
        const b = Math.sign(gates[i]!.baseCenter - CX);
        expect(a).not.toBe(b);
      }
    }
  });
});
