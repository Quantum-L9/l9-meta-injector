// corpus_candidate_thresholds.test.ts — one threshold, one meaning.
//
// A candidate threshold is compared, bounded, named in candidate ids, hashed into
// the candidate profile and written into cache keys. Those five uses have to mean
// the same number, or the indexed generator disagrees with the exhaustive
// reference it is required to equal, and two runs that produced different
// candidates share one profile hash and one cache key. These tests hold the
// indexed generators to their references exactly at the boundary: a pair whose
// Jaccard sits on the threshold.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_NEAR_DUPLICATE_THRESHOLD,
  NearDuplicateDocument,
  nearDuplicateCandidates,
  nearDuplicateCandidatesExhaustive,
  prefixLength,
} from "../src/corpus_analysis";
import {
  DEFAULT_TOPIC_THRESHOLD,
  buildTopicCandidates,
  buildTopicCandidatesExhaustive,
  candidateProfileHash,
} from "../src/corpus_candidates";
import type { TopicDocumentInput } from "../src/corpus_candidates";
import { runCorpusScan } from "../src/corpus_scan";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** A near-duplicate document whose shingle set is `count` elements of a namespace. */
function shingled(id: string, namespace: string, count: number): NearDuplicateDocument {
  return {
    artifactId: id,
    sourcePath: `R::${id}.md`,
    contentHash: `sha256:${id}`,
    normalizedContentHash: `normtext:${id}`,
    shingles: new Set(Array.from({ length: count }, (_unused, index) => `${namespace}-${index}`)),
    tokenCount: count + 4,
  };
}

/** Pairs whose smaller set is a subset of the larger: Jaccard is small / large. */
const SUBSET_PAIRS: [number, number][] = [[7, 50], [14, 25], [28, 50], [55, 100], [51, 75]];

function subsetCorpus(): NearDuplicateDocument[] {
  return SUBSET_PAIRS.flatMap(([small, large], index) => [
    shingled(`pair${index}-small`, `pair${index}`, small),
    shingled(`pair${index}-large`, `pair${index}`, large),
  ]);
}

function pairs(candidates: { artifact_a_id: string; artifact_b_id: string; score: number }[]): string[] {
  return candidates.map((c) => `${[c.artifact_a_id, c.artifact_b_id].sort().join(" ~ ")} ${c.score}`).sort();
}

/** Term counts for a body, in the shape the topic pass consumes. */
function topicDocument(id: string, body: string, tokenCount = 60): TopicDocumentInput {
  const counts = new Map<string, number>();
  for (const word of body.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0)) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return {
    virtual_source_id: id,
    corpus_path: `R::${id}.md`,
    term_counts: [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    token_count: tokenCount,
  };
}

function grouping(candidates: { member_ids: string[] }[]): string[] {
  return candidates.map((candidate) => [...candidate.member_ids].sort().join(",")).sort();
}

const WORDS = [
  "granite", "basalt", "quartz", "feldspar", "obsidian", "pumice", "marble", "slate", "shale", "gneiss",
  "schist", "dolomite", "gypsum", "halite", "pyrite", "galena", "barite", "calcite", "fluorite", "apatite",
];

describe("the near-duplicate generators at the threshold itself", () => {
  it("REG-WU-041-RC-071-a: report a pair whose Jaccard equals the threshold on both paths", () => {
    const documents = subsetCorpus();
    for (const threshold of [0.14, 0.56, 0.55, 0.68]) {
      const indexed = pairs(nearDuplicateCandidates(documents, threshold));
      const exhaustive = pairs(nearDuplicateCandidatesExhaustive(documents, threshold));
      expect(indexed, `threshold ${threshold}`).toEqual(exhaustive);
      expect(exhaustive.some((pair) => pair.endsWith(` ${threshold}`)), `threshold ${threshold}`).toBe(true);
    }
  });

  it("REG-WU-041-RC-071-b: agree on a pair just under the threshold that rounds onto it", () => {
    // 2/3 is below 0.666667, and rounds to it at six places, so the rounded test
    // admits it. The bounds must not be stricter than that test.
    const documents = [shingled("small", "ns", 2), shingled("large", "ns", 3)];
    for (const threshold of [0.666667, 0.6666666]) {
      const exhaustive = pairs(nearDuplicateCandidatesExhaustive(documents, threshold));
      expect(exhaustive).toHaveLength(1);
      expect(pairs(nearDuplicateCandidates(documents, threshold))).toEqual(exhaustive);
    }
  });

  it("REG-WU-041-RC-071-e: agree at the six reference thresholds and the default, with candidate ids unchanged", () => {
    const documents = [
      ...subsetCorpus(),
      shingled("x", "shared", 20),
      shingled("y", "shared", 21),
      shingled("z", "shared", 30),
    ];
    for (const threshold of [0.1, 0.2, 0.35, 0.5, 0.7, 0.9, DEFAULT_NEAR_DUPLICATE_THRESHOLD]) {
      expect(pairs(nearDuplicateCandidates(documents, threshold)), `threshold ${threshold}`)
        .toEqual(pairs(nearDuplicateCandidatesExhaustive(documents, threshold)));
    }
    // A candidate id is a function of the pair and the threshold; for a
    // six-decimal threshold it is exactly what the previous release produced.
    expect(nearDuplicateCandidates([shingled("x", "s", 20), shingled("y", "s", 21)], 0.85)
      .map((candidate) => candidate.candidate_id))
      .toEqual(["near-duplicate:ef1f7d4d1ca8634f13796a84b11c99de2403f95d99212cf6f10dbc0b4be8f90a"]);
    // The prefix bound still indexes at least what the classical bound does.
    expect(prefixLength(50, 0.56)).toBeGreaterThanOrEqual(50 - Math.ceil(0.56 * 50) + 1);
  });
});

