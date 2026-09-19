import type { CourseSpec, ObstacleSpec, StreamEvent, WallKeyframe } from "../../types.ts";
import { Rng } from "../rng.ts";
import type { ExperimentVariant } from "../variant.ts";
import {
  BASE_SPEED,
  CX,
  DIST,
  FIELD_W,
  GATE_LIP_THICKNESS,
  KEYFRAME_PAD,
  LIP_TELEGRAPH_MIN_S,
  MOVER_MOTION,
  ROOM_A,
  ROOM_B,
  ROOM_C,
  THREAD_RADIUS,
  WALL_MARGIN,
} from "./constants.ts";
import { quantizeLipY } from "./beat.ts";
import { blockPattern, gapFromBlockedLanes } from "./lanes.ts";

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

/** Scoring-lip Δy. Clamped so contact stays ≥ LIP_TELEGRAPH_MIN_S (fairness #19). */
function lipStep(rng: Rng, min: number, max: number): number {
  const floor = BASE_SPEED * LIP_TELEGRAPH_MIN_S;
  return rng.float(Math.max(min, floor), Math.max(max, floor));
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
      thickness: GATE_LIP_THICKNESS,
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
/** Same telegraph floor as the agency brief: no snap-shut inside this window. */
export const MOVER_SNAP_TELEGRAPH = 0.6;
const OPEN_WINDOW_DT = 1 / 180;

/** First slab overlap — arrival, matching `hitObstacle` y-range. */
export function moverContactTime(spec: ObstacleSpec): number {
  return Math.max(0, (spec.y - spec.thickness / 2) / BASE_SPEED);
}

/** Thread radius fits inside the moving gap at `simTime` (not a death). */
export function cxFitsMoverGap(spec: ObstacleSpec, simTime: number, threadX = CX): boolean {
  const gap = moverGap(spec, simTime);
  return threadX >= gap.left + THREAD_RADIUS && threadX <= gap.right - THREAD_RADIUS;
}

/** Snap-shut: CX still fits at tContact−0.6s but not at arrival. */
export function isMoverSnapPhase(spec: ObstacleSpec, threadX = CX): boolean {
  const tContact = moverContactTime(spec);
  const early = cxFitsMoverGap(spec, tContact - MOVER_SNAP_TELEGRAPH, threadX);
  const atContact = cxFitsMoverGap(spec, tContact, threadX);
  return early && !atContact;
}

/** Continuous CX-open duration that includes tContact; 0 if closed on arrival. */
export function cxOpenWindowAtContact(spec: ObstacleSpec, threadX = CX): number {
  const tContact = moverContactTime(spec);
  if (!cxFitsMoverGap(spec, tContact, threadX)) return 0;
  const limit = Math.max(spec.period, MOVER_SNAP_TELEGRAPH);
  let back = 0;
  let fwd = 0;
  while (back + OPEN_WINDOW_DT <= limit && cxFitsMoverGap(spec, tContact - back - OPEN_WINDOW_DT, threadX)) {
    back += OPEN_WINDOW_DT;
  }
  while (fwd + OPEN_WINDOW_DT <= limit && cxFitsMoverGap(spec, tContact + fwd + OPEN_WINDOW_DT, threadX)) {
    fwd += OPEN_WINDOW_DT;
  }
  return back + fwd;
}

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

export type MoverPhaseSearch = {
  phase: number;
  unsafe: number;
  kills: boolean;
  telegraphedPunish: boolean;
  snap: boolean;
  openWindow: number;
};

function rankMoverPhase(a: MoverPhaseSearch, b: MoverPhaseSearch): boolean {
  if (a.snap !== b.snap) return !a.snap;
  if (a.telegraphedPunish !== b.telegraphedPunish) return a.telegraphedPunish;
  if (a.telegraphedPunish) return a.unsafe > b.unsafe;
  return a.openWindow > b.openWindow;
}

function evaluateMoverPhase(spec: ObstacleSpec): MoverPhaseSearch {
  const tContact = moverContactTime(spec);
  const safeEarly = cxFitsMoverGap(spec, tContact - MOVER_SNAP_TELEGRAPH);
  const safeContact = cxFitsMoverGap(spec, tContact);
  const snap = safeEarly && !safeContact;
  const kills = !safeContact;
  const unsafe = moverUnsafeDuration(spec);
  const telegraphedPunish = !snap && kills && unsafe >= MOVER_UNSAFE_MIN;
  const openWindow = safeContact ? cxOpenWindowAtContact(spec) : 0;
  return { phase: spec.phase, unsafe, kills, telegraphedPunish, snap, openWindow };
}

/**
 * Phase search: reject snap-shut, prefer a telegraphed center close, else the
 * longest CX-open window through contact. Geometry (speed/gap) is unchanged.
 */
export function searchMoverPhase(base: ObstacleSpec): MoverPhaseSearch {
  let best: MoverPhaseSearch | null = null;
  for (let i = 0; i < PHASE_STEPS; i++) {
    const phase = (i / PHASE_STEPS) * Math.PI * 2;
    const cand = evaluateMoverPhase({ ...base, phase });
    if (!best || rankMoverPhase(cand, best)) best = cand;
  }
  return best!;
}

function placeMover(rng: Rng, y: number, side: number, nextId: () => number): ObstacleSpec {
  const id = nextId();
  let gapWidth = rng.float(MOVER_MOTION.gapMin, MOVER_MOTION.gapMax);
  let amplitude = rng.float(MOVER_MOTION.amplitudeMin, MOVER_MOTION.amplitudeMax);
  const period = rng.float(MOVER_MOTION.periodMin, MOVER_MOTION.periodMax);
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
      amplitude = Math.min(MOVER_MOTION.amplitudeRetryCap, amplitude + 8);
      offset = Math.min(90, offset + 10);
      spec = fit();
    }
    const found = searchMoverPhase(spec);
    spec.phase = found.phase;
    if (found.telegraphedPunish) return spec;
  }
  const found = searchMoverPhase(spec);
  spec.phase = found.phase;
  return spec;
}

