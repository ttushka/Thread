import type { Intent } from "../types.ts";
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
};

/** Overlay backdrop / panel taps retry; action buttons keep their own handlers. */
export function isOverlayRetryTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return true;
  return !(target as Element).closest("button");
}

export function createInput(opts: InputOptions): {
  poll: () => Intent;
  destroy: () => void;
} {
  const keys = new Set<string>();
  let pointerActive = false;
  let pointerX = FIELD_W / 2;
  let restartQueued = false;
  let titleQueued = false;
  let pointerRestartArmed = false;

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
    keys.add(k);
    if (k === "Enter" || k === "r" || k === "R" || k === " ") {
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
    if (e.target instanceof Element && e.target.closest("button")) return;
    opts.canvas.setPointerCapture(e.pointerId);
    pointerActive = true;
    pointerX = clientToField(e.clientX);
    pointerRestartArmed = Boolean(opts.canQueueRestart?.());
    opts.onFocus?.();
    e.preventDefault();
  };
  const pointerMove = (e: PointerEvent) => {
    if (!pointerActive) return;
    pointerX = clientToField(e.clientX);
    e.preventDefault();
  };
  const pointerUp = (e: PointerEvent) => {
    const shouldRestart = pointerRestartArmed && Boolean(opts.canQueueRestart?.());
    pointerRestartArmed = false;
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
    const intent: Intent = {
      steer,
      pointerActive,
      pointerX,
      restart: restartQueued,
      toTitle: titleQueued,
    };
    restartQueued = false;
    titleQueued = false;
    return intent;
  };

  const destroy = () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    opts.canvas.removeEventListener("pointerdown", pointerDown);
    opts.canvas.removeEventListener("pointermove", pointerMove);
    window.removeEventListener("pointerup", pointerUp);
    window.removeEventListener("pointercancel", pointerUp);
  };

  return { poll, destroy };
}
