import { randomRunSeed } from "../seed.ts";

/** Endless: a fresh seed every run unless a test injects one. */
export function endlessSeed(injected?: number): number {
  return injected !== undefined ? injected >>> 0 : randomRunSeed();
}
