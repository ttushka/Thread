import { DPR_CAP, FIELD_H, FIELD_W } from "../world/constants.ts";
import type { PlayfieldMap } from "../input.ts";

export type CanvasHandle = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  map: PlayfieldMap;
  cssW: number;
  cssH: number;
  resize: () => void;
};

export function mountCanvas(canvas: HTMLCanvasElement): CanvasHandle {
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) throw new Error("Canvas 2D is required");

  const handle: CanvasHandle = {
    canvas,
    ctx,
    map: { offsetX: 0, offsetY: 0, scale: 1 },
    cssW: 1,
    cssH: 1,
    resize: () => {
      const parent = canvas.parentElement ?? document.body;
      const cssW = Math.max(1, parent.clientWidth);
      const cssH = Math.max(1, parent.clientHeight);
      const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scale = Math.min(cssW / FIELD_W, cssH / FIELD_H);
      const drawW = FIELD_W * scale;
      const drawH = FIELD_H * scale;
      handle.cssW = cssW;
      handle.cssH = cssH;
      handle.map = {
        scale,
        offsetX: (cssW - drawW) / 2,
        offsetY: (cssH - drawH) / 2,
      };
    },
  };

  handle.resize();
  return handle;
}

export function withPlayfield(ctx: CanvasRenderingContext2D, map: PlayfieldMap, draw: () => void): void {
  ctx.save();
  ctx.translate(map.offsetX, map.offsetY);
  ctx.scale(map.scale, map.scale);
  ctx.beginPath();
  ctx.rect(0, 0, FIELD_W, FIELD_H);
  ctx.clip();
  draw();
  ctx.restore();
}
