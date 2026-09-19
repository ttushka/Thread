import {
  BEAT_BPM,
  BEAT_PERFECT_MS_KEY,
  BEAT_PERFECT_MS_TOUCH,
  BEAT_SKIM_EARLY_MS,
  BEAT_SKIM_FORGIVE_STREAK,
  BEAT_SKIM_MS,
} from "../variant.ts";
import { BASE_SPEED } from "./constants.ts";

export function beatPeriod(bpm = BEAT_BPM): number {
  return 60 / bpm;
}

/** World units between metronome beats at BASE_SPEED. */
export function beatDistance(bpm = BEAT_BPM): number {
  return BASE_SPEED * beatPeriod(bpm);
}

/**
 * Snap a proposed scoring-lip y onto the beat grid, never closer than one
 * beat to the previous scoring lip (feel-sanity: no bunching < 0.6s).
 */
export function quantizeLipY(y: number, prevLipY: number, bpm = BEAT_BPM): number {
  const step = beatDistance(bpm);
  let q = Math.ceil((y - 1e-9) / step) * step;
  const minY = prevLipY > 0 ? prevLipY + step : 0;
  while (q < minY - 1e-9) q += step;
  return q;
}

/** Milliseconds from `time` to the nearest metronome beat. */
export function msToNearestBeat(time: number, bpm = BEAT_BPM): number {
  const period = beatPeriod(bpm);
  if (period <= 0) return 0;
  const phase = ((time % period) + period) % period;
  return Math.min(phase, period - phase) * 1000;
}

export function perfectWindowMs(touch: boolean): number {
  return touch ? BEAT_PERFECT_MS_TOUCH : BEAT_PERFECT_MS_KEY;
}

export function isPerfectTiming(time: number, touch: boolean, bpm = BEAT_BPM): boolean {
  return msToNearestBeat(time, bpm) <= perfectWindowMs(touch) + 1e-6;
}

/** Nearest metronome index — shared by Perfect and on-pulse skim credits. */
export function nearestBeatIndex(time: number, bpm = BEAT_BPM): number {
  const period = beatPeriod(bpm);
  if (period <= 0) return 0;
  return Math.round(time / period);
}

/** ±240ms while streak < 3; ±180ms at mastery. Same Perfect clock. */
export function skimWindowMs(streak = 0): number {
  return streak < BEAT_SKIM_FORGIVE_STREAK ? BEAT_SKIM_EARLY_MS : BEAT_SKIM_MS;
}

/** Wall-skim streak window. Same clock as Perfect; input-agnostic. */
export function isSkimTiming(time: number, streak = 0, bpm = BEAT_BPM): boolean {
  return msToNearestBeat(time, bpm) <= skimWindowMs(streak) + 1e-6;
}

/** 1 at beat center, decaying over ~120ms — visual pulse works muted. */
export function beatPulseAmp(time: number, bpm = BEAT_BPM): number {
  const ms = msToNearestBeat(time, bpm);
  const span = 120;
  if (ms >= span) return 0;
  return 1 - ms / span;
}