/** Room C gauntlet Ys in [start, end], ≥ telegraph apart. Shared by Control and Beat. */
function planGauntletYs(rng: Rng, start: number, end: number, count: number = ROOM_C.count): number[] {
  const floor = BASE_SPEED * LIP_TELEGRAPH_MIN_S;
  const span = Math.max(0, end - start);
  const pad = Math.min(ROOM_C.tailPad, Math.max(48, span * 0.1));
  const lastAllowed = end - pad;
  const packed = (lastAllowed - start - 80) / Math.max(1, count - 1);
  const spacing = Math.max(floor, Math.min(rng.float(ROOM_C.spacingMin, ROOM_C.spacingMax), packed));
  const firstHi = Math.min(start + ROOM_C.firstMax, lastAllowed - (count - 1) * spacing);
  const firstLo = Math.min(start + ROOM_C.firstMin, firstHi);
  let y = rng.float(Math.max(start + 40, firstLo), Math.max(firstLo, firstHi));
  const ys: number[] = [];
  for (let i = 0; i < count; i++) {
    if (y > lastAllowed) break;
    ys.push(y);
    y += spacing;
  }
  while (ys.length < Math.min(3, count)) {
    const last = ys[ys.length - 1] ?? start + 80;
    const next = last + floor;
    if (next > end - 20) break;
    ys.push(next);
  }
  return ys;
}

function insertMover(
  rng: Rng,
  y: number,
  side: number,
  nextId: () => number,
  obstacles: ObstacleSpec[],
  keyframes: WallKeyframe[],
  center: number,
): number {
  obstacles.push(placeMover(rng, y, side, nextId));
  const around = placeRest(rng, y, 188, 220, 16, center);
  keyframes.push(around.kf);
  return around.center;
}

export type CourseOptions = {
  daily: boolean;
  /** When set, skip crypto and build from this seed (Endless tests). */
  endlessHorizon?: number;
  /**
   * Beat/lanes replace layout. Control and brake omit this (or pass `control`)
   * so the control RNG stream and goldens stay untouched.
   */
  variant?: ExperimentVariant;
};

/**
 * Deterministic course. All randomness from `seed` via mulberry32.
 * Daily finish is a soft landing after the authored first minute.
 * Control / Brake share this path; Beat only snaps scoring-lip Y to the grid.
 */
export function generateCourse(seed: number, opts: CourseOptions): CourseSpec {
  if (opts.variant === "beat") return generateAnalogCourse(seed, opts, true);
  if (opts.variant === "lanes") return generateLanesCourse(seed, opts);
  return generateAnalogCourse(seed, opts, false);
}

