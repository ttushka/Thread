export const FIELD_W = 360;
export const FIELD_H = 640;
/** Playfield centerline. Scoring gates after openEnd must sit off this line. */
export const CX = FIELD_W / 2;

/** Thread head screen Y in playfield pixels (from top). */
export const THREAD_SCREEN_Y = 470;

export const THREAD_RADIUS = 5;
export const NICK_BAND = 8;
/** Inside the safe gap, adjacent to nick — ~10–14px from the graze edge. */
export const NEAR_MISS_BAND = 12;

export const BASE_SPEED = 90;
export const NICK_SLOW = 0.42;
export const NICK_MS = 300;
export const DEATH_FREEZE_MS = 200;
export const DEATH_FLASH_MS = 100;
export const DEATH_DISSOLVE_MS = 260;
/** Held long enough that a skim score tick is unmissable. */
export const NEAR_MISS_MS = 180;
export const TENSION_CAP = 3;
export const TENSION_HOLD_MS = 1200;
export const TENSION_GAIN_LOCK_MS = 200;
/** Gray HUD "through" flash. Not combo food — no thread score juice. */
export const THROUGH_FLASH_MS = 160;
/** Legacy name: center-clean no longer flashes the thread like a score tick. */
export const CLEAN_PASS_FLASH_MS = THROUGH_FLASH_MS;
/** Fairness #19 / feel-sanity: no lip closer than this in time. */
export const LIP_TELEGRAPH_MIN_S = 0.6;
/** Static scoring-gate lips. Same slab family as movers, thinner, not animated. */
export const GATE_LIP_THICKNESS = 12;
export const STEER_SPEED = 280;
export const POINTER_LERP = 11;
/** KEYBOARD-STEER-FINE-v1: analog ramp on A/D (units of steerSmooth per second). */
export const STEER_KEY_ACCEL = 3.2;
export const STEER_KEY_DECEL = 6.0;
/** First 80ms of a new press cannot exceed this |steerSmooth|. */
export const STEER_KEY_TAP_MS = 80;
export const STEER_KEY_TAP_CAP = 0.35;

export const WALL_MARGIN = 14;
export const KEYFRAME_PAD = 80;

/** First-minute distance marks at 90 u/s. */
export const DIST = {
  openEnd: 450,
  pinchEnd: 1800,
  moverEnd: 3600,
  rhythmEnd: 5400,
  dailyFinish: 5580,
} as const;

/**
 * CORE-LOOP-SKIM-NATIVE-v1 Slice A — first ~40s Endless/Daily (openEnd→moverEnd).
 * Density +1 notch vs prior 105–125 / 110–135. Offset +1 notch vs 52 / 58.
 * Steps stay ≥ LIP_TELEGRAPH_MIN_S at BASE_SPEED (no snap-shut).
 */
export const EARLY_PINCH = {
  gapMin: 118,
  gapMax: 142,
  minOffset: 58,
  offJitter: 14,
  stepMin: 90,
  stepMax: 110,
} as const;

export const EARLY_MOVER_BAND = {
  gapMin: 110,
  gapMax: 136,
  minOffset: 64,
  offJitter: 12,
  stepMin: 95,
  stepMax: 120,
} as const;

/**
 * CORE-LOOP-SKIM-NATIVE-v1 Slice C — movers as mid-spice, not lottery spikes.
 * Two placements in the 20–40s band (~2× vs the old single special). Spacing
 * stays well above LIP_TELEGRAPH_MIN_S so they season the weave, not stack.
 */
export const MOVER_BAND = {
  count: 2,
  /** First mover offset from pinchEnd (same window as the old single special). */
  firstMin: 280,
  firstMax: 520,
  /** Gap from first mover to second (~8–11s at BASE_SPEED). */
  spacingMin: 720,
  spacingMax: 980,
  /** Keep the last mover inside moverEnd with rest room. */
  tailPad: 160,
} as const;

/**
 * Readable-mid motion. Lower amplitude / longer period than the old 56–72 /
 * 2.5–3.2 so a player can react without Brake. Retry may raise amplitude to
 * `amplitudeRetryCap` to keep a telegraphed center-punish; never snap-shut.
 */
export const MOVER_MOTION = {
  gapMin: 100,
  gapMax: 120,
  amplitudeMin: 48,
  amplitudeMax: 64,
  amplitudeRetryCap: 72,
  periodMin: 2.8,
  periodMax: 3.4,
} as const;

export const VIEW_AHEAD = THREAD_SCREEN_Y;
export const VIEW_BEHIND = FIELD_H - THREAD_SCREEN_Y;

export const TRAIL_MAX = 96;
export const DPR_CAP = 2;
export const TICK = 1 / 60;
export const MAX_FRAME_DT = 0.05;
export const MAX_STEPS = 3;
