/**
 * mulberry32 — small, well-known 32-bit PRNG.
 * Returns a factory that yields floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded RNG used by both Daily and Endless. Daily never falls back to Math.random. */
export class Rng {
  private readonly nextFloat: () => number;
  readonly seed: number;
  private draws = 0;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.nextFloat = mulberry32(this.seed);
  }

  /** [0, 1) */
  next(): number {
    this.draws += 1;
    return this.nextFloat();
  }

  float(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Inclusive integer in [min, max]. */
  int(min: number, max: number): number {
    if (max < min) {
      const swap = min;
      min = max;
      max = swap;
    }
    const span = max - min + 1;
    return min + Math.floor(this.next() * span);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty list");
    return items[this.int(0, items.length - 1)]!;
  }

  get drawCount(): number {
    return this.draws;
  }
}
