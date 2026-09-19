import type { CourseSpec, ObstacleSpec } from "../../types.ts";
import type { Intent } from "../../types.ts";
import {
  BASE_SPEED,
  CX,
  DIST,
  LIP_TELEGRAPH_MIN_S,
  MOVER_MOTION,
  ROOM_A,
  ROOM_B,
  ROOM_C,
  THREAD_RADIUS,
  TICK,
} from "./constants.ts";
import { cxFitsMoverGap, isMoverSnapPhase, moverContactTime, moverUnsafeDuration } from "./course.ts";
import { createWorld, updateWorld, type World } from "./simulate.ts";

const CENTER_HOLD: Intent = {
  steer: 0,
  pointerActive: false,
  pointerX: CX,
  restart: false,
  toTitle: false,
};

export function scoringGates(course: CourseSpec): ObstacleSpec[] {
  return course.obstacles.filter((o) => o.kind === "gate").sort((a, b) => a.y - b.y || a.id - b.id);
}

export function minOffsetForGateY(y: number): number {
  if (y < DIST.openEnd) return 0;
  if (y < DIST.roomAEnd) return ROOM_A.minOffset;
  if (y < DIST.roomBEnd) return ROOM_B.minOffset;
  if (y < DIST.roomCEnd) return ROOM_C.minOffset;
  return ROOM_B.minOffset;
}

