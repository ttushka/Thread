import {
  STEER_KEY_ACCEL,
  STEER_KEY_DECEL,
  STEER_TAP_BIAS_CAP,
  STEER_TAP_BIAS_MS,
} from "./constants.ts";

export type SteerSmoothState = {
  /** Smoothed keyboard steer in [-1, 1]. */
  steerSmooth: number;
  /** Seconds the current non-zero key intent has been held. */
  steerPressAge: number;
  /** Last applied key intent, for detecting a new press. */
  steerKeyIntent: number;
};

export function createSteerSmoothState(): SteerSmoothState {
  return { steerSmooth: 0, steerPressAge: 0, steerKeyIntent: 0 };
}

function approach(current: number, target: number, rate: number, dt: number): number {
  if (current < target) return Math.min(target, current + rate * dt);
  if (current > target) return Math.max(target, current - rate * dt);
  return current;
}

/**
 * Linear keyboard steer smoothing. Pointer/drag does not use this value.
 * Accel toward ±1 while a key is held; faster decel to 0 on release.
 * First STEER_TAP_BIAS_MS of a new press ceilings |steerSmooth| in the press direction.
 */
export function stepSteerSmooth(state: SteerSmoothState, intentSteer: number, dt: number): void {
  if (dt <= 0) return;
  const intent = Math.max(-1, Math.min(1, intentSteer));
  const sign = Math.sign(intent);
  const prevSign = Math.sign(state.steerKeyIntent);

  if (sign === 0) {
    state.steerPressAge = 0;
  } else if (sign !== prevSign) {
    state.steerPressAge = dt;
  } else {
    state.steerPressAge += dt;
  }
  state.steerKeyIntent = intent;

  const rate = sign === 0 ? STEER_KEY_DECEL : STEER_KEY_ACCEL;
  state.steerSmooth = approach(state.steerSmooth, intent, rate, dt);

  if (sign !== 0 && state.steerPressAge <= STEER_TAP_BIAS_MS / 1000) {
    if (sign > 0) state.steerSmooth = Math.min(state.steerSmooth, STEER_TAP_BIAS_CAP);
    else state.steerSmooth = Math.max(state.steerSmooth, -STEER_TAP_BIAS_CAP);
  }

  state.steerSmooth = Math.max(-1, Math.min(1, state.steerSmooth));
}
