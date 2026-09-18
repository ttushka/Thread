import { Game } from "./game/Game.ts";
import { createAudioBed } from "./game/audio.ts";
import { createInput, isOverlayRetryTarget } from "./game/input.ts";
import { createLoop } from "./game/loop.ts";
import { mountCanvas } from "./game/render/canvas.ts";
import { drawFrame } from "./game/render/draw.ts";
import { parseDeepLink } from "./game/share.ts";
import { utcDateKey } from "./game/seed.ts";
import { playBeatClick } from "./game/beatClick.ts";
import {
  parseVariant,
  variantSearchParam,
  type ExperimentVariant,
  PICKER_VARIANT_KEYS,
  VARIANT_TEACH,
} from "./game/variant.ts";
import {
  applyBrakeStyle,
  BRAKE_DRAG_THRESHOLD_PX,
  BRAKE_LONG_PRESS_MS,
  clampBrakePos,
  defaultBrakePos,
  pastDragThreshold,
  readSafeAreaInsets,
  type Point,
  type Rect,
  type ViewBox,
} from "./game/hud/brakePad.ts";

const app = document.querySelector<HTMLDivElement>("#app");
const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!app || !canvas) throw new Error("Missing #app or #game");

const titleEl = must("#title");
const resultEl = must("#result");
const hudEl = must("#hud");
const hudMode = must("#hud-mode");
const hudScore = must("#hud-score");
const hudCombo = must("#hud-combo");
const hudBest = must("#hud-best");
const hudVariant = must("#hud-variant");
const hudTeach = must("#hud-teach");
const hudSlow = must("#hud-slow");
const titleEndlessBest = must("#title-endless-best");
const titleDailyMeta = must("#title-daily-meta");
const titleVariantBadge = must("#title-variant-badge");
const experimentTeach = must("#experiment-teach");
const resultKicker = must("#result-kicker");
const resultHeading = must("#result-heading");
const resultSub = must("#result-sub");
const resultShare = must("#result-share");
const btnEndless = must<HTMLButtonElement>("#btn-endless");
const btnDaily = must<HTMLButtonElement>("#btn-daily");
const btnRetry = must<HTMLButtonElement>("#btn-retry");
const btnShare = must<HTMLButtonElement>("#btn-share");
const btnMenu = must<HTMLButtonElement>("#btn-menu");
const btnMotion = must<HTMLButtonElement>("#btn-motion");
const btnSound = must<HTMLButtonElement>("#btn-sound");
const btnHudSound = must<HTMLButtonElement>("#btn-hud-sound");
const btnBeatMute = must<HTMLButtonElement>("#btn-beat-mute");
const btnBrake = must<HTMLButtonElement>("#btn-brake");

const view = mountCanvas(canvas);
const game = new Game(window.localStorage);
game.prefersReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
{
  const url = new URL(window.location.href);
  if (url.searchParams.get("variant") === "lanes") {
    url.searchParams.delete("variant");
    window.history.replaceState(null, "", url);
  }
  game.setVariant(parseVariant(window.location.search));
}
experimentTeach.textContent = VARIANT_TEACH[game.variant];

const audio = createAudioBed();
audio.setMuted(Boolean(game.save.settings?.muted));

const unlockAudio = () => audio.unlock();
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

const input = createInput({
  canvas,
  getMap: () => view.map,
  canQueueRestart: () => game.screen === "dead" || game.screen === "cleared",
  variant: () => game.variant,
  playing: () => game.screen === "play",
});

let overlayRetryArmed = false;
resultEl.addEventListener("pointerdown", (e) => {
  overlayRetryArmed = isOverlayRetryTarget(e.target);
});
resultEl.addEventListener("pointerup", (e) => {
  if (!overlayRetryArmed) return;
  overlayRetryArmed = false;
  if (!isOverlayRetryTarget(e.target)) return;
  if (game.screen !== "dead" && game.screen !== "cleared") return;
  game.restart();
});
resultEl.addEventListener("pointercancel", () => {
  overlayRetryArmed = false;
});

