import { describe, expect, it } from "vitest";
import { dailySeed } from "../seed.ts";
import { generateCourse } from "../world/course.ts";
import { checkCourseLayout, scoringGates, simulateCenterHold } from "../world/agency.ts";
import { CX, DIST } from "../world/constants.ts";

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

  it("kills center-hold in the first pinch band, not at the finish", () => {
    for (const date of DATES) {
      const world = simulateCenterHold(dailySeed(date), true);
      expect(world.distance, date).toBeGreaterThan(DIST.openEnd);
      expect(world.distance, date).toBeLessThan(DIST.pinchEnd);
    }
  });

  it("has no scoring gate with |center-CX| < 40 after open", () => {
    for (const date of DATES) {
      const course = generateCourse(dailySeed(date), { daily: true });
      for (const g of scoringGates(course)) {
        if (g.y < DIST.openEnd) continue;
        expect(Math.abs(g.baseCenter - CX), `${date} gate ${g.id}`).toBeGreaterThanOrEqual(40);
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
