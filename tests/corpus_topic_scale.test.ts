// corpus_topic_scale.test.ts — the topic index against comparing everything.
//
// The topic pass used to index every salient term of every document. A term
// appearing in four thousand documents then produced eight million pairs from
// one posting list, so the cost was quadratic in the corpus after all — arriving
// through the index rather than around it. That is why the ten-thousand-artifact
// scale run had topic candidates switched off, which is a quieter way of not
// having qualified them.
//
// The index now holds each document's rarest-first prefix, which is an exact
// filter rather than a sample. This file is what makes that claim checkable: at
// six thresholds and on several corpus shapes it holds the indexed pass to an
// exhaustive one that compares every pair, and requires the two to agree
// exactly. A bound that quietly dropped a qualifying pair would show up here as
// a missing group, not as a faster test.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOPIC_THRESHOLD,
  TOPIC_MIN_TOKENS,
  buildTopicCandidates,
  buildTopicCandidatesExhaustive,
  topicPrefixLength,
} from "../src/corpus_candidates";
import type { TopicDocumentInput } from "../src/corpus_candidates";

/** Term counts for a body, in the shape the topic pass consumes. */
function document(id: string, body: string, tokenCount = TOPIC_MIN_TOKENS + 40): TopicDocumentInput {
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

/** Comparable shape: which documents ended up grouped together. */
function grouping(candidates: { member_ids: string[] }[]): string[] {
  return candidates.map((candidate) => [...candidate.member_ids].sort().join(",")).sort();
}

/**
 * A corpus with real structure: shared boilerplate, subject groups, unique tails.
 *
 * The boilerplate is the part that matters. It is in every document, so under the
 * old index it produced one posting list the size of the corpus; under the prefix
 * bound it sorts last and is never indexed at all.
 */
function structuredCorpus(size: number, subjects: number): TopicDocumentInput[] {
  const boilerplate = "written during the migration and kept for the record nothing reviewed";
  const subjectBodies = [
    "acquisition reads a folder an external drive or a zip archive without writing",
    "identity comes from content hashes and root relative paths never a mount point",
    "the cache is keyed by the bytes and by the identity of the rules applied",
    "duplicate clusters are byte equality and are facts rather than similarity",
    "coverage reports what the decoders could not open as well as what they could",
    "readiness evidence is counts and citations carrying no ranking or priority",
  ];
  return Array.from({ length: size }, (_unused, index) =>
    document(
      `doc-${String(index).padStart(4, "0")}`,
      `${boilerplate} ${subjectBodies[index % subjects] as string} `
      + `reference${index} unique${index} tail${index}`,
    ));
}

describe("the topic prefix bound", () => {
  it("indexes enough of a set that a qualifying partner must intersect it", () => {
    // For Jaccard at t, a pair sharing at least ceil(t*|X|) terms must both hold
    // one of the first |X| - ceil(t*|X|) + 1 in any fixed order. The arithmetic
    // is the proof; this pins it so a future edit cannot quietly shorten it.
    expect(topicPrefixLength(40, 0.35)).toBe(27);
    expect(topicPrefixLength(40, 0.85)).toBe(7);
    expect(topicPrefixLength(10, 0.5)).toBe(6);
    // At the extremes: everything, and one.
    expect(topicPrefixLength(10, 0.01)).toBe(10);
    expect(topicPrefixLength(10, 1)).toBe(1);
    expect(topicPrefixLength(0, 0.35)).toBe(0);
  });
});

describe("the indexed pass against an exhaustive one", () => {
  const thresholds = [0.1, 0.2, 0.35, 0.5, 0.7, 0.9];

  it("agrees at every threshold on a corpus with real subject groups", () => {
    const documents = structuredCorpus(120, 6);
    for (const threshold of thresholds) {
      const indexed = buildTopicCandidates({ documents, rootById: new Map(), threshold });
      const exhaustive = buildTopicCandidatesExhaustive({ documents, rootById: new Map(), threshold });
      expect(grouping(indexed.candidates), `threshold ${threshold}`)
        .toEqual(grouping(exhaustive));
    }
  });

  it("agrees when every document shares one dominant term", () => {
    // The shape the old index was worst at, and the shape the prefix bound is
    // for: one term in every document, which must not become a posting list the
    // size of the corpus and must not cost a single qualifying pair either.
    const documents = Array.from({ length: 80 }, (_unused, index) =>
      document(`d${index}`, `common common common alpha${index % 4} beta${index % 7} tail${index}`));
    for (const threshold of thresholds) {
      const indexed = buildTopicCandidates({ documents, rootById: new Map(), threshold });
      const exhaustive = buildTopicCandidatesExhaustive({ documents, rootById: new Map(), threshold });
      expect(grouping(indexed.candidates), `threshold ${threshold}`)
        .toEqual(grouping(exhaustive));
    }
  });

  it("agrees when documents have very different vocabulary sizes", () => {
    // The size bound is the other exact filter, and a corpus of uniformly sized
    // documents never exercises it.
    const documents = [
      document("tiny", "alpha beta"),
      document("small", "alpha beta gamma delta"),
      document("medium", Array.from({ length: 20 }, (_u, i) => `alpha beta term${i}`).join(" ")),
      document("large", Array.from({ length: 60 }, (_u, i) => `alpha beta word${i}`).join(" ")),
      document("other", "zeta eta theta iota kappa"),
    ];
    for (const threshold of thresholds) {
      const indexed = buildTopicCandidates({ documents, rootById: new Map(), threshold });
      const exhaustive = buildTopicCandidatesExhaustive({ documents, rootById: new Map(), threshold });
      expect(grouping(indexed.candidates), `threshold ${threshold}`)
        .toEqual(grouping(exhaustive));
    }
  });

  it("agrees on a corpus where nothing groups", () => {
    const documents = Array.from({ length: 40 }, (_unused, index) =>
      document(`d${index}`, `unique${index} words${index} only${index} here${index} nothing${index}`));
    const indexed = buildTopicCandidates({
      documents, rootById: new Map(), threshold: DEFAULT_TOPIC_THRESHOLD,
    });
    expect(indexed.candidates).toEqual([]);
    expect(buildTopicCandidatesExhaustive({
      documents, rootById: new Map(), threshold: DEFAULT_TOPIC_THRESHOLD,
    })).toEqual([]);
    // Nothing was compared, and that is the correct answer rather than a gap:
    // no two of these documents share a salient term, so no pair can reach any
    // positive threshold and the index is right to offer none. The exhaustive
    // pass above agreeing on the empty result is what makes that checkable.
    expect(indexed.pair_work.evaluated_pair_count).toBe(0);
    expect(indexed.pair_work.eligible_document_count).toBe(40);
    expect(indexed.pair_work.exhaustive_pair_count).toBe((40 * 39) / 2);
  });
});

describe("the pair work a topic pass reports", () => {
  it("stays orders of magnitude under comparing everything", () => {
    const documents = structuredCorpus(600, 6);
    const result = buildTopicCandidates({
      documents, rootById: new Map(), threshold: DEFAULT_TOPIC_THRESHOLD,
    });

    const work = result.pair_work;
    expect(work.eligible_document_count).toBe(600);
    expect(work.exhaustive_pair_count).toBe((600 * 599) / 2);
    // The claim, as a number rather than as an adjective.
    expect(work.evaluated_pair_count).toBeLessThan(work.exhaustive_pair_count / 100);
    expect(work.evaluated_pair_count).toBeGreaterThan(0);
    // The boilerplate every document carries never enters the index.
    expect(work.unindexed_term_count).toBeGreaterThan(0);
    expect(work.indexed_posting_count).toBeGreaterThan(0);
    // And it still finds the six subject groups.
    expect(result.candidates).toHaveLength(6);
  });

  it("reports the exhaustive count even when nothing was eligible", () => {
    const short = { ...document("a", "one two"), token_count: TOPIC_MIN_TOKENS - 1 };
    const work = buildTopicCandidates({
      documents: [short, { ...short, virtual_source_id: "b" }], rootById: new Map(),
    }).pair_work;
    expect(work.eligible_document_count).toBe(0);
    expect(work.exhaustive_pair_count).toBe(0);
    expect(work.evaluated_pair_count).toBe(0);
  });

  it("grows sub-quadratically as the corpus doubles", () => {
    // Four sizes, same shape. If the index were quadratic in the corpus the
    // evaluated count would rise by roughly four each doubling; the point of the
    // bound is that it does not.
    const measured = [150, 300, 600, 1200].map((size) => ({
      size,
      evaluated: buildTopicCandidates({
        documents: structuredCorpus(size, 6),
        rootById: new Map(),
        threshold: DEFAULT_TOPIC_THRESHOLD,
      }).pair_work.evaluated_pair_count,
    }));

    for (let i = 1; i < measured.length; i += 1) {
      const previous = measured[i - 1] as { size: number; evaluated: number };
      const current = measured[i] as { size: number; evaluated: number };
      // Doubling the corpus must not more than double the comparisons. A
      // quadratic pass would show ~4x here, which is exactly the regression this
      // test exists to catch.
      expect(current.evaluated / Math.max(1, previous.evaluated), `${previous.size} → ${current.size}`)
        .toBeLessThanOrEqual(2.5);
    }
  });
});
