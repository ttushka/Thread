import { Game } from "./game/Game.ts";
import { createAudioBed } from "./game/audio.ts";
import { createInput, isOverlayRetryTarget } from "./game/input.ts";
import { createLoop } from "./game/loop.ts";
import { mountCanvas } from "./game/render/canvas.ts";
import { drawFrame } from "./game/render/draw.ts";
import { parseDeepLink } from "./game/share.ts";
import { utcDateKey } from "./game/seed.ts";

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
const titleEndlessBest = must("#title-endless-best");
const titleDailyMeta = must("#title-daily-meta");
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

const view = mountCanvas(canvas);
const game = new Game(window.localStorage);
game.prefersReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);

const audio = createAudioBed();
audio.setMuted(Boolean(game.save.settings?.muted));

const unlockAudio = () => audio.unlock();
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

const input = createInput({
  canvas,
  getMap: () => view.map,
  canQueueRestart: () => game.screen === "dead" || game.screen === "cleared",
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
    resultSub.textContent = `${Math.floor(snap.distance)} distance · ${snap.cleanPasses} clean · combo peak ${snap.comboPeak} · ${secs}s`;
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
  },
  (alpha) => {
    drawFrame(view, game.world, alpha, game.screen === "title" && !game.save.settings?.reducedMotion);
    paintChrome();
  },
);

window.addEventListener("resize", () => view.resize());
loop.start();
paintChrome(true);

function must<T extends HTMLElement = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el;
}
