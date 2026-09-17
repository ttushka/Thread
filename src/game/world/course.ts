import type { CourseSpec, ObstacleSpec, StreamEvent, WallKeyframe } from "../../types.ts";
import { Rng } from "../rng.ts";
import {
  BASE_SPEED,
  CX,
  DIST,
  FIELD_W,
  KEYFRAME_PAD,
  THREAD_RADIUS,
  WALL_MARGIN,
} from "./constants.ts";

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

function tunnelBounds(gap: number): { minCenter: number; maxCenter: number } {
  return {
    minCenter: WALL_MARGIN + gap / 2,
    maxCenter: FIELD_W - WALL_MARGIN - gap / 2,
  };
}

/** Non-scoring rest / teach tunnels. Small wander is allowed; no L/R alternation. */
function placeRest(
  rng: Rng,
  y: number,
  gapMin: number,
  gapMax: number,
  wander: number,
  prevCenter: number,
): { kf: WallKeyframe; center: number } {
  const gap = rng.float(gapMin, gapMax);
  const { minCenter, maxCenter } = tunnelBounds(gap);
  const center = clamp(prevCenter + rng.float(-wander, wander), minCenter, maxCenter);
  return {
    kf: { y, left: center - gap / 2, right: center + gap / 2, gateId: null },
    center,
  };
}

/**
 * Scoring gate: forced offset from CX, not prevCenter+wander.
 * Offset is raised if needed so holding x=CX is a death (not a nick-through).
 */
function placeScoringGate(
  rng: Rng,
  y: number,
  gapMin: number,
  gapMax: number,
  minOffset: number,
  offJitter: number,
  side: number,
  nextId: () => number,
): { kf: WallKeyframe; center: number; spec: ObstacleSpec } {
  const gap = rng.float(gapMin, gapMax);
  let off = minOffset + rng.float(0, offJitter);
  const killOff = gap / 2 - THREAD_RADIUS + 0.5;
  if (off < killOff) off = killOff;
  const { minCenter, maxCenter } = tunnelBounds(gap);
  const center = clamp(CX + side * off, minCenter, maxCenter);
  const left = center - gap / 2;
  const right = center + gap / 2;
  const id = nextId();
  return {
    kf: { y, left, right, gateId: id },
    center,
    spec: {
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
    },
  };
}

const MOVER_THICKNESS = 14;
const MOVER_UNSAFE_MIN = 0.35;
const PHASE_STEPS = 96;

/** Seconds in the telegraph window around contact where CX is outside the moving gap. */
export function moverUnsafeDuration(spec: ObstacleSpec, threadX = CX): number {
  const band = spec.thickness + THREAD_RADIUS;
  const t0 = Math.max(0, (spec.y - band) / BASE_SPEED);
  const t1 = (spec.y + band) / BASE_SPEED;
  const span = t1 - t0;
  if (span <= 0) return 0;
  const samples = 64;
  let unsafe = 0;
  const dt = span / samples;
  for (let i = 0; i < samples; i++) {
    const t = t0 + (i + 0.5) * dt;
    const gap = moverGap(spec, t);
    if (threadX < gap.left || threadX > gap.right) unsafe += dt;
  }
  return unsafe;
}

function moverSlabKillsCenter(spec: ObstacleSpec, threadX = CX): boolean {
  const half = spec.thickness / 2;
  const t0 = Math.max(0, (spec.y - half) / BASE_SPEED);
  const t1 = (spec.y + half) / BASE_SPEED;
  const samples = 24;
  const dt = (t1 - t0) / samples;
  for (let i = 0; i < samples; i++) {
    const t = t0 + (i + 0.5) * dt;
    const gap = moverGap(spec, t);
    if (threadX >= gap.left + THREAD_RADIUS && threadX <= gap.right - THREAD_RADIUS) {
      return false;
    }
  }
  return true;
}

function searchMoverPhase(base: ObstacleSpec): { phase: number; unsafe: number; kills: boolean } {
  let best = { phase: 0, unsafe: -1, kills: false };
  for (let i = 0; i < PHASE_STEPS; i++) {
    const phase = (i / PHASE_STEPS) * Math.PI * 2;
    const spec = { ...base, phase };
    const kills = moverSlabKillsCenter(spec);
    const unsafe = moverUnsafeDuration(spec);
    const better =
      (kills && !best.kills) ||
      (kills === best.kills && unsafe > best.unsafe);
    if (better) best = { phase, unsafe, kills };
  }
  return best;
}

