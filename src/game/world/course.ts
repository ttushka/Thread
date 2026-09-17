import type { CourseSpec, ObstacleSpec, StreamEvent, WallKeyframe } from "../../types.ts";
import { Rng } from "../rng.ts";
import { DIST, FIELD_W, KEYFRAME_PAD, WALL_MARGIN } from "./constants.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function sampleWalls(
  keyframes: WallKeyframe[],
  y: number,
): { left: number; right: number; gateId: number | null } {
  if (keyframes.length === 0) {
    return { left: WALL_MARGIN, right: FIELD_W - WALL_MARGIN, gateId: null };
  }
  if (y <= keyframes[0]!.y) {
    const k = keyframes[0]!;
    return { left: k.left, right: k.right, gateId: k.gateId };
  }
  const last = keyframes[keyframes.length - 1]!;
  if (y >= last.y) {
    return { left: last.left, right: last.right, gateId: last.gateId };
  }
  let lo = 0;
  let hi = keyframes.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid]!.y <= y) lo = mid;
    else hi = mid;
  }
  const a = keyframes[lo]!;
  const b = keyframes[hi]!;
  const t = smoothstep((y - a.y) / Math.max(1e-6, b.y - a.y));
  return {
    left: a.left + (b.left - a.left) * t,
    right: a.right + (b.right - a.right) * t,
    gateId: t < 0.5 ? a.gateId : b.gateId,
  };
}

function placeTunnel(
  rng: Rng,
  y: number,
  gapMin: number,
  gapMax: number,
  wander: number,
  prevCenter: number,
  asGate: boolean,
  nextId: () => number,
): { kf: WallKeyframe; center: number; spec: ObstacleSpec | null } {
  const gap = rng.float(gapMin, gapMax);
  const minCenter = WALL_MARGIN + gap / 2;
  const maxCenter = FIELD_W - WALL_MARGIN - gap / 2;
  const center = clamp(prevCenter + rng.float(-wander, wander), minCenter, maxCenter);
  const left = center - gap / 2;
  const right = center + gap / 2;
  let spec: ObstacleSpec | null = null;
  let gateId: number | null = null;
  if (asGate) {
    const id = nextId();
    gateId = id;
    spec = {
      id,
      kind: "gate",
      y,
      left,
      right,
      thickness: 10,
      baseCenter: center,
      gapWidth: gap,
      amplitude: 0,
      period: 1,
      phase: 0,
    };
  }
  return {
    kf: { y, left, right, gateId },
    center,
    spec,
  };
}

function placeMover(
  rng: Rng,
  y: number,
  nextId: () => number,
): ObstacleSpec {
  const gapWidth = rng.float(118, 150);
  const amplitude = rng.float(36, 64);
  const minCenter = WALL_MARGIN + gapWidth / 2 + amplitude;
  const maxCenter = FIELD_W - WALL_MARGIN - gapWidth / 2 - amplitude;
  const baseCenter = rng.float(minCenter, Math.max(minCenter + 1, maxCenter));
  return {
    id: nextId(),
    kind: "mover",
    y,
    left: baseCenter - gapWidth / 2,
    right: baseCenter + gapWidth / 2,
    thickness: 14,
    baseCenter,
    gapWidth,
    amplitude,
    period: rng.float(2.4, 3.4),
    phase: rng.float(0, Math.PI * 2),
  };
}

export type CourseOptions = {
  daily: boolean;
  /** When set, skip crypto and build from this seed (Endless tests). */
  endlessHorizon?: number;
};

/**
 * Deterministic course. All randomness from `seed` via mulberry32.
 * Daily finish is a soft landing after the authored first minute.
 */
