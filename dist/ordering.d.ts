/** Code-point ordering. Never locale-aware: ordering must not vary by environment. */
export declare function compareCodePoints(a: string, b: string): number;
/**
 * The two members of an unordered pair, in a fixed order.
 *
 * A pair's identity must not depend on which side the caller happened to iterate
 * first, or the same relationship would hash two ways.
 */
export declare function canonicalPair(a: string, b: string): [string, string];
