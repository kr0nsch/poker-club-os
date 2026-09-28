// Randomness sources. Production seating uses the platform CSPRNG (Web Crypto,
// available in Node >= 19 and all browsers); tests use a seeded PRNG.

export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/** Unbiased integers from crypto.getRandomValues via rejection sampling. */
export function createCryptoRng(): Rng {
  const buf = new Uint32Array(1);
  return {
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 2 ** 32) {
        throw new RangeError(`invalid bound ${maxExclusive}`);
      }
      const limit = Math.floor(2 ** 32 / maxExclusive) * maxExclusive;
      for (;;) {
        globalThis.crypto.getRandomValues(buf);
        const v = buf[0]!;
        if (v < limit) return v % maxExclusive;
      }
    },
  };
}

/** Deterministic PRNG (mulberry32) — for tests and reproducible previews only. */
export function createSeededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int(maxExclusive: number): number {
      return Math.floor(next() * maxExclusive);
    },
  };
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function pick<T>(items: readonly T[], rng: Rng): T {
  if (items.length === 0) throw new RangeError("cannot pick from empty list");
  return items[rng.int(items.length)]!;
}
