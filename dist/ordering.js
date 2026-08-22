"use strict";
// ordering.ts — the one total order this package sorts identity-bearing data by.
//
// Every ordering that reaches a hash, a manifest, a packet or a report is
// code-point ordering. `localeCompare` is correct for showing a list to a person
// and wrong for anything a machine will compare across hosts: it varies with the
// runtime's ICU data and the ambient locale, so the same observation can serialize
// two different ways on two machines and break a byte-for-byte replay.
//
// This lives in its own module because it is imported by both ends of the
// dependency graph — inventory observation and packet egress — and a shared
// helper parked in either one would make them circular.
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareCodePoints = compareCodePoints;
exports.canonicalPair = canonicalPair;
/** Order two strings by Unicode code point. Never locale-aware. */
function compareCodePoints(a, b) {
    const left = [...a], right = [...b];
    const shared = Math.min(left.length, right.length);
    for (let i = 0; i < shared; i++) {
        const l = left[i].codePointAt(0) ?? 0, r = right[i].codePointAt(0) ?? 0;
        if (l !== r)
            return l < r ? -1 : 1;
    }
    if (left.length === right.length)
        return 0;
    return left.length < right.length ? -1 : 1;
}
/**
 * Order a pair of ids so that a symmetric relation has one canonical spelling.
 *
 * A near-duplicate candidate between two artifacts is the same candidate whichever
 * one is read first, so its identity must not depend on iteration order.
 */
function canonicalPair(a, b) {
    return compareCodePoints(a, b) <= 0 ? [a, b] : [b, a];
}
//# sourceMappingURL=ordering.js.map