describe("the topic threshold, canonicalised once", () => {
  it("REG-WU-041-RC-071-c: makes the indexed and exhaustive passes agree at a threshold with more than six decimals", () => {
    const small = topicDocument("small", "granite basalt");
    const large = topicDocument("large", "granite basalt quartz");
    const documents = [small, large];
    for (const threshold of [0.6666666, 0.3499999]) {
      const indexed = buildTopicCandidates({ documents, rootById: new Map(), threshold });
      const exhaustive = buildTopicCandidatesExhaustive({ documents, rootById: new Map(), threshold });
      expect(grouping(indexed.candidates), `threshold ${threshold}`).toEqual(grouping(exhaustive));
    }
  });

  it("REG-WU-041-RC-071-d: never gives two different results one profile hash", () => {
    // Jaccard exactly 7/20 = 0.35.
    const documents = [
      topicDocument("seven", WORDS.slice(0, 7).join(" ")),
      topicDocument("twenty", WORDS.join(" ")),
    ];
    const at = (threshold: number) => ({
      hash: candidateProfileHash({ topicThreshold: threshold, nearDuplicateThreshold: 0.85 }),
      ids: buildTopicCandidates({ documents, rootById: new Map(), threshold }).candidates
        .map((candidate) => candidate.candidate_id),
      reference: buildTopicCandidatesExhaustive({ documents, rootById: new Map(), threshold })
        .map((candidate) => candidate.candidate_id),
      thresholds: buildTopicCandidates({ documents, rootById: new Map(), threshold }).candidates
        .map((candidate) => candidate.threshold),
    });
    const plain = at(0.35);
    const extended = at(0.3500004);
    expect(extended.hash).toBe(plain.hash);
    expect(extended.ids).toEqual(plain.ids);
    expect(extended.reference).toEqual(plain.reference);
    expect(extended.thresholds).toEqual(plain.thresholds);
    expect(plain.ids).toHaveLength(1);
    // The near-duplicate threshold is canonicalised the same way.
    expect(candidateProfileHash({ topicThreshold: 0.35, nearDuplicateThreshold: 0.8500004 }))
      .toBe(candidateProfileHash({ topicThreshold: 0.35, nearDuplicateThreshold: 0.85 }));
  });

  it("REG-WU-041-RC-071-g: leaves six-decimal thresholds, their ids and the profile hash unchanged", () => {
    expect(candidateProfileHash({ topicThreshold: 0.35, nearDuplicateThreshold: 0.85 }))
      .toBe("candidate-profile:6533c9480ced244473b11d84ca754036f89d58764ffe415180d902800bd0a43e");
    expect(DEFAULT_TOPIC_THRESHOLD).toBe(0.35);
    const documents = [
      topicDocument("a", "granite basalt quartz feldspar mica obsidian"),
      topicDocument("b", "granite basalt quartz feldspar mica pumice"),
      topicDocument("c", "harbor vessel anchor rudder keel mast"),
    ];
    expect(buildTopicCandidates({ documents, rootById: new Map(), threshold: 0.35 }).candidates
      .map((candidate) => candidate.candidate_id))
      .toEqual(["topic-candidate:b3a176472d7abf7b1941da9342ed51e5765a673422efa4bc257e958d1f61d3d2"]);
    expect(buildTopicCandidates({ documents, rootById: new Map(), threshold: 0.5 }).candidates
      .map((candidate) => candidate.candidate_id))
      .toEqual(["topic-candidate:0275df284fd1379989fb14f813a958edd34a4c5273d23a10693dbd9c230ca6a9"]);
  });
});

describe("a scan at a boundary threshold", () => {
  it("REG-WU-041-RC-071-f: reports the pair whose score is exactly the threshold", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-threshold-scan-"));
    scratch.push(root);
    // Distinct tokens, so k tokens make k - 4 five-token shingles: 28 of 50.
    const tokens = Array.from({ length: 54 }, (_unused, index) => `w${String(index).padStart(4, "0")}`);
    fs.writeFileSync(path.join(root, "short.md"), `${tokens.slice(0, 32).join(" ")}\n`, "utf8");
    fs.writeFileSync(path.join(root, "long.md"), `${tokens.join(" ")}\n`, "utf8");

    const result = await runCorpusScan({
      roots: [{ path: root, name: "R" }],
      producerVersion: "thresholds",
      nearDuplicates: { threshold: 0.56 },
    });
    expect(result.candidates.near_duplicate_candidates.map((candidate) => candidate.score)).toEqual([0.56]);
  });
});