type LipRoom = {
  gapMin: number;
  gapMax: number;
  minOffset: number;
  offJitter: number;
  stepMin: number;
  stepMax: number;
  holdMin?: number;
  holdMax?: number;
  firstGapMin?: number;
  firstGapMax?: number;
  firstCount?: number;
  firstStepMin?: number;
  firstStepMax?: number;
  calmGapMin?: number;
  calmGapMax?: number;
};

/**
 * Room A/B/C first minute, then Endless stays in that vocabulary.
 * Beat: scoring-lip *spacing* snaps to the metronome; movers stay off-grid.
 */
function generateAnalogCourse(seed: number, opts: CourseOptions, beat: boolean): CourseSpec {
  const rng = new Rng(seed);
  const keyframes: WallKeyframe[] = [];
  const obstacles: ObstacleSpec[] = [];
  let nextIdNum = 1;
  const nextId = () => nextIdNum++;
  let y = -KEYFRAME_PAD;
  let center = CX;
  /** Weave side for scoring gates. Chosen once at openEnd, then flips every scoring gate. */
  let side: -1 | 1 = 1;
  let lastLipY = 0;

  const pushRest = (gapMin: number, gapMax: number, wander: number, dy: number) => {
    y += dy;
    const placed = placeRest(rng, y, gapMin, gapMax, wander, center);
    center = placed.center;
    keyframes.push(placed.kf);
  };

  const pushHold = (dy: number) => {
    if (dy <= 0) return;
    y += dy;
    const last = keyframes[keyframes.length - 1]!;
    keyframes.push({ y, left: last.left, right: last.right, gateId: null });
  };

  const pushGate = (
    gapMin: number,
    gapMax: number,
    minOffset: number,
    offJitter: number,
    dy: number,
  ) => {
    if (beat) {
      y = quantizeLipY(y + dy, lastLipY);
      lastLipY = y;
    } else {
      y += dy;
    }
    const placed = placeScoringGate(rng, y, gapMin, gapMax, minOffset, offJitter, side, nextId);
    side = -side as -1 | 1;
    center = placed.center;
    keyframes.push(placed.kf);
    obstacles.push(placed.spec);
  };

  const plannedGateY = (dy: number) => (beat ? quantizeLipY(y + dy, lastLipY) : y + dy);

  const fillLipRoom = (until: number, room: LipRoom) => {
    let placed = 0;
    while (y < until) {
      const first = room.firstCount !== undefined && placed < room.firstCount;
      const afterTeach =
        room.firstCount !== undefined &&
        placed === room.firstCount &&
        room.calmGapMin !== undefined;
      // Opening teach may sit close after openEnd. Later A segments still have a
      // previous scoring lip, so they keep #19's 0.6s floor.
      const step = afterTeach
        ? lipStep(rng, room.calmGapMin!, room.calmGapMax ?? room.calmGapMin!)
        : first && room.firstStepMin !== undefined && lastLipY <= 0
          ? rng.float(room.firstStepMin, room.firstStepMax ?? room.firstStepMin)
          : lipStep(rng, room.stepMin, room.stepMax);
      if (plannedGateY(step) >= until) break;
      const gapMin = first ? (room.firstGapMin ?? room.gapMin) : room.gapMin;
      const gapMax = first ? (room.firstGapMax ?? room.gapMax) : room.gapMax;
      pushGate(gapMin, gapMax, room.minOffset, room.offJitter, step);
      placed += 1;
      // Hold only after the teach + first post-calm lip so Daily/Beat still
      // fit ≥3 Room A gates under the ≥250 calm gap.
      const allowHold = room.firstCount === undefined || placed > room.firstCount + 1;
      if (allowHold && room.holdMin !== undefined && room.holdMax !== undefined) {
        const hold = rng.float(room.holdMin, room.holdMax);
        if (y + hold < until) pushHold(hold);
      }
    }
  };

  const fillMoverGauntlet = (until: number, count: number) => {
    const moverYs = planGauntletYs(rng, y, until, count);
    let moverIdx = 0;
    while (y < until) {
      const step = lipStep(rng, ROOM_C.stepMin, ROOM_C.stepMax);
      const nextY = plannedGateY(step);
      const nextMoverY = moverYs[moverIdx];
      if (nextMoverY !== undefined && nextY >= nextMoverY) {
        y = nextMoverY;
        center = insertMover(rng, y, side, nextId, obstacles, keyframes, center);
        moverIdx += 1;
        continue;
      }
      if (nextY >= until) break;
      pushGate(ROOM_C.gapMin, ROOM_C.gapMax, ROOM_C.minOffset, ROOM_C.offJitter, step);
    }
    while (moverIdx < moverYs.length) {
      obstacles.push(placeMover(rng, moverYs[moverIdx]!, side, nextId));
      moverIdx += 1;
    }
    if (y < until) {
      pushRest(188, 220, 16, until - y);
    }
  };

  // Soft open: wide rest, not scoring. Room A scoring starts after this.
  keyframes.push({
    y: -KEYFRAME_PAD,
    left: 40,
    right: FIELD_W - 40,
    gateId: null,
  });
  while (y < DIST.openEnd) {
    const dy = rng.float(70, 90);
    pushRest(260, 300, 16, Math.min(dy, DIST.openEnd - y));
  }
  side = rng.pick([-1, 1] as const);

  // Room A 0–15s: wide pinch teach — CX is dead; weave to skim.
  fillLipRoom(DIST.roomAEnd, ROOM_A);
  if (y < DIST.roomAEnd) {
    pushRest(ROOM_A.gapMin, ROOM_A.gapMax, 12, DIST.roomAEnd - y);
  }

  // Room B 15–40s: tighter L/R weave corridor. No movers.
  fillLipRoom(DIST.roomBEnd, ROOM_B);
  if (y < DIST.roomBEnd) {
    pushRest(ROOM_B.gapMin + 20, ROOM_B.gapMax + 30, 12, DIST.roomBEnd - y);
  }

  // Room C 40–60s: readable mover gauntlet (3+). Telegraph ≥0.6s.
  fillMoverGauntlet(DIST.roomCEnd, ROOM_C.count);

  let finishY: number | null = null;
  if (opts.daily) {
    pushRest(210, 240, 12, 90);
    finishY = DIST.dailyFinish;
    keyframes.push({
      y: finishY + KEYFRAME_PAD,
      left: 48,
      right: FIELD_W - 48,
      gateId: null,
    });
  } else {
    const horizon = opts.endlessHorizon ?? DIST.roomCEnd + 24000;
    let segment = 0;
    while (y < horizon) {
      segment += 1;
      const knob = (segment - 1) % 3;
      const end = Math.min(y + 960, horizon);
      if (knob === 0) {
        // Later A is v2 weave only — opening teach/calm knobs stay on the first minute.
        fillLipRoom(end, {
          gapMin: ROOM_A.gapMin,
          gapMax: ROOM_A.gapMax,
          minOffset: ROOM_A.minOffset,
          offJitter: ROOM_A.offJitter,
          stepMin: ROOM_A.stepMin,
          stepMax: ROOM_A.stepMax,
          holdMin: ROOM_A.holdMin,
          holdMax: ROOM_A.holdMax,
        });
        if (y < end) pushRest(ROOM_A.gapMin, ROOM_A.gapMax, 12, end - y);
      } else if (knob === 1) {
        fillLipRoom(end, ROOM_B);
        if (y < end) pushRest(ROOM_B.gapMin + 16, ROOM_B.gapMax + 24, 12, end - y);
      } else {
        fillMoverGauntlet(end, 3);
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

function placeLaneLip(
  y: number,
  blocked: number[],
  nextId: () => number,
  kind: ObstacleSpec["kind"],
): ObstacleSpec {
  const gap = gapFromBlockedLanes(blocked);
  return {
    id: nextId(),
    kind,
    y,
    left: gap.left,
    right: gap.right,
    thickness: kind === "mover" ? 14 : GATE_LIP_THICKNESS,
    baseCenter: gap.center,
    gapWidth: gap.gap,
    amplitude: 0,
    period: 1,
    phase: 0,
  };
}

/**
 * Three-lane filament. Lips occupy 1–2 lanes; ≥1 lane stays open.
 * Agency is alternating blocked side, not analog CX offset.
 */
function generateLanesCourse(seed: number, opts: CourseOptions): CourseSpec {
  const rng = new Rng(seed);
  const keyframes: WallKeyframe[] = [];
  const obstacles: ObstacleSpec[] = [];
  let nextIdNum = 1;
  const nextId = () => nextIdNum++;
  let y = -KEYFRAME_PAD;
  let side: -1 | 1 = 1;

  const wide = (at: number, gateId: number | null = null): WallKeyframe => ({
    y: at,
    left: 8,
    right: FIELD_W - 8,
    gateId,
  });

  const pushLip = (dy: number, twoLane: boolean, kind: ObstacleSpec["kind"] = "gate") => {
    y += dy;
    const blocked = blockPattern(side, twoLane);
    if (kind === "gate") side = -side as -1 | 1;
    const spec = placeLaneLip(y, blocked, nextId, kind);
    keyframes.push(wide(y, spec.kind === "gate" ? spec.id : null));
    obstacles.push(spec);
  };

  keyframes.push(wide(-KEYFRAME_PAD));
  while (y < DIST.openEnd) {
    y += Math.min(rng.float(70, 90), DIST.openEnd - y);
    keyframes.push(wide(y));
  }
  side = rng.pick([-1, 1] as const);

  // Room A: 1-lane blocks (wide pocket). Room B: 2-lane weave (center dies).
  while (y < DIST.roomAEnd) {
    const step = rng.float(118, 148);
    if (y + step >= DIST.roomAEnd) break;
    pushLip(step, false);
  }

  while (y < DIST.roomBEnd) {
    const step = rng.float(120, 150);
    if (y + step >= DIST.roomBEnd) break;
    pushLip(step, true);
  }
  if (y < DIST.roomBEnd) {
    y = DIST.roomBEnd;
    keyframes.push(wide(y));
  }

  // Room C: 3+ lane movers, same time band as analog gauntlet.
  const moverYs: number[] = [];
  let moverY = DIST.roomBEnd + rng.float(ROOM_C.firstMin, ROOM_C.firstMax);
  for (let i = 0; i < 3; i++) {
    if (i > 0) moverY += rng.float(ROOM_C.spacingMin, ROOM_C.spacingMax);
    if (moverY <= DIST.roomCEnd - ROOM_C.tailPad) moverYs.push(moverY);
  }
  let moverIdx = 0;
  while (y < DIST.roomCEnd) {
    const step = rng.float(96, 120);
    const nextMoverY = moverYs[moverIdx];
    if (nextMoverY !== undefined && y + step >= nextMoverY) {
      y = nextMoverY;
      const spec = placeLaneLip(y, blockPattern(side, false), nextId, "mover");
      obstacles.push(spec);
      keyframes.push(wide(y));
      moverIdx += 1;
      continue;
    }
    if (y + step >= DIST.roomCEnd) break;
    pushLip(step, true);
  }
  while (moverIdx < moverYs.length) {
    const spec = placeLaneLip(moverYs[moverIdx]!, blockPattern(side, false), nextId, "mover");
    obstacles.push(spec);
    moverIdx += 1;
  }
  if (y < DIST.roomCEnd) {
    y = DIST.roomCEnd;
    keyframes.push(wide(y));
  }

  let finishY: number | null = null;
  if (opts.daily) {
    y += 90;
    keyframes.push(wide(y));
    finishY = DIST.dailyFinish;
    keyframes.push(wide(finishY + KEYFRAME_PAD));
  } else {
    const horizon = opts.endlessHorizon ?? DIST.roomCEnd + 24000;
    let segment = 0;
    while (y < horizon) {
      segment += 1;
      const knob = (segment - 1) % 3;
      const spacing = knob === 0 ? rng.float(118, 148) : rng.float(96, 124);
      const end = Math.min(y + 960, horizon);
      if (knob === 2) {
        let placed = 0;
        let lastMover = y - 200;
        while (y < end) {
          if (placed < 3 && y - lastMover > rng.float(ROOM_C.spacingMin, ROOM_C.spacingMax)) {
            y += rng.float(40, 80);
            if (y >= end) break;
            const spec = placeLaneLip(y, blockPattern(side, false), nextId, "mover");
            obstacles.push(spec);
            keyframes.push(wide(y));
            lastMover = y;
            placed += 1;
            continue;
          }
          if (y + spacing >= end) break;
          pushLip(spacing, true);
        }
      } else {
        while (y < end) {
          if (y + spacing >= end) break;
          pushLip(spacing, knob === 1);
        }
      }
    }
    keyframes.push(wide(y + KEYFRAME_PAD));
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

export type SlabBar = { x: number; y: number; w: number; h: number };

/** Horizontal lip/bar pair spanning the playfield with a gap — movers and static gates. */
export function slabPair(
  y: number,
  thickness: number,
  gap: { left: number; right: number },
): { left: SlabBar; right: SlabBar } {
  const h = thickness;
  const top = y - h / 2;
  return {
    left: { x: 0, y: top, w: Math.max(0, gap.left), h },
    right: { x: gap.right, y: top, w: Math.max(0, FIELD_W - gap.right), h },
  };
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