/** Geometric Daily / first-minute agency rules. Empty = pass. */
export function checkCourseLayout(course: CourseSpec): string[] {
  const errors: string[] = [];
  const gates = scoringGates(course);
  const firstMinute = gates.filter((g) => g.y <= DIST.rhythmEnd + 1e-6);

  for (const g of gates) {
    if (g.y < DIST.openEnd) {
      errors.push(`scoring gate ${g.id} at y=${g.y.toFixed(1)} is before openEnd`);
    }
    const center = g.baseCenter;
    const off = Math.abs(center - CX);
    if (g.y >= DIST.openEnd && off < 40) {
      errors.push(`scoring gate ${g.id} |center-CX|=${off.toFixed(2)} < 40`);
    }
    const phaseMin = minOffsetForGateY(g.y);
    if (g.y >= DIST.openEnd && g.y <= DIST.rhythmEnd && off < phaseMin - 1) {
      errors.push(`scoring gate ${g.id} |center-CX|=${off.toFixed(2)} < minOffset ${phaseMin}`);
    }
    const killOff = g.gapWidth / 2 - THREAD_RADIUS;
    if (g.y >= DIST.openEnd && off <= killOff) {
      errors.push(`scoring gate ${g.id} still covers CX (off=${off.toFixed(2)}, need > ${killOff.toFixed(2)})`);
    }
  }

  if (course.daily && firstMinute.length < 8) {
    errors.push(`fewer than 8 scoring gates in first minute: ${firstMinute.length}`);
  }

  for (let i = 1; i < gates.length; i++) {
    const a = gates[i - 1]!;
    const b = gates[i]!;
    if (a.y < DIST.openEnd || b.y < DIST.openEnd) continue;
    const sa = Math.sign(a.baseCenter - CX);
    const sb = Math.sign(b.baseCenter - CX);
    if (sa === 0 || sb === 0 || sa === sb) {
      errors.push(`alternation broken between gates ${a.id}@${a.y.toFixed(0)} and ${b.id}@${b.y.toFixed(0)}`);
    }
    const dy = b.y - a.y;
    const telegraph = dy / BASE_SPEED;
    if (telegraph < LIP_TELEGRAPH_MIN_S - 1e-6) {
      errors.push(
        `scoring gates ${a.id}→${b.id} telegraph ${telegraph.toFixed(3)}s < ${LIP_TELEGRAPH_MIN_S}s`,
      );
    }
  }

  if (course.daily) {
    const roomA = gates.filter((g) => g.y >= DIST.openEnd && g.y < DIST.roomAEnd);
    const roomB = gates.filter((g) => g.y >= DIST.roomAEnd && g.y < DIST.roomBEnd);
    if (roomA.length < 3) {
      errors.push(`Room A must have at least 3 scoring gates, got ${roomA.length}`);
    }
    if (roomB.length < 6) {
      errors.push(`Room B must have at least 6 scoring gates, got ${roomB.length}`);
    }
    for (const g of roomA) {
      const lo = ROOM_A.gapMin;
      const hi = Math.max(ROOM_A.gapMax, ROOM_A.firstGapMax);
      if (g.gapWidth < lo - 1e-6 || g.gapWidth > hi + 1e-6) {
        errors.push(`Room A gate ${g.id} gap ${g.gapWidth.toFixed(1)} outside ${lo}–${hi}`);
      }
    }
    for (const g of roomB) {
      if (g.gapWidth < ROOM_B.gapMin - 1e-6 || g.gapWidth > ROOM_B.gapMax + 1e-6) {
        errors.push(`Room B gate ${g.id} gap ${g.gapWidth.toFixed(1)} outside ${ROOM_B.gapMin}–${ROOM_B.gapMax}`);
      }
    }
    const earlyMovers = course.obstacles.filter((o) => o.kind === "mover" && o.y < DIST.roomBEnd - 1e-6);
    if (earlyMovers.length > 0) {
      errors.push(`movers before Room C: ${earlyMovers.map((m) => m.y.toFixed(0)).join(",")}`);
    }
    const movers = course.obstacles
      .filter((o) => o.kind === "mover" && o.y >= DIST.roomBEnd && o.y <= DIST.roomCEnd)
      .sort((a, b) => a.y - b.y || a.id - b.id);
    if (movers.length < 3) {
      errors.push(`Daily Room C must have at least 3 movers, got ${movers.length}`);
    } else if (movers.length !== ROOM_C.count) {
      errors.push(`Daily Room C must have exactly ${ROOM_C.count} movers, got ${movers.length}`);
    } else {
      for (let i = 1; i < movers.length; i++) {
        const dt = (movers[i]!.y - movers[i - 1]!.y) / BASE_SPEED;
        if (dt < LIP_TELEGRAPH_MIN_S - 1e-6) {
          errors.push(
            `movers ${movers[i - 1]!.id}→${movers[i]!.id} telegraph ${dt.toFixed(3)}s < ${LIP_TELEGRAPH_MIN_S}s`,
          );
        }
      }
      for (const m of movers) {
        if (m.gapWidth < MOVER_MOTION.gapMin - 1e-6 || m.gapWidth > MOVER_MOTION.gapMax + 1e-6) {
          errors.push(`mover gapWidth ${m.gapWidth.toFixed(2)} outside ${MOVER_MOTION.gapMin}–${MOVER_MOTION.gapMax}`);
        }
        if (
          m.amplitude < MOVER_MOTION.amplitudeMin - 1e-6 ||
          m.amplitude > MOVER_MOTION.amplitudeRetryCap + 1e-6
        ) {
          errors.push(
            `mover amplitude ${m.amplitude.toFixed(2)} outside ${MOVER_MOTION.amplitudeMin}–${MOVER_MOTION.amplitudeRetryCap}`,
          );
        }
        if (m.period < MOVER_MOTION.periodMin - 1e-6 || m.period > MOVER_MOTION.periodMax + 1e-6) {
          errors.push(
            `mover period ${m.period.toFixed(3)} outside ${MOVER_MOTION.periodMin}–${MOVER_MOTION.periodMax}`,
          );
        }
        if (Math.abs(m.baseCenter - CX) < 40 - 1e-3) {
          errors.push(`mover baseCenter on highway |c-CX|=${Math.abs(m.baseCenter - CX).toFixed(2)}`);
        }
        if (isMoverSnapPhase(m)) {
          errors.push(`mover snaps shut: CX safe at tContact−0.6s but unsafe at contact`);
        } else if (!cxFitsMoverGap(m, moverContactTime(m))) {
          const unsafe = moverUnsafeDuration(m);
          if (unsafe < 0.35) {
            errors.push(`mover center-hold unsafe window ${unsafe.toFixed(3)}s < 0.35s`);
          }
        }
      }
    }
  }

  return errors;
}

export function simulateCenterHold(seed: number, daily: boolean): World {
  const world = createWorld(seed, { daily, reducedMotion: true, endlessHorizon: daily ? undefined : 7000 });
  const cap = Math.ceil(90 / TICK);
  for (let i = 0; i < cap; i++) {
    updateWorld(world, CENTER_HOLD, TICK);
    if (!world.alive || world.cleared) break;
  }
  return world;
}