btnEndless.addEventListener("click", () => {
  audio.unlock();
  game.startEndless();
  audio.enterRun();
});
btnDaily.addEventListener("click", () => {
  audio.unlock();
  game.startDaily();
  audio.enterRun();
});
btnRetry.addEventListener("click", () => {
  audio.unlock();
  game.restart();
  audio.enterRun();
});
btnMenu.addEventListener("click", () => {
  game.toTitle();
  audio.leaveRun();
});
btnMotion.addEventListener("click", () => {
  game.toggleReducedMotion();
  paintChrome(true);
});
btnSound.addEventListener("click", () => {
  game.toggleMuted();
  audio.setMuted(game.snapshot().muted);
  paintChrome(true);
});
btnHudSound.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
});
btnHudSound.addEventListener("click", (e) => {
  e.stopPropagation();
  game.toggleMuted();
  audio.setMuted(game.snapshot().muted);
  paintChrome(true);
});
btnBeatMute.addEventListener("click", () => {
  game.toggleBeatMute();
  paintChrome(true);
});
btnShare.addEventListener("click", async () => {
  const line = game.snapshot().shareLine;
  if (!line) return;
  try {
    await navigator.clipboard.writeText(line);
    btnShare.textContent = "Copied";
    window.setTimeout(() => {
      btnShare.textContent = "Copy challenge";
    }, 1400);
  } catch {
    window.prompt("Copy challenge", line);
  }
});

for (const chip of document.querySelectorAll<HTMLButtonElement>("[data-variant]")) {
  chip.addEventListener("click", () => {
    const key = chip.dataset.variant;
    if (key !== "control" && key !== "brake" && key !== "beat") return;
    applyVariant(key);
  });
}

function applyVariant(variant: ExperimentVariant): void {
  game.setVariant(variant);
  const url = new URL(window.location.href);
  const param = variantSearchParam(variant);
  if (param) url.searchParams.set("variant", param);
  else url.searchParams.delete("variant");
  window.history.replaceState(null, "", url);
  paintChrome(true);
}

type BrakeDrag = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  origin: Point;
  dragging: boolean;
};
let brakeDrag: BrakeDrag | null = null;
let brakeLongPress: number | null = null;

function brakeViewBox(): ViewBox {
  const r = app!.getBoundingClientRect();
  return { w: r.width, h: r.height, safe: readSafeAreaInsets(document) };
}

