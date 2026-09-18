import { describe, expect, it } from "vitest";
import {
  BRAKE_BTN_SIZE,
  BRAKE_CLAMP_MARGIN_PX,
  BRAKE_DRAG_THRESHOLD_PX,
  BRAKE_LONG_PRESS_MS,
  BRAKE_RESET_DOUBLE_TAP_MS,
  brakeHudDoubleTapShouldReset,
  brakeHudDown,
  brakeHudMove,
  brakeHudTickShouldReset,
  brakeHudUp,
  clampBrakePos,
  createBrakeHudPointer,
  defaultBrakePos,
  pastDragThreshold,
  type ViewBox,
} from "../hud/brakePad.ts";

const view: ViewBox = {
  w: 390,
  h: 844,
  safe: { l: 0, r: 0, t: 0, b: 34 },
};

describe("BRAKE-DRAGGABLE-HUD-v1 park", () => {
  it("locks drag threshold, clamp, and park-reset window", () => {
    expect(BRAKE_DRAG_THRESHOLD_PX).toBe(8);
    expect(BRAKE_CLAMP_MARGIN_PX).toBe(12);
    expect(BRAKE_LONG_PRESS_MS).toBe(1000);
    expect(BRAKE_RESET_DOUBLE_TAP_MS).toBe(400);
    expect(BRAKE_BTN_SIZE).toBe(72);
    expect(pastDragThreshold(7, 0)).toBe(false);
    expect(pastDragThreshold(8, 0)).toBe(true);
    expect(pastDragThreshold(0, 8)).toBe(true);
    expect(pastDragThreshold(6, 6)).toBe(true);
  });

  it("does not reset park on a still hold longer than 1s (hold-to-brake)", () => {
    const origin = { x: 12, y: 700 };
    let hud = createBrakeHudPointer();
    hud = brakeHudDown(hud, 1, 40, 740, origin, 0);
    const twitch = brakeHudMove(hud, 1, 47, 740);
    expect(twitch.beganDrag).toBe(false);
    hud = twitch.hud;
    expect(brakeHudTickShouldReset(hud, BRAKE_LONG_PRESS_MS)).toBe(false);
    expect(brakeHudTickShouldReset(hud, 2500)).toBe(false);
    const up = brakeHudUp(hud, 1, 2500, origin);
    expect(up.resetPark).toBe(false);
    expect(up.persist).toBeNull();
    expect(up.hud.session).toBeNull();
  });

  it("does not reset park on the hold timer after the drag threshold", () => {
    const origin = { x: 12, y: 700 };
    let hud = createBrakeHudPointer();
    hud = brakeHudDown(hud, 1, 40, 740, origin, 0);
    const moved = brakeHudMove(hud, 1, 40 + BRAKE_DRAG_THRESHOLD_PX, 740);
    expect(moved.beganDrag).toBe(true);
    expect(moved.hud.session?.dragging).toBe(true);
    expect(brakeHudTickShouldReset(moved.hud, 1200)).toBe(false);
    expect(brakeHudTickShouldReset(moved.hud, 2500)).toBe(false);
    const parked = moved.live ?? origin;
    const up = brakeHudUp(moved.hud, 1, 2500, parked);
    expect(up.resetPark).toBe(false);
    expect(up.persist).toEqual(parked);
  });

  it("resets park on a still double-tap after release, not on a single long hold", () => {
    const origin = { x: 24, y: 640 };
    let hud = createBrakeHudPointer();
    hud = brakeHudDown(hud, 1, 40, 680, origin, 0);
    const first = brakeHudUp(hud, 1, 80, origin);
    expect(first.resetPark).toBe(false);
    hud = brakeHudDown(first.hud, 1, 40, 680, origin, 120);
    const second = brakeHudUp(hud, 1, 200, origin);
    expect(second.resetPark).toBe(true);
    hud = brakeHudDown(createBrakeHudPointer(), 1, 40, 680, origin, 0);
    const only = brakeHudUp(hud, 1, 80, origin);
    hud = brakeHudDown(only.hud, 1, 40, 680, origin, 80 + BRAKE_RESET_DOUBLE_TAP_MS + 1);
    const late = brakeHudUp(hud, 1, 80 + BRAKE_RESET_DOUBLE_TAP_MS + 50, origin);
    expect(late.resetPark).toBe(false);
    expect(brakeHudDoubleTapShouldReset(BRAKE_RESET_DOUBLE_TAP_MS)).toBe(true);
    expect(brakeHudDoubleTapShouldReset(BRAKE_RESET_DOUBLE_TAP_MS + 1)).toBe(false);
    expect(brakeHudDoubleTapShouldReset(null)).toBe(false);
  });

  it("defaults to bottom-left plus safe-area and 12px margin", () => {
    const pos = defaultBrakePos(view);
    expect(pos.x).toBe(BRAKE_CLAMP_MARGIN_PX + view.safe.l);
    expect(pos.y).toBe(view.h - BRAKE_BTN_SIZE - BRAKE_CLAMP_MARGIN_PX - view.safe.b);
    expect(pos.x).toBeLessThan(view.w / 2);
    expect(pos.y).toBeGreaterThan(view.h / 2);
  });

  it("clamps on-screen with a 12px + safe-area margin", () => {
    const pos = clampBrakePos({ x: -40, y: 9000 }, view);
    expect(pos.x).toBe(BRAKE_CLAMP_MARGIN_PX);
    expect(pos.y).toBe(view.h - BRAKE_BTN_SIZE - BRAKE_CLAMP_MARGIN_PX - view.safe.b);
    const right = clampBrakePos({ x: 2000, y: -20 }, view);
    expect(right.x).toBe(view.w - BRAKE_BTN_SIZE - BRAKE_CLAMP_MARGIN_PX - view.safe.r);
    expect(right.y).toBe(BRAKE_CLAMP_MARGIN_PX + view.safe.t);
  });

  it("shifts the default park off the Sound hit target", () => {
    const sound = { x: 8, y: view.h - 76, w: 88, h: 44 };
    const pos = defaultBrakePos(view, [sound]);
    const overlaps =
      pos.x < sound.x + sound.w &&
      pos.x + BRAKE_BTN_SIZE > sound.x &&
      pos.y < sound.y + sound.h &&
      pos.y + BRAKE_BTN_SIZE > sound.y;
    expect(overlaps).toBe(false);
    expect(pos.x).toBe(BRAKE_CLAMP_MARGIN_PX);
  });
});
