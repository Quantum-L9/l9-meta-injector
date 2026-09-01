// canonical_float_parity.test.ts — this runtime and CPython must agree, byte for byte.
//
// The Corpus Intelligence packet is hashed on both sides of a language boundary:
// this repository emits it and computes its identity, and l9-constellation-topology
// recomputes that identity from the bytes it reads. The two canonical forms have
// to be the same string, or every emitted bundle is rejected on arrival.
//
// Integers were never in doubt. Floats were, and the packet carries them — pair
// scores are measurements in [0,1], and a categorical signal that fired scores
// exactly 1. This runtime renders that as `1`; CPython renders it as `1.0`.
//
// So the agreement is tested against a real `json.dumps` in a real interpreter
// rather than against a restatement of CPython's rules. A test that encoded my
// reading of those rules would agree with my misreading of them.
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { canonicalFloat, canonicalJson, semanticHash } from "../src/repository_model";

/**
 * Render each value with CPython, using the consumer's exact `json.dumps` call.
 *
 * The values cross as raw IEEE-754 bit patterns rather than as JSON. Sending
 * them as JSON silently destroys the thing under test: `JSON.stringify(1e16)`
 * is `10000000000000000`, which CPython parses as an `int`, so the harness
 * compares this runtime's float against CPython's *integer* formatting and
 * reports a divergence that does not exist. `-0` degrades the same way. Bits
 * are the only representation that survives the trip intact.
 */
function pythonCanonical(values: readonly number[], asInt = false): string[] {
  const buffer = Buffer.alloc(8 * values.length);
  values.forEach((value, index) => buffer.writeDoubleLE(value, index * 8));
  const program = [
    "import json,struct,sys",
    "raw=sys.stdin.buffer.read()",
    "vals=[struct.unpack_from('<d',raw,i)[0] for i in range(0,len(raw),8)]",
    ...(asInt ? ["vals=[int(v) for v in vals]"] : []),
    "sys.stdout.write(json.dumps([",
    " json.dumps(v,separators=(',',':'),ensure_ascii=False,allow_nan=False) for v in vals]))",
  ].join("\n");
  const out = execFileSync("python3", ["-c", program], { input: buffer, encoding: "utf8" });
  return JSON.parse(out) as string[];
}

/** Values chosen for where the two runtimes are known to disagree. */
const BOUNDARIES: number[] = [
  0, -0, 1, -1, 0.5, -0.5,
  // The exact value a categorical signal carries when it fires.
  1.0, 0.0,
  // CPython leaves decimal notation at decpt <= -4; this runtime at -6.
  1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8,
  // CPython enters exponential at decpt > 16; this runtime at 21.
  1e14, 1e15, 1e16, 1e17, 1e20, 1e21, 1e22,
  // Shortest-repr values with a long digit string.
  0.1 + 0.2, 1 / 3, 2 / 3, 0.063548, 0.8500000000000001,
  // Sub-normal and extreme magnitudes.
  Number.MIN_VALUE, Number.MAX_VALUE, Number.EPSILON,
  -1e-7, -1e21, -0.063548,
  // Integers that stay integers.
  42, 1000000, -999, 9007199254740991,
];

describe("canonical numbers cross the language boundary unchanged", () => {
  it("matches CPython float formatting on every known divergence boundary", () => {
    const rendered = BOUNDARIES.map((value) => canonicalJson(canonicalFloat(value)));
    expect(rendered).toEqual(pythonCanonical(BOUNDARIES));
  });

  it("matches CPython int formatting for plain integral numbers", () => {
    /* A bare number is a count. CPython holds a count as an `int`, which never
     * enters exponential notation however large it gets — this runtime turns
     * 1e21 into "1e+21", and a count rendered that way is a different string
     * from the one the consumer computes. */
    const counts = [0, 1, -1, 42, 1e15, 1e16, 1e21, 1e22, 9007199254740991, -9007199254740991];
    const rendered = counts.map((value) => canonicalJson(value));
    expect(rendered).toEqual(pythonCanonical(counts, true));
  });

  it("matches CPython over a large random sample of doubles", () => {
    /* Deterministic sample: a seeded generator, so a failure is reproducible
     * rather than a one-off someone cannot get back. The magnitudes are spread
     * across the exponent range on purpose — the divergences live at the
     * thresholds where one runtime switches notation and the other has not. */
    let seed = 0x2f6e2b1;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const sample: number[] = [];
    for (let index = 0; index < 4000; index += 1) {
      const exponent = Math.floor(next() * 40) - 20;
      const value = next() * 10 ** exponent;
      sample.push(next() < 0.5 ? value : -value);
    }
    // Scores as this pipeline actually produces them: bounded, and rounded to
    // six places by the producer's own ratio helper.
    for (let index = 0; index <= 1000; index += 1) {
      sample.push(Math.round((index / 1000) * 1e6) / 1e6);
    }
    const rendered = sample.map((value) => canonicalJson(canonicalFloat(value)));
    const expected = pythonCanonical(sample);
    // Report the first disagreement rather than a 5000-element diff.
    const divergent = sample
      .map((value, index) => ({ value, ours: rendered[index], theirs: expected[index] }))
      .filter((entry) => entry.ours !== entry.theirs);
    expect(divergent.slice(0, 5)).toEqual([]);
  });

  it("round-trips: what we render parses back to the same double", () => {
    /* Formatting agreement is not enough on its own. A renderer could agree
     * with CPython and still lose precision if both dropped the same digits;
     * this is the independent check that the digits are sufficient. */
    for (const value of BOUNDARIES) {
      // `Object.is`, so `-0` round-tripping to `+0` would be caught rather than
      // compared equal.
      const parsed = Number(canonicalJson(canonicalFloat(value)));
      expect(Object.is(parsed, value), `round-trip ${value}`).toBe(true);
    }
  });

  it("still refuses what has no JSON form at all", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/only finite numbers are canonical/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/only finite numbers/);
    expect(() => canonicalFloat(Number.NaN)).toThrow(/must be finite/);
  });

  it("keeps a marked measurement a float inside a packet-shaped structure", () => {
    /* The case that made every emitted bundle unreadable. A categorical signal
     * that fired scores exactly 1; unmarked it renders as the integer `1`, and
     * the consumer — whose field is a float — renders `1.0`. */
    const scores = { method_scores: [{ method: "exact", score: canonicalFloat(1) }] };
    expect(canonicalJson(scores)).toBe('{"method_scores":[{"method":"exact","score":1.0}]}');
    const counts = { artifact_count: 1 };
    expect(canonicalJson(counts)).toBe('{"artifact_count":1}');
  });

  it("survives volatile-key stripping without being descended into", () => {
    /* `stripVolatile` walks objects key by key. A marker reached by that walk
     * as if it were a plain object would come out as `{"value":0.85}`. */
    expect(semanticHash({ score: canonicalFloat(0.85), created_at: "x" })).toBe(
      semanticHash({ score: canonicalFloat(0.85) }),
    );
    expect(canonicalJson({ score: canonicalFloat(0.85) })).toBe('{"score":0.85}');
  });
});