function placeMover(rng: Rng, y: number, side: number, nextId: () => number): ObstacleSpec {
  const id = nextId();
  let gapWidth = rng.float(100, 120);
  let amplitude = rng.float(56, 72);
  const period = rng.float(2.5, 3.2);
  let offset = rng.float(40, 70);

  const fit = (): ObstacleSpec => {
    const half = gapWidth / 2;
    const minC = WALL_MARGIN + half;
    const maxC = FIELD_W - WALL_MARGIN - half;
    let baseCenter = clamp(CX + side * offset, minC, maxC);
    if (Math.abs(baseCenter - CX) < 40) {
      const pushed = CX + side * Math.max(40, offset);
      baseCenter = clamp(pushed, minC, maxC);
    }
    return {
      id,
      kind: "mover",
      y,
      left: baseCenter - half,
      right: baseCenter + half,
      thickness: MOVER_THICKNESS,
      baseCenter,
      gapWidth,
      amplitude,
      period,
      phase: 0,
    };
  };

  let spec = fit();
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) {
      amplitude = Math.min(80, amplitude + 8);
      offset = Math.min(90, offset + 10);
      spec = fit();
    }
    const found = searchMoverPhase(spec);
    spec.phase = found.phase;
    if (found.kills && found.unsafe >= MOVER_UNSAFE_MIN) return spec;
  }
  const found = searchMoverPhase(spec);
  spec.phase = found.phase;
  return spec;
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
  let center = CX;
  /** Weave side for scoring gates. Chosen once at openEnd, then flips every scoring gate. */
  let side: -1 | 1 = 1;

  const pushRest = (gapMin: number, gapMax: number, wander: number, dy: number) => {
    y += dy;
    const placed = placeRest(rng, y, gapMin, gapMax, wander, center);
    center = placed.center;
    keyframes.push(placed.kf);
  };

  const pushGate = (
    gapMin: number,
    gapMax: number,
    minOffset: number,
    offJitter: number,
    dy: number,
  ) => {
    y += dy;
    const placed = placeScoringGate(rng, y, gapMin, gapMax, minOffset, offJitter, side, nextId);
    side = -side as -1 | 1;
    center = placed.center;
    keyframes.push(placed.kf);
    obstacles.push(placed.spec);
  };

  // 0–5s: soft teach. Wide corridor, gentle wander, not scoring gates.
  keyframes.push({
    y: -KEYFRAME_PAD,
    left: 40,
    right: FIELD_W - 40,
    gateId: null,
  });
  while (y < DIST.openEnd) {
    pushRest(260, 300, 16, rng.float(70, 90));
  }
  side = rng.pick([-1, 1] as const);

  // 5–20s: first pinches. Forced weave; holding CX dies.
  while (y < DIST.pinchEnd) {
    const step = rng.float(105, 125);
    if (y + step >= DIST.pinchEnd) break;
    pushGate(118, 142, 52, 14, step);
  }

  // 20–40s: readable pinches + one telegraphing mover that punishes static center.
  const moverAt = DIST.pinchEnd + rng.float(280, 520);
  let moverPlaced = false;
  while (y < DIST.moverEnd) {
    const step = rng.float(110, 135);
    if (!moverPlaced && y + step >= moverAt) {
      const my = moverAt;
      obstacles.push(placeMover(rng, my, side, nextId));
      moverPlaced = true;
      y = my;
      const around = placeRest(rng, y, 188, 220, 16, center);
      center = around.center;
      keyframes.push(around.kf);
      continue;
    }
    if (y + step >= DIST.moverEnd) break;
    pushGate(110, 136, 58, 12, step);
  }
  if (!moverPlaced) {
    obstacles.push(placeMover(rng, DIST.pinchEnd + 360, side, nextId));
  }
  if (y < DIST.moverEnd) {
    pushRest(188, 220, 16, DIST.moverEnd - y);
  }

  // 40–60s: exactly 3 rhythm gates, then a soft rest.
  for (let i = 0; i < 3; i++) {
    pushGate(96, 118, 64, 10, rng.float(88, 108));
  }
  while (y < DIST.rhythmEnd) {
    pushRest(210, 240, 12, rng.float(90, 120));
  }

  let finishY: number | null = null;
  if (opts.daily) {
    // Soft land into a finish line — same for a given seed, fair snag if you miss the rest.
    pushRest(210, 240, 12, 90);
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
      const minOffset = Math.min(72, 52 + segment * 2);
      const spacing = knob === 1 ? rng.float(78, 96) : rng.float(96, 124);
      const end = y + 900;
      let lastMover = y - 400;
      while (y < end && y < horizon) {
        if (knob === 2 && y - lastMover > rng.float(380, 560)) {
          const my = y + rng.float(40, 80);
          obstacles.push(placeMover(rng, my, side, nextId));
          lastMover = my;
          y = my;
          const around = placeRest(rng, y, gapMin + 40, gapMax + 50, 16, center);
          center = around.center;
          keyframes.push(around.kf);
          continue;
        }
        pushGate(gapMin, gapMax, minOffset, 12, spacing);
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
