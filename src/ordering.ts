// ordering.ts — the one total order used wherever output is identity-bearing.
//
// This lives in a leaf module because everything needs it: inventory clusters,
// interpretation assertions, packet domains, and corpus projections all have to
// agree on what "sorted" means, and a second implementation would let two of
// them disagree. `repository_model` re-exports `compareCodePoints` so the
// published surface is unchanged.
//
// Never `localeCompare`: it consults the host's locale, so the same bytes can
// order differently on two machines and a hash taken over the result stops being
// reproducible. Code points are a property of the string itself.

/** Code-point ordering. Never locale-aware: ordering must not vary by environment. */
export function compareCodePoints(a: string, b: string): number {
  const left = [...a], right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    const l = left[i].codePointAt(0) ?? 0, r = right[i].codePointAt(0) ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}

/**
 * The two members of an unordered pair, in a fixed order.
 *
 * A pair's identity must not depend on which side the caller happened to iterate
 * first, or the same relationship would hash two ways.
 */
export function canonicalPair(a: string, b: string): [string, string] {
  return compareCodePoints(a, b) <= 0 ? [a, b] : [b, a];
}
