/** Order two strings by Unicode code point. Never locale-aware. */
export declare function compareCodePoints(a: string, b: string): number;
/**
 * Order a pair of ids so that a symmetric relation has one canonical spelling.
 *
 * A near-duplicate candidate between two artifacts is the same candidate whichever
 * one is read first, so its identity must not depend on iteration order.
 */
export declare function canonicalPair(a: string, b: string): [string, string];
