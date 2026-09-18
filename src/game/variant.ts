/**
 * Overnight competing experiments. Control (default / omitted / `control`)
 * is current main — do not change SEED_VERSION or control feel from here.
 *
 * Dead keys (ghost / pulse / mirror / lanes) parse as control.
 * Lanes remains in the type and sim for archaeology; picker + `?variant=lanes`
 * no longer surface it (LANES-KILL-v1).
 */
export type ExperimentVariant = "control" | "brake" | "beat" | "lanes";

export const VARIANT_KEYS = ["control", "brake", "beat", "lanes"] as const;
/** Chips shown to players. Lanes is intentionally absent. */
export const PICKER_VARIANT_KEYS = ["control", "brake", "beat"] as const;

export const BRAKE_SLOW = 0.45;

export const BEAT_BPM = 96;
export const BEAT_PERFECT_MS_TOUCH = 120;
export const BEAT_PERFECT_MS_KEY = 100;
export const PERFECT_STYLE = 25;

/** BEAT-STREAK-INTENSITY-v1 — feedback only; never retunes hitbox / speed / gap. */
export const BEAT_STREAK_CAP = 8;
export const BEAT_COOL_MS = 400;
export const BEAT_PULSE_SCALE_MAX = 1.18;
export const BEAT_GLOW_BLUR_MAX = 20;
export const BEAT_BED_BOOST_DB = 6;
export const BEAT_SHELF_DB = 3;

export function beatIntensityFromStreak(streak: number): number {
  if (!Number.isFinite(streak) || streak <= 0) return 0;
  return Math.min(streak, BEAT_STREAK_CAP) / BEAT_STREAK_CAP;
}

/** Linear bed gain for intensity 0..1. Cap is +6 dB at 1. */
export function beatBedGain(base: number, intensity: number): number {
  const i = Math.min(1, Math.max(0, intensity));
  return base * 10 ** ((BEAT_BED_BOOST_DB * i) / 20);
}

export const LANE_X = [90, 180, 270] as const;
export const LANE_COUNT = 3;
export const LANE_W = 120;
export const LANE_LERP_MS = 80;
/** Hairline x positions between the three lanes. */
export const LANE_GUIDES = [120, 240] as const;

export const VARIANT_LABEL: Record<ExperimentVariant, string> = {
  control: "Control",
  brake: "Brake",
  beat: "Beat",
  lanes: "Lanes",
};

export const VARIANT_TEACH: Record<ExperimentVariant, string> = {
  control: "Steer through the lips. Don’t touch the walls.",
  brake: "Hold Brake (or Space) to slow. Steer the gaps.",
  beat: "Thread each lip on the pulse. Works with click off.",
  lanes: "Swipe or tap sides to change lane. Stay in the open one.",
};

/** Design binding EXPERIMENT-TEACH-COPY. Default / Control / omitted `?variant=` uses `.control`. */
export const EXPERIMENT_TEACH_COPY = VARIANT_TEACH;

/** In-run teach: full opacity for 4s, then fade. Once per run. */
export const TEACH_HOLD_S = 4;
export const TEACH_FADE_S = 0.5;

export function inRunTeachOpacity(timeS: number): number {
  if (timeS <= TEACH_HOLD_S) return 1;
  const t = (timeS - TEACH_HOLD_S) / TEACH_FADE_S;
  if (t >= 1) return 0;
  return 1 - t;
}

export function isExperimentVariant(value: string | null | undefined): value is ExperimentVariant {
  return value === "control" || value === "brake" || value === "beat" || value === "lanes";
}

/** Default / omitted / `control` / unknown (incl. dead ghost/pulse/mirror/lanes) → control. */
export function parseVariant(search: string): ExperimentVariant {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const raw = new URLSearchParams(q).get("variant");
  if (raw === "brake" || raw === "beat") return raw;
  return "control";
}

export function variantSearchParam(variant: ExperimentVariant): string | null {
  return variant === "control" ? null : variant;
}