function brakeAvoid(): Rect[] {
  const origin = app!.getBoundingClientRect();
  const boxes: Rect[] = [];
  for (const el of [btnHudSound, hudScore, document.querySelector("#hud-mode")]) {
    if (!(el instanceof HTMLElement) || el.hidden) continue;
    const r = el.getBoundingClientRect();
    boxes.push({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
  }
  return boxes;
}

function layoutBrake(forceDefault = false): Point {
  const viewBox = brakeViewBox();
  const avoid = brakeAvoid();
  const saved = forceDefault ? null : game.brakeHudPos();
  const pos = clampBrakePos(saved ?? defaultBrakePos(viewBox, avoid), viewBox, avoid);
  applyBrakeStyle(btnBrake, pos);
  return pos;
}

function clearBrakeLongPress(): void {
  if (brakeLongPress !== null) {
    window.clearTimeout(brakeLongPress);
    brakeLongPress = null;
  }
}

function resetBrakePark(): void {
  layoutBrake(true);
  game.setBrakeHudPos(null);
}

const holdBrake = (e: PointerEvent) => {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  e.preventDefault();
  e.stopPropagation();
  btnBrake.setPointerCapture(e.pointerId);
  const origin = {
    x: Number.parseFloat(btnBrake.style.left) || layoutBrake().x,
    y: Number.parseFloat(btnBrake.style.top) || layoutBrake().y,
  };
  brakeDrag = {
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    origin,
    dragging: false,
  };
  input.setBrakeHold(true);
  btnBrake.classList.add("held");
  clearBrakeLongPress();
  brakeLongPress = window.setTimeout(() => {
    if (!brakeDrag || brakeDrag.dragging) return;
    resetBrakePark();
  }, BRAKE_LONG_PRESS_MS);
};
const moveBrake = (e: PointerEvent) => {
  if (!brakeDrag || e.pointerId !== brakeDrag.pointerId) return;
  e.preventDefault();
  e.stopPropagation();
  const dx = e.clientX - brakeDrag.startClientX;
  const dy = e.clientY - brakeDrag.startClientY;
  if (!brakeDrag.dragging && pastDragThreshold(dx, dy, BRAKE_DRAG_THRESHOLD_PX)) {
    brakeDrag.dragging = true;
    clearBrakeLongPress();
    input.setBrakeHold(false);
    btnBrake.classList.remove("held");
    btnBrake.classList.add("dragging");
  }
  if (!brakeDrag.dragging) return;
  const pos = clampBrakePos(
    { x: brakeDrag.origin.x + dx, y: brakeDrag.origin.y + dy },
    brakeViewBox(),
    brakeAvoid(),
  );
  applyBrakeStyle(btnBrake, pos);
};
const releaseBrake = (e: PointerEvent) => {
  if (brakeDrag && e.pointerId !== brakeDrag.pointerId) return;
  e.stopPropagation();
  if (brakeDrag?.dragging) {
    game.setBrakeHudPos({
      x: Number.parseFloat(btnBrake.style.left) || 0,
      y: Number.parseFloat(btnBrake.style.top) || 0,
    });
  }
  brakeDrag = null;
  clearBrakeLongPress();
  input.setBrakeHold(false);
  btnBrake.classList.remove("held", "dragging");
  try {
    btnBrake.releasePointerCapture(e.pointerId);
  } catch {
    /* already released */
  }
};

btnBrake.addEventListener("pointerdown", holdBrake);
btnBrake.addEventListener("pointermove", moveBrake);
btnBrake.addEventListener("pointerup", releaseBrake);
btnBrake.addEventListener("pointercancel", releaseBrake);
btnBrake.addEventListener("contextmenu", (e) => e.preventDefault());

const deep = parseDeepLink(window.location.search);
if (deep.mode === "daily") {
  game.startDaily(deep.dateKey);
} else if (deep.mode === "endless") {
  game.startEndless();
}

let lastHud = "";
function paintChrome(force = false): void {
  const snap = game.snapshot();
  const key = JSON.stringify(snap);
  if (!force && key === lastHud) return;
  lastHud = key;

  const onTitle = snap.screen === "title";
  const onResult = snap.screen === "dead" || snap.screen === "cleared";
  titleEl.classList.toggle("hidden", !onTitle);
  resultEl.classList.toggle("hidden", !onResult || !snap.overlayReady);
  hudEl.hidden = onTitle;

  const today = snap.today || utcDateKey();
  titleEndlessBest.textContent =
    snap.endlessBest > 0 ? `Personal best ${snap.endlessBest.toLocaleString("en-US")}` : "Personal best —";
  const dailyBestText =
    snap.dailyBest > 0 ? `best ${snap.dailyBest.toLocaleString("en-US")}` : "no best yet";
  const attempts = snap.dailyAttempts > 0 ? ` · ${snap.dailyAttempts} attempts` : "";
  titleDailyMeta.textContent = `${today} · resets at 00:00 UTC · ${dailyBestText}${attempts}`;
  btnMotion.textContent = snap.reducedMotion ? "Motion: reduced" : "Motion: full";
  const soundLabel = snap.muted ? "Sound: off" : "Sound: on";
  btnSound.textContent = soundLabel;
  btnHudSound.textContent = soundLabel;
  btnSound.setAttribute("aria-pressed", snap.muted ? "false" : "true");
  btnHudSound.setAttribute("aria-pressed", snap.muted ? "false" : "true");
  experimentTeach.textContent = snap.teach;
  btnBeatMute.classList.toggle("hidden", snap.variant !== "beat");
  btnBeatMute.textContent = snap.beatMuted ? "Click: off" : "Click: on";

  const showBadge = snap.variant !== "control";
  titleVariantBadge.classList.toggle("hidden", !showBadge);
  titleVariantBadge.textContent = snap.variantLabel;
  hudVariant.hidden = onTitle || !showBadge;
  hudVariant.textContent = snap.variantLabel;

  const showTeach = !onTitle && !onResult && snap.teachOpacity > 0.01;
  hudTeach.hidden = !showTeach;
  if (showTeach) {
    hudTeach.textContent = snap.teach;
    hudTeach.style.opacity = String(snap.teachOpacity);
  } else {
    hudTeach.style.opacity = "0";
  }

  for (const key of PICKER_VARIANT_KEYS) {
    const chip = document.querySelector<HTMLButtonElement>(`[data-variant="${key}"]`);
    chip?.classList.toggle("active", key === snap.variant);
  }

  const showBrake = !onTitle && !onResult && snap.variant === "brake";
  const wasBrakeHidden = btnBrake.classList.contains("hidden");
  btnBrake.classList.toggle("hidden", !showBrake);
  if (!showBrake) {
    input.setBrakeHold(false);
    btnBrake.classList.remove("held", "dragging");
    brakeDrag = null;
    clearBrakeLongPress();
  } else if (wasBrakeHidden && !brakeDrag) {
    layoutBrake();
  }
  hudSlow.hidden = !snap.braking;

  if (!onTitle) {
    hudMode.textContent = snap.mode === "daily" ? `Daily Challenge · ${snap.dateKey}` : "Endless";
    hudScore.textContent = snap.score.toLocaleString("en-US");
    if (snap.combo >= 2) {
      hudCombo.hidden = false;
      hudCombo.textContent = `combo ${snap.combo}`;
    } else {
      hudCombo.hidden = true;
    }
    const best = snap.mode === "daily" ? snap.dailyBest : snap.endlessBest;
    hudBest.textContent = best > 0 ? `best ${best.toLocaleString("en-US")}` : "";
  }

  if (onResult) {
    resultKicker.textContent = snap.screen === "cleared" ? "Daily clear" : "Thread snagged";
    resultHeading.textContent = snap.score.toLocaleString("en-US");
    const secs = (snap.timeMs / 1000).toFixed(1);
    const perfectBit = snap.variant === "beat" ? ` · ${snap.perfects} perfect` : "";
    resultSub.textContent = `${Math.floor(snap.distance)} distance · ${snap.cleanPasses} clean${perfectBit} · combo peak ${snap.comboPeak} · ${secs}s`;
    if (snap.shareLine) {
      resultShare.classList.remove("hidden");
      resultShare.textContent = snap.shareLine;
      btnShare.classList.remove("hidden");
    } else {
      resultShare.classList.add("hidden");
      btnShare.classList.add("hidden");
    }
  }
}

const loop = createLoop(
  (dt) => {
    const intent = input.poll();
    game.tick(intent, dt);
    if (game.screen === "title") audio.leaveRun();
    else audio.enterRun();
    for (const cue of game.drainSfx()) audio.play(cue);
    const heat = game.variant === "beat" && game.world ? game.world.beatHeat : 0;
    audio.setBeatIntensity(heat);
    const muted = Boolean(game.save.settings?.muted);
    if (
      game.world?.beatClick &&
      game.variant === "beat" &&
      !game.beatMuted &&
      !muted &&
      game.screen === "play"
    ) {
      playBeatClick(heat);
    }
    if (game.world) game.world.beatClick = false;
  },
  (alpha) => {
    drawFrame(view, game.world, alpha, game.screen === "title" && !game.save.settings?.reducedMotion);
    paintChrome();
  },
);

window.addEventListener("resize", () => {
  view.resize();
  if (!btnBrake.classList.contains("hidden") && !brakeDrag) layoutBrake();
});
loop.start();
paintChrome(true);

function must<T extends HTMLElement = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el;
}