export function generateCourse(seed: number, opts: CourseOptions): CourseSpec {
  const rng = new Rng(seed);
  const keyframes: WallKeyframe[] = [];
  const obstacles: ObstacleSpec[] = [];
  let nextIdNum = 1;
  const nextId = () => nextIdNum++;
  let y = -KEYFRAME_PAD;
  let center = FIELD_W / 2;

  const push = (
    gapMin: number,
    gapMax: number,
    wander: number,
    asGate: boolean,
    dy: number,
  ) => {
    y += dy;
    const placed = placeTunnel(rng, y, gapMin, gapMax, wander, center, asGate, nextId);
    center = placed.center;
    keyframes.push(placed.kf);
    if (placed.spec) obstacles.push(placed.spec);
  };

  // 0–5s: soft curve, no fail. Wide corridor, gentle wander, not scoring gates.
  keyframes.push({
    y: -KEYFRAME_PAD,
    left: 40,
    right: FIELD_W - 40,
    gateId: null,
  });
  while (y < DIST.openEnd) {
    push(248, 292, 16, false, rng.float(70, 90));
  }

  // 5–20s: first readable pinches. One knob: gap width.
  while (y < DIST.pinchEnd) {
    push(132, 168, 46, true, rng.float(100, 128));
  }

  // 20–40s: one telegraphing moving hazard among readable pinches.
  const moverAt = DIST.pinchEnd + rng.float(280, 520);
  let moverPlaced = false;
  while (y < DIST.moverEnd) {
    const step = rng.float(110, 140);
    if (!moverPlaced && y + step >= moverAt) {
      const my = moverAt;
      obstacles.push(placeMover(rng, my, nextId));
      moverPlaced = true;
      // Keep tunnel generous around the mover so the mover is the readable threat.
      y = my;
      const around = placeTunnel(rng, y, 188, 220, 28, center, false, nextId);
      center = around.center;
      keyframes.push(around.kf);
      continue;
    }
    push(124, 158, 50, true, step);
  }
  if (!moverPlaced) {
    obstacles.push(placeMover(rng, DIST.pinchEnd + 360, nextId));
  }

  // 40–60s: 2–3 gate rhythm, then a soft rest.
  const rhythmCount = rng.int(2, 3);
  for (let i = 0; i < rhythmCount; i++) {
    push(102, 128, 54, true, rng.float(88, 108));
  }
  while (y < DIST.rhythmEnd) {
    push(176, 214, 24, false, rng.float(90, 120));
  }

  let finishY: number | null = null;
  if (opts.daily) {
    // Soft land into a finish line — same for a given seed, fair snag if you miss the rest.
    push(210, 240, 12, false, 90);
    finishY = DIST.dailyFinish;
    keyframes.push({
      y: finishY + KEYFRAME_PAD,
      left: 48,
      right: FIELD_W - 48,
      gateId: null,
    });
  } else {
    const horizon = opts.endlessHorizon ?? DIST.rhythmEnd + 24000;
    let segment = 0;
    while (y < horizon) {
      segment += 1;
      const knob = (segment - 1) % 3;
      const tighten = Math.min(36, segment * 3);
      const gapMin = Math.max(78, 118 - tighten);
      const gapMax = Math.max(gapMin + 12, 150 - tighten);
      const spacing = knob === 1 ? rng.float(78, 96) : rng.float(96, 124);
      const end = y + 900;
      let lastMover = y - 400;
      while (y < end && y < horizon) {
        if (knob === 2 && y - lastMover > rng.float(380, 560)) {
          const my = y + rng.float(40, 80);
          obstacles.push(placeMover(rng, my, nextId));
          lastMover = my;
          y = my;
          const around = placeTunnel(rng, y, gapMin + 40, gapMax + 50, 30, center, false, nextId);
          center = around.center;
          keyframes.push(around.kf);
          continue;
        }
        push(gapMin, gapMax, 52 + Math.min(18, segment), true, spacing);
      }
    }
    keyframes.push({
      y: y + KEYFRAME_PAD,
      left: keyframes[keyframes.length - 1]!.left,
      right: keyframes[keyframes.length - 1]!.right,
      gateId: null,
    });
  }

  obstacles.sort((a, b) => a.y - b.y || a.id - b.id);
  keyframes.sort((a, b) => a.y - b.y);

  return {
    seed: seed >>> 0,
    daily: opts.daily,
    finishY,
    keyframes,
    obstacles,
  };
}

export function streamEvents(course: CourseSpec, count?: number): StreamEvent[] {
  const events: StreamEvent[] = course.obstacles.map((o) => ({
    id: o.id,
    kind: o.kind,
    y: round4(o.y),
    center: round4((o.left + o.right) / 2),
    gap: round4(o.right - o.left),
    amplitude: round4(o.amplitude),
    period: round4(o.period),
    phase: round4(o.phase),
  }));
  events.sort((a, b) => a.y - b.y || a.id - b.id);
  return typeof count === "number" ? events.slice(0, count) : events;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function moverGap(spec: ObstacleSpec, simTime: number): { left: number; right: number } {
  if (spec.kind !== "mover" || spec.amplitude === 0) {
    return { left: spec.left, right: spec.right };
  }
  const osc = Math.sin(simTime * ((Math.PI * 2) / spec.period) + spec.phase) * spec.amplitude;
  const center = spec.baseCenter + osc;
  const half = spec.gapWidth / 2;
  let left = center - half;
  let right = center + half;
  if (left < WALL_MARGIN) {
    const shift = WALL_MARGIN - left;
    left += shift;
    right += shift;
  }
  if (right > FIELD_W - WALL_MARGIN) {
    const shift = right - (FIELD_W - WALL_MARGIN);
    left -= shift;
    right -= shift;
  }
  return { left, right };
}
