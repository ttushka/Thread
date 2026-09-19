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
/**
 * ART-SKIM-TICK-JUICE-BUMP-v1 — award-tick juice only (not wall-graze-with-0).
 * Filament `--thread` rim at full opacity. Window 140–180ms.
 */
export const SCORE_TICK_FILAMENT_MS = 160;
/** Local lip/wall edge → `--pinch-lip-edge` `#B8C0CC`. Window 100–140ms. No teal on walls. */
export const SCORE_TICK_EDGE_MS = 120;
/** HUD score punch: ink→thread + slight scale. Arm's-length readable. */
export const SCORE_TICK_HUD_MS = 120;
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

/**
 * First-minute distance marks at 90 u/s.
 * Room A 0–15s, Room B 15–40s, Room C 40–60s (BIG-FEEL-REDESIGN PR2).
 * `rhythmEnd` aliases Room C so first-minute tests keep a 60s name.
 */
export const DIST = {
  /** Soft-friends Room A fix: 5.0s safe open (was 4.0s / 360). */
  openEnd: 450,
  roomAEnd: 1350,
  roomBEnd: 3600,
  roomCEnd: 5400,
  rhythmEnd: 5400,
  dailyFinish: 5580,
} as const;

export type CourseRoom = "open" | "A" | "B" | "C" | "endless";

export function roomAt(y: number): CourseRoom {
  if (y < DIST.openEnd) return "open";
  if (y < DIST.roomAEnd) return "A";
  if (y < DIST.roomBEnd) return "B";
  if (y < DIST.roomCEnd) return "C";
  return "endless";
}

/**
 * Room A — Pinch teach (0–15s). Wide corridor, scoring lips offset so CX is
 * dead (center scores nothing / nicks). Soft-friends weave into the pocket;
 * holding center still dies.
 * First-cluster gaps sit at the CX-kill ceiling (~170) so a small weave+Brake
 * can clear the opening pinch. Later Room A stays the same silhouette, just
 * shy of that ceiling. Wall-margin still allows a CX-kill offset.
 */
export const ROOM_A = {
  gapMin: 150,
  gapMax: 166,
  /** First lips after the open — wide enough for weave+Brake, still CX-dead. */
  firstGapMin: 164,
  firstGapMax: 170,
  firstCount: 3,
  minOffset: 80,
  offJitter: 8,
  stepMin: 104,
  stepMax: 128,
  holdMin: 36,
  holdMax: 52,
} as const;

/**
 * Room B — Weave corridor (15–40s). Alternating L/R, tighter so the center
 * line nicks or scores nothing. Agency weave, not a sine farm.
 */
export const ROOM_B = {
  gapMin: 94,
  gapMax: 112,
  minOffset: 68,
  offJitter: 10,
  stepMin: 92,
  stepMax: 110,
  holdMin: 28,
  holdMax: 44,
} as const;

/**
 * Room C — Mover gauntlet (40–60s+). Cluster of 4 readable movers.
 * Spacing stays well above LIP_TELEGRAPH_MIN_S; mid difficulty; Brake assist OK.
 */
export const ROOM_C = {
  count: 4,
  firstMin: 160,
  firstMax: 260,
  spacingMin: 240,
  spacingMax: 340,
  tailPad: 140,
  gapMin: 102,
  gapMax: 122,
  minOffset: 64,
  offJitter: 10,
  stepMin: 100,
  stepMax: 122,
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
