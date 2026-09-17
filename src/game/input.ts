import type { Intent } from "../types.ts";
import type { ExperimentVariant } from "./variant.ts";
import { FIELD_W } from "./world/constants.ts";

export type PlayfieldMap = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

type InputOptions = {
  canvas: HTMLCanvasElement;
  getMap: () => PlayfieldMap;
  onFocus?: () => void;
  /** True while a result overlay (or death freeze) can accept tap-to-retry. */
  canQueueRestart?: () => boolean;
  variant?: () => ExperimentVariant;
  playing?: () => boolean;
};

/** Overlay backdrop / panel taps retry; action buttons keep their own handlers. */
export function isOverlayRetryTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return true;
  return !(target as Element).closest("button");
}

const SWIPE_MIN = 36;

export function createInput(opts: InputOptions): {
  poll: () => Intent;
  setBrakeHold: (held: boolean) => void;
  destroy: () => void;
} {
  const keys = new Set<string>();
  let pointerActive = false;
  let pointerX = FIELD_W / 2;
  let restartQueued = false;
  let titleQueued = false;
  let pointerRestartArmed = false;
  let brakeHold = false;
  let laneQueued = 0;
  let ptrStartX = FIELD_W / 2;
  let lastPointerAt = -1e9;
  let pointerId: number | null = null;

  const variant = () => opts.variant?.() ?? "control";
  const playing = () => Boolean(opts.playing?.());

  const down = (e: KeyboardEvent) => {
    const k = e.key;
    if (
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === " " ||
      k === "ArrowUp" ||
      k === "ArrowDown"
    ) {
      e.preventDefault();
    }
    if (e.repeat) {
      keys.add(k);
      return;
    }
    keys.add(k);
    if (variant() === "lanes" && playing()) {
      if (k === "ArrowLeft" || k === "a" || k === "A") laneQueued = -1;
      if (k === "ArrowRight" || k === "d" || k === "D") laneQueued = 1;
    }
    const brakePlaying = variant() === "brake" && playing() && k === " ";
    if (!brakePlaying && (k === "Enter" || k === "r" || k === "R" || k === " ")) {
      restartQueued = true;
    }
    if (k === "Escape") titleQueued = true;
  };
  const up = (e: KeyboardEvent) => {
    keys.delete(e.key);
  };

  const clientToField = (clientX: number) => {
    const rect = opts.canvas.getBoundingClientRect();
    const map = opts.getMap();
    const x = (clientX - rect.left - map.offsetX) / map.scale;
    return x;
  };

  const pointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (pointerId !== null) return;
    if (e.target instanceof Element && e.target.closest("button")) return;
    opts.canvas.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    pointerActive = true;
    pointerX = clientToField(e.clientX);
    ptrStartX = pointerX;
    lastPointerAt = performance.now();
    pointerRestartArmed = Boolean(opts.canQueueRestart?.());
    opts.onFocus?.();
    e.preventDefault();
  };
  const pointerMove = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return;
    if (!pointerActive) return;
    pointerX = clientToField(e.clientX);
    lastPointerAt = performance.now();
    e.preventDefault();
  };
  const pointerUp = (e: PointerEvent) => {
    if (pointerId !== null && e.pointerId !== pointerId) return;
    const shouldRestart = pointerRestartArmed && Boolean(opts.canQueueRestart?.());
    pointerRestartArmed = false;
    if (variant() === "lanes" && playing() && pointerActive) {
      const dx = pointerX - ptrStartX;
      if (Math.abs(dx) >= SWIPE_MIN) {
        laneQueued = dx > 0 ? 1 : -1;
      } else if (ptrStartX < FIELD_W / 3) {
        laneQueued = -1;
      } else if (ptrStartX > (2 * FIELD_W) / 3) {
        laneQueued = 1;
      }
    }
    pointerId = null;
    if (pointerActive) {
      pointerActive = false;
      try {
        opts.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
    if (shouldRestart) restartQueued = true;
  };

  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  opts.canvas.addEventListener("pointerdown", pointerDown);
  opts.canvas.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp);
  window.addEventListener("pointercancel", pointerUp);

  const poll = (): Intent => {
    let steer = 0;
    if (keys.has("a") || keys.has("A") || keys.has("ArrowLeft")) steer -= 1;
    if (keys.has("d") || keys.has("D") || keys.has("ArrowRight")) steer += 1;
    const touchScoring = pointerActive || performance.now() - lastPointerAt < 280;
    const brake =
      variant() === "brake" && playing() && (brakeHold || keys.has(" ") || keys.has("Spacebar"));
    const analogPointer = pointerActive && variant() !== "lanes";
    const intent: Intent = {
      steer: variant() === "lanes" ? 0 : steer,
      pointerActive: analogPointer,
      pointerX,
      restart: restartQueued,
      toTitle: titleQueued,
      brake,
      laneDelta: laneQueued,
      touchScoring,
    };
    restartQueued = false;
    titleQueued = false;
    laneQueued = 0;
    return intent;
  };

  const setBrakeHold = (held: boolean) => {
    brakeHold = held;
  };

  const destroy = () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    opts.canvas.removeEventListener("pointerdown", pointerDown);
    opts.canvas.removeEventListener("pointermove", pointerMove);
    window.removeEventListener("pointerup", pointerUp);
    window.removeEventListener("pointercancel", pointerUp);
  };

  return { poll, setBrakeHold, destroy };
}
