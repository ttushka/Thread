import { describe, expect, it } from "vitest";
import {
  BRAKE_BTN_SIZE,
  BRAKE_CLAMP_MARGIN_PX,
  BRAKE_DRAG_THRESHOLD_PX,
  BRAKE_LONG_PRESS_MS,
  clampBrakePos,
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
  it("locks drag threshold, clamp, and long-press reset", () => {
    expect(BRAKE_DRAG_THRESHOLD_PX).toBe(8);
    expect(BRAKE_CLAMP_MARGIN_PX).toBe(12);
    expect(BRAKE_LONG_PRESS_MS).toBe(1000);
    expect(BRAKE_BTN_SIZE).toBe(72);
    expect(pastDragThreshold(7, 0)).toBe(false);
    expect(pastDragThreshold(8, 0)).toBe(true);
    expect(pastDragThreshold(0, 8)).toBe(true);
    expect(pastDragThreshold(6, 6)).toBe(true);
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
