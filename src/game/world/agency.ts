import type { CourseSpec, ObstacleSpec } from "../../types.ts";
import type { Intent } from "../../types.ts";
import { CX, DIST, THREAD_RADIUS, TICK } from "./constants.ts";
import { moverUnsafeDuration } from "./course.ts";
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
  if (y < DIST.pinchEnd) return 52;
  if (y < DIST.moverEnd) return 58;
  if (y < DIST.rhythmEnd) return 64;
  return 52;
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
    if (g.y >= DIST.openEnd && g.y <= DIST.rhythmEnd && off < phaseMin - 0.01) {
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
  }

  if (course.daily) {
    const rhythm = gates.filter((g) => g.y >= DIST.moverEnd - 1e-6 && g.y <= DIST.rhythmEnd + 1e-6);
    if (rhythm.length !== 3) {
      errors.push(`Daily rhythm band must have exactly 3 scoring gates, got ${rhythm.length}`);
    }
    const movers = course.obstacles.filter(
      (o) => o.kind === "mover" && o.y >= DIST.pinchEnd && o.y <= DIST.moverEnd,
    );
    if (movers.length !== 1) {
      errors.push(`Daily mover window must have exactly 1 mover, got ${movers.length}`);
    } else {
      const m = movers[0]!;
      if (m.gapWidth < 100 - 1e-6 || m.gapWidth > 120 + 1e-6) {
        errors.push(`mover gapWidth ${m.gapWidth.toFixed(2)} outside 100–120`);
      }
      if (m.amplitude < 56 - 1e-6 || m.amplitude > 80 + 1e-6) {
        errors.push(`mover amplitude ${m.amplitude.toFixed(2)} outside 56–80`);
      }
      if (m.period < 2.5 - 1e-6 || m.period > 3.2 + 1e-6) {
        errors.push(`mover period ${m.period.toFixed(3)} outside 2.5–3.2`);
      }
      if (Math.abs(m.baseCenter - CX) < 40 - 1e-3) {
        errors.push(`mover baseCenter on highway |c-CX|=${Math.abs(m.baseCenter - CX).toFixed(2)}`);
      }
      const unsafe = moverUnsafeDuration(m);
      if (unsafe < 0.35) {
        errors.push(`mover center-hold unsafe window ${unsafe.toFixed(3)}s < 0.35s`);
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
