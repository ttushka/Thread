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
export const NEAR_MISS_MS = 140;
export const TENSION_CAP = 3;
export const TENSION_HOLD_MS = 1200;
export const TENSION_GAIN_LOCK_MS = 200;
/** Clean Pass thread accent. Same family as near-miss; brief 80–120ms. */
export const CLEAN_PASS_FLASH_MS = 120;
/** Static scoring-gate lips. Same slab family as movers, thinner, not animated. */
export const GATE_LIP_THICKNESS = 12;
export const STEER_SPEED = 280;
/** Keyboard steer: approach key intent at this rate (units of steerSmooth / s). ~0–100% in 0.31s. */
export const STEER_KEY_ACCEL = 3.2;
/** Keyboard steer: approach 0 on release. Snappier than start (~0.17s from full). */
export const STEER_KEY_DECEL = 6.0;
/** New-press window where |steerSmooth| is capped so a tap stays a nudge. */
export const STEER_TAP_BIAS_MS = 80;
export const STEER_TAP_BIAS_CAP = 0.35;
export const POINTER_LERP = 11;

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

export const VIEW_AHEAD = THREAD_SCREEN_Y;
export const VIEW_BEHIND = FIELD_H - THREAD_SCREEN_Y;

export const TRAIL_MAX = 96;
export const DPR_CAP = 2;
export const TICK = 1 / 60;
export const MAX_FRAME_DT = 0.05;
export const MAX_STEPS = 3;
