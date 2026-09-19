import { describe, expect, it } from "vitest";
import type { ObstacleSpec } from "../../types.ts";
import { dailySeed } from "../seed.ts";
import { BASE_SPEED, CX, ROOM_C, THREAD_RADIUS } from "../world/constants.ts";
import {
  cxFitsMoverGap,
  generateCourse,
  isMoverSnapPhase,
  moverContactTime,
  moverGap,
  moverUnsafeDuration,
  searchMoverPhase,
  streamEvents,
} from "../world/course.ts";

const PHASE_STEPS = 96;
const TELEGRAPH = 0.6;
const UNSAFE_MIN = 0.35;

function sampleMover(partial: Partial<ObstacleSpec> = {}): ObstacleSpec {
  const gapWidth = 118.7229;
  const baseCenter = 246.1922;
  const half = gapWidth / 2;
  return {
    id: 15,
    kind: "mover",
    y: 2218.7456,
    left: baseCenter - half,
    right: baseCenter + half,
    thickness: 14,
    baseCenter,
    gapWidth,
    amplitude: 66.7468,
    period: 2.8774,
    phase: 0,
    ...partial,
  };
}

function independentFits(spec: ObstacleSpec, t: number): boolean {
  const gap = moverGap(spec, t);
  return CX >= gap.left + THREAD_RADIUS && CX <= gap.right - THREAD_RADIUS;
}

function independentSnap(spec: ObstacleSpec): boolean {
  const tContact = Math.max(0, (spec.y - spec.thickness / 2) / BASE_SPEED);
  return independentFits(spec, tContact - TELEGRAPH) && !independentFits(spec, tContact);
}

function independentOpenWindow(spec: ObstacleSpec): number {
  const tContact = Math.max(0, (spec.y - spec.thickness / 2) / BASE_SPEED);
  if (!independentFits(spec, tContact)) return 0;
  const dt = 1 / 180;
  const limit = Math.max(spec.period, TELEGRAPH);
  let back = 0;
  let fwd = 0;
  while (back + dt <= limit && independentFits(spec, tContact - back - dt)) back += dt;
  while (fwd + dt <= limit && independentFits(spec, tContact + fwd + dt)) fwd += dt;
  return back + fwd;
}

function independentBestPhase(base: ObstacleSpec): number {
  type Cand = { phase: number; snap: boolean; punish: boolean; unsafe: number; open: number };
  const cands: Cand[] = [];
  for (let i = 0; i < PHASE_STEPS; i++) {
    const phase = (i / PHASE_STEPS) * Math.PI * 2;
    const spec = { ...base, phase };
    const snap = independentSnap(spec);
    const tContact = Math.max(0, (spec.y - spec.thickness / 2) / BASE_SPEED);
    const kills = !independentFits(spec, tContact);
    const unsafe = moverUnsafeDuration(spec);
    cands.push({
      phase,
      snap,
      punish: !snap && kills && unsafe >= UNSAFE_MIN,
      unsafe,
      open: independentOpenWindow(spec),
    });
  }
  cands.sort((a, b) => {
    if (a.snap !== b.snap) return a.snap ? 1 : -1;
    if (a.punish !== b.punish) return a.punish ? -1 : 1;
    if (a.punish) return b.unsafe - a.unsafe;
    return b.open - a.open;
  });
  return cands[0]!.phase;
}

const DATES = ["2026-09-17", "2026-09-18", "2026-01-01", "2026-12-31", "2027-06-06"];

describe("searchMoverPhase — no snap-shut", () => {
  it("rejects the pre-fix Daily golden phase that snapped shut on arrival", () => {
    const base = sampleMover({ phase: 3.0761 });
    expect(independentSnap(base)).toBe(true);
    expect(isMoverSnapPhase(base)).toBe(true);
    const found = searchMoverPhase(base);
    expect(found.snap).toBe(false);
    expect(found.telegraphedPunish).toBe(true);
    expect(found.phase).not.toBeCloseTo(3.0761, 3);
    expect(isMoverSnapPhase({ ...base, phase: found.phase })).toBe(false);
  });

  it("rejects phases that are safe at tContact−0.6s and unsafe at contact", () => {
    const base = sampleMover();
    const snaps: number[] = [];
    for (let i = 0; i < PHASE_STEPS; i++) {
      const phase = (i / PHASE_STEPS) * Math.PI * 2;
      if (independentSnap({ ...base, phase })) snaps.push(phase);
    }
    expect(snaps.length).toBeGreaterThan(0);

    const found = searchMoverPhase(base);
    expect(found.snap).toBe(false);
    expect(isMoverSnapPhase({ ...base, phase: found.phase })).toBe(false);
    expect(snaps).not.toContain(found.phase);

    const tContact = moverContactTime({ ...base, phase: found.phase });
    const spec = { ...base, phase: found.phase };
    const early = cxFitsMoverGap(spec, tContact - TELEGRAPH);
    const atContact = cxFitsMoverGap(spec, tContact);
    expect(early && !atContact).toBe(false);
  });

  it("prefers telegraphed center-punish, else the longest CX-open window at contact", () => {
    const base = sampleMover();
    const found = searchMoverPhase(base);
    expect(found.phase).toBe(independentBestPhase(base));
    if (found.telegraphedPunish) {
      expect(found.kills).toBe(true);
      expect(found.unsafe).toBeGreaterThanOrEqual(UNSAFE_MIN);
      expect(cxFitsMoverGap({ ...base, phase: found.phase }, moverContactTime(base) - TELEGRAPH)).toBe(false);
    } else {
      expect(found.kills).toBe(false);
      expect(found.openWindow).toBeGreaterThan(0);
    }
  });

  it("is deterministic for the same geometry", () => {
    const base = sampleMover();
    const a = searchMoverPhase(base);
    const b = searchMoverPhase(base);
    expect(a).toEqual(b);
    expect(searchMoverPhase({ ...base, amplitude: 72 }).phase).toBe(
      searchMoverPhase({ ...base, amplitude: 72 }).phase,
    );
  });
});

describe("Daily movers after phase search", () => {
  it("never snap-shuts on generated Daily courses", () => {
    for (const date of DATES) {
      const course = generateCourse(dailySeed(date), { daily: true });
      const movers = course.obstacles.filter((o) => o.kind === "mover");
      expect(movers.length, date).toBe(ROOM_C.count);
      for (const m of movers) {
        expect(isMoverSnapPhase(m), date).toBe(false);
        const tContact = moverContactTime(m);
        const early = cxFitsMoverGap(m, tContact - TELEGRAPH);
        const atContact = cxFitsMoverGap(m, tContact);
        expect(early && !atContact, date).toBe(false);
      }
    }
  });

  it("replays the same mover phases for the same Daily key", () => {
    const seed = dailySeed("2026-09-17");
    const a = streamEvents(generateCourse(seed, { daily: true }));
    const b = streamEvents(generateCourse(seed, { daily: true }));
    expect(a).toEqual(b);
    const movers = a.filter((e) => e.kind === "mover");
    expect(movers.length).toBe(ROOM_C.count);
    expect(movers.map((m) => m.phase)).toEqual(b.filter((e) => e.kind === "mover").map((m) => m.phase));
  });
});
