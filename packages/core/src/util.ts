/**
 * Deterministic (non-cryptographic) hash, used only to derive stable ids
 * from an Evaluation's own inputs — never `crypto.randomUUID()`, which
 * would break the reproducibility guarantee that the same inputs always
 * produce an identical output (Phase 13.8).
 *
 * 64-bit (two independent 32-bit FNV-1a passes, different seeds,
 * concatenated into 16 hex chars — roadmap E-17): the original 32-bit
 * output made a collision, which `evaluate-pipeline.ts` writes with
 * `skipDuplicates` and so silently drops, a real risk at scale. Kept as
 * plain arithmetic (no `crypto` import) so `@sla/core` stays usable
 * outside Node.
 */
export function stableHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xc4ceb9fe;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x85ebca77);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  );
}
