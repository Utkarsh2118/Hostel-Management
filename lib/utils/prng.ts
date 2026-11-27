/**
 * Deterministic PRNG utilities.
 * Uses FNV-1a 32-bit string hashing + Mulberry32 generator so identical seeds
 * produce bit-identical sequences across runs, machines, and Node versions.
 */
export function hashStringToUint32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createSeededRng(seed: string): () => number {
  let state = hashStringToUint32(seed) || 0x1a2b3c4d;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Computes a deterministic tie-breaker in [0, 1) uniquely tied to (seed, entityId).
 * Because it depends on the entity's own ID rather than array order, shuffling the
 * input student list will still produce the exact same allotment ordering.
 */
export function seededTieBreaker(seed: string, entityId: string): number {
  const rng = createSeededRng(`${seed}::${entityId}`);
  return rng();
}

/**
 * Deterministic subtle rotation in degrees (between -1.5 and +1.5 deg) from an item's ID
 * so notice board chits never jump or jitter between renders.
 */
export function deterministicTilt(id: string, maxDeg = 1.4): number {
  const hash = hashStringToUint32(id);
  const normalized = (hash % 1001) / 1000; // 0..1
  const deg = (normalized * 2 - 1) * maxDeg;
  return Math.round(deg * 100) / 100;
}
