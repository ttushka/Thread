/** BRAKE-DRAGGABLE-HUD-v1 — floating Brake park (touch + mouse). */

export const BRAKE_BTN_SIZE = 72;
export const BRAKE_DRAG_THRESHOLD_PX = 8;
export const BRAKE_CLAMP_MARGIN_PX = 12;
/** Design feel: 1s long-press. Not used as an in-hold reset (that is hold-to-brake). */
export const BRAKE_LONG_PRESS_MS = 1000;
/** Two still pointer-ups within this window reset park. Hold/drag never do. */
export const BRAKE_RESET_DOUBLE_TAP_MS = 400;

export type Point = { x: number; y: number };
export type SafeInsets = { l: number; r: number; t: number; b: number };
export type ViewBox = { w: number; h: number; safe: SafeInsets };
export type Rect = { x: number; y: number; w: number; h: number };

export function pastDragThreshold(
  dx: number,
  dy: number,
  threshold = BRAKE_DRAG_THRESHOLD_PX,
): boolean {
  return dx * dx + dy * dy >= threshold * threshold;
}

/**
 * Park reset rule: still press = hold-to-brake for any duration; past the 8px
 * threshold = reposition. Neither snaps park while the pointer is down (the
 * old 1s in-hold timer collided with braking). Reset is a still double-tap
 * after release (two pointer-ups within BRAKE_RESET_DOUBLE_TAP_MS).
 */
export type BrakeHudPointer = {
  session: {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    origin: Point;
    dragging: boolean;
    downAt: number;
  } | null;
  lastStillUpAt: number;
};

export function createBrakeHudPointer(): BrakeHudPointer {
  return { session: null, lastStillUpAt: 0 };
}

export function brakeHudDown(
  hud: BrakeHudPointer,
  pointerId: number,
  clientX: number,
  clientY: number,
  origin: Point,
  nowMs: number,
): BrakeHudPointer {
  return {
    ...hud,
    session: {
      pointerId,
      startClientX: clientX,
      startClientY: clientY,
      origin,
      dragging: false,
      downAt: nowMs,
    },
  };
}

export function brakeHudMove(
  hud: BrakeHudPointer,
  pointerId: number,
  clientX: number,
  clientY: number,
): { hud: BrakeHudPointer; live: Point | null; beganDrag: boolean } {
  const s = hud.session;
  if (!s || s.pointerId !== pointerId) return { hud, live: null, beganDrag: false };
  const dx = clientX - s.startClientX;
  const dy = clientY - s.startClientY;
  if (!s.dragging && pastDragThreshold(dx, dy)) {
    return {
      hud: { session: { ...s, dragging: true }, lastStillUpAt: 0 },
      live: { x: s.origin.x + dx, y: s.origin.y + dy },
      beganDrag: true,
    };
  }
  if (!s.dragging) return { hud, live: null, beganDrag: false };
  return { hud, live: { x: s.origin.x + dx, y: s.origin.y + dy }, beganDrag: false };
}

export function brakeHudUp(
  hud: BrakeHudPointer,
  pointerId: number,
  nowMs: number,
  parked: Point,
): { hud: BrakeHudPointer; persist: Point | null; resetPark: boolean } {
  const s = hud.session;
  if (!s || s.pointerId !== pointerId) return { hud, persist: null, resetPark: false };
  if (s.dragging) {
    return { hud: { session: null, lastStillUpAt: 0 }, persist: parked, resetPark: false };
  }
  const gap = hud.lastStillUpAt > 0 ? nowMs - hud.lastStillUpAt : null;
  const resetPark = brakeHudDoubleTapShouldReset(gap);
  return {
    hud: { session: null, lastStillUpAt: resetPark ? 0 : nowMs },
    persist: null,
    resetPark,
  };
}

/** In-hold tick: never reset park (still = brake, dragging = in-progress drag). */
export function brakeHudTickShouldReset(hud: BrakeHudPointer, nowMs: number): boolean {
  const s = hud.session;
  if (!s) return false;
  if (s.dragging) return false;
  if (nowMs - s.downAt >= BRAKE_LONG_PRESS_MS) return false;
  return false;
}

/** True on the second still pointer-up of a double-tap. Null gap = no prior still tap. */
export function brakeHudDoubleTapShouldReset(stillUpGapMs: number | null): boolean {
  return stillUpGapMs !== null && stillUpGapMs >= 0 && stillUpGapMs <= BRAKE_RESET_DOUBLE_TAP_MS;
}

export function defaultBrakePos(view: ViewBox, avoid: Rect[] = []): Point {
  const x = BRAKE_CLAMP_MARGIN_PX + view.safe.l;
  const y = view.h - BRAKE_BTN_SIZE - BRAKE_CLAMP_MARGIN_PX - view.safe.b;
  return clampBrakePos({ x, y }, view, avoid);
}

export function clampBrakePos(pos: Point, view: ViewBox, avoid: Rect[] = []): Point {
  const minX = BRAKE_CLAMP_MARGIN_PX + view.safe.l;
  const maxX = view.w - BRAKE_BTN_SIZE - BRAKE_CLAMP_MARGIN_PX - view.safe.r;
  const minY = BRAKE_CLAMP_MARGIN_PX + view.safe.t;
  const maxY = view.h - BRAKE_BTN_SIZE - BRAKE_CLAMP_MARGIN_PX - view.safe.b;
  const clampX = (x: number) => Math.min(Math.max(x, minX), Math.max(minX, maxX));
  const clampY = (y: number) => Math.min(Math.max(y, minY), Math.max(minY, maxY));
  let x = clampX(pos.x);
  let y = clampY(pos.y);

  for (const r of avoid) {
    const btn = { x, y, w: BRAKE_BTN_SIZE, h: BRAKE_BTN_SIZE };
    if (!rectsOverlap(btn, r)) continue;
    y = clampY(r.y - BRAKE_BTN_SIZE - 8);
  }
  return { x, y };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function readSafeAreaInsets(doc: Document | null | undefined): SafeInsets {
  const empty = { l: 0, r: 0, t: 0, b: 0 };
  if (!doc?.body) return empty;
  const probe = doc.createElement("div");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;" +
    "padding-left:env(safe-area-inset-left,0px);" +
    "padding-right:env(safe-area-inset-right,0px);" +
    "padding-top:env(safe-area-inset-top,0px);" +
    "padding-bottom:env(safe-area-inset-bottom,0px);";
  doc.body.appendChild(probe);
  const s = doc.defaultView?.getComputedStyle(probe);
  const n = (v: string | undefined) => {
    const x = Number.parseFloat(v ?? "");
    return Number.isFinite(x) ? x : 0;
  };
  const insets = s
    ? { l: n(s.paddingLeft), r: n(s.paddingRight), t: n(s.paddingTop), b: n(s.paddingBottom) }
    : empty;
  probe.remove();
  return insets;
}

export function applyBrakeStyle(el: HTMLElement, pos: Point): void {
  el.style.left = `${Math.round(pos.x)}px`;
  el.style.top = `${Math.round(pos.y)}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
}
