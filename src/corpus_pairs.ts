// corpus_pairs.ts — what two artifacts have in common, one signal at a time.
//
// The unit here is a pair and a list of independently-computed signals about it.
// Nothing in this module decides what a pair *means*: it measures title overlap,
// keyphrase overlap, whether one document explicitly names the other, whether two
// manifests declare the same identifier, and it stops. Fusion is a separate pass
// with a separate profile, because the measurement should stay stable when the
// policy for reading it changes.
//
// Two things dominate the design.
//
// The first is that all-pairs does not scale. Ten thousand artifacts is fifty
// million pairs, and almost all of them share nothing. So pairs are *generated*
// from inverted indexes — artifacts that share a keyphrase, a title token, a
// declared identifier, a reference, or a near-duplicate edge — and only generated
// pairs are scored. A pair no index proposes is not scored, and is therefore
// absent rather than zero. `referenceFixtureComparison` exists to prove the
// generated set matches the exhaustive set on a corpus small enough to compute
// both.
//
// The second is that a common term is a bad blocking key. A word in four thousand
// documents proposes eight million pairs on its own and discriminates nothing, so
// terms above a posting ceiling are skipped for *generation*. They still count
// toward a score once a pair exists on other grounds. The skip is reported rather
// than silent: a cap nobody can see reads as coverage nobody has.
import { normalizeForAnalysis } from "./corpus_analysis";
import { canonicalPair, compareCodePoints } from "./ordering";
import { stableId } from "./repository_model";
import type { ArtifactFeatureView } from "./corpus_semantics";

export const PAIR_SIGNAL_PROFILE_ID = "corpus-pair-signals/v1";
export const PAIR_SIGNAL_PROFILE_VERSION = "1.0.0";

export const TITLE_OVERLAP_METHOD = "title-token-jaccard/v1";
export const HEADING_OVERLAP_METHOD = "heading-keyphrase-jaccard/v1";
export const KEYPHRASE_OVERLAP_METHOD = "keyphrase-weighted-overlap/v1";
export const DECLARED_IDENTIFIER_METHOD = "declared-identifier-match/v1";
export const EXPLICIT_REFERENCE_METHOD = "explicit-reference/v1";
export const DEPENDENCY_OVERLAP_METHOD = "dependency-overlap/v1";
export const NEAR_DUPLICATE_METHOD_REF = "text-near-duplicate/v1";
export const EXACT_DUPLICATE_METHOD_REF = "content-hash-equality/v1";
export const ARCHIVE_CONTEXT_METHOD = "shared-archive-ancestry/v1";

/**
 * Documents a term may appear in and still be used to propose pairs.
 *
 * Above this it is corpus vocabulary rather than a shared subject, and using it
 * as a blocking key costs `n²/2` pairs to learn nothing. Chosen as a flat count
 * rather than a share of the corpus so that behaviour does not change underneath
 * an operator when the corpus grows.
 */
export const MAX_POSTINGS_FOR_PAIR_GENERATION = 64;

/** Decimal places every reported score is rounded to, so replays are byte-identical. */
const SCORE_PRECISION = 6;

function round(value: number): number {
  return Math.round(value * 10 ** SCORE_PRECISION) / 10 ** SCORE_PRECISION;
}

export type PairSignalKind =
  | "title_overlap"
  | "heading_overlap"
  | "keyphrase_overlap"
  | "declared_identifier_match"
  | "explicit_reference"
  | "dependency_overlap"
  | "near_duplicate"
  | "exact_duplicate"
  | "archive_context"
  | "embedding_similarity";

/**
 * Evidence families.
 *
 * Fusion counts *families*, never signals, because three metrics computed from
 * one document's words are one piece of evidence wearing three hats. This mapping
 * is the whole of that rule.
 */
export type EvidenceFamily = "lexical" | "declared_identity" | "graph" | "semantic_model" | "context";

export const SIGNAL_FAMILY: Readonly<Record<PairSignalKind, EvidenceFamily>> = {
  title_overlap: "lexical",
  heading_overlap: "lexical",
  keyphrase_overlap: "lexical",
  near_duplicate: "lexical",
  exact_duplicate: "lexical",
  declared_identifier_match: "declared_identity",
  explicit_reference: "graph",
  dependency_overlap: "graph",
  embedding_similarity: "semantic_model",
  archive_context: "context",
};

export interface PairSignal {
  kind: PairSignalKind;
  method: string;
  /** Score in [0,1] for graded signals; 1 for a categorical signal that fired. */
  score: number;
  /** True when the signal is a yes/no rather than a measurement. */
  categorical: boolean;
  /** True only for exact duplication, which is the one decidable signal here. */
  fact: boolean;
  /** What the signal was computed over: shared terms, the matched identifier, … */
  detail: string[];
}

export interface SemanticPair {
  pair_id: string;
  artifact_a_id: string;
  artifact_b_id: string;
  signals: PairSignal[];
  /** Assertion ids justifying the graph and lexical signals. */
  evidence_refs: string[];
  analysis_profile: {
    pair_signal_profile_id: string;
    pair_signal_profile_version: string;
    pair_signal_profile_hash: string;
  };
}

/** An embedding-derived score for one pair, supplied by the optional embedding pass. */
export interface EmbeddingPairScore {
  artifact_a_id: string;
  artifact_b_id: string;
  /** Cosine similarity, already bounded and rounded by the embedding module. */
  score: number;
}

export interface PairGenerationDiagnostic {
  code: string;
  severity: "info" | "warning";
  message: string;
}

export interface BuildPairsResult {
  pairs: SemanticPair[];
  diagnostics: PairGenerationDiagnostic[];
  /** How the candidate set was reached, so a reader can judge its coverage. */
  generation: {
    artifact_count: number;
    generated_pair_count: number;
    scored_pair_count: number;
    exhaustive_pair_count: number;
    /** Terms too common to use as a blocking key, and how many were skipped. */
    skipped_high_frequency_terms: number;
    posting_ceiling: number;
  };
}

export function pairSignalProfileHash(): string {
  return stableId("pair-signal-profile", {
    archive_context_method: ARCHIVE_CONTEXT_METHOD,
    declared_identifier_method: DECLARED_IDENTIFIER_METHOD,
    dependency_overlap_method: DEPENDENCY_OVERLAP_METHOD,
    exact_duplicate_method: EXACT_DUPLICATE_METHOD_REF,
    explicit_reference_method: EXPLICIT_REFERENCE_METHOD,
    heading_overlap_method: HEADING_OVERLAP_METHOD,
    keyphrase_overlap_method: KEYPHRASE_OVERLAP_METHOD,
    near_duplicate_method: NEAR_DUPLICATE_METHOD_REF,
    posting_ceiling: MAX_POSTINGS_FOR_PAIR_GENERATION,
    profile_id: PAIR_SIGNAL_PROFILE_ID,
    profile_version: PAIR_SIGNAL_PROFILE_VERSION,
    title_overlap_method: TITLE_OVERLAP_METHOD,
  });
}

// ───────────────────────────── scoring primitives ─────────────────────────────

function jaccardOf(left: readonly string[], right: readonly string[]): { score: number; shared: string[] } {
  if (left.length === 0 || right.length === 0) return { score: 0, shared: [] };
  const a = new Set(left);
  const b = new Set(right);
  const shared: string[] = [];
  for (const value of a) {
    if (b.has(value)) shared.push(value);
  }
  const union = new Set([...a, ...b]).size;
  return {
    score: union === 0 ? 0 : round(shared.length / union),
    shared: shared.sort(compareCodePoints),
  };
}

/**
 * Weighted keyphrase overlap.
 *
 * The shared terms are scored by the weight each document gave them, so two
 * documents that both consider a term central count for more than two that both
 * mention it in passing. Normalized by the total weight available on the lighter
 * side, which keeps a short document able to match a long one.
 */
function keyphraseOverlap(
  a: ArtifactFeatureView,
  b: ArtifactFeatureView,
): { score: number; shared: string[] } {
  const left = new Map(a.keyphrases.map((k) => [k.normalized_term, k.weight]));
  const right = new Map(b.keyphrases.map((k) => [k.normalized_term, k.weight]));
  if (left.size === 0 || right.size === 0) return { score: 0, shared: [] };

  let sharedWeight = 0;
  const shared: string[] = [];
  for (const [term, weight] of left) {
    const other = right.get(term);
    if (other === undefined) continue;
    sharedWeight += Math.min(weight, other);
    shared.push(term);
  }
  if (shared.length === 0) return { score: 0, shared: [] };

  const leftTotal = [...left.values()].reduce((sum, w) => sum + w, 0);
  const rightTotal = [...right.values()].reduce((sum, w) => sum + w, 0);
  const denominator = Math.min(leftTotal, rightTotal);
  return {
    score: denominator === 0 ? 0 : round(Math.min(1, sharedWeight / denominator)),
    shared: shared.sort(compareCodePoints),
  };
}

/** Shared enclosing archives, outermost first. */
function sharedAncestry(a: ArtifactFeatureView, b: ArtifactFeatureView): string[] {
  const right = new Set(b.archive_ancestry);
  return a.archive_ancestry.filter((entry) => right.has(entry));
}

// ───────────────────────────── reference resolution ─────────────────────────────

/**
 * Which artifacts a written reference could mean.
 *
 * A reference is prose: `docs/a.md`, `./a.md`, or just `a.md`. Exact
 * root-relative match wins. Failing that, a basename match counts only when it is
 * unique in the corpus — two files called `README.md` make the reference
 * ambiguous, and an ambiguous reference is no evidence at all.
 */
export interface ReferenceIndex {
  byPath: Map<string, string[]>;
  byBasename: Map<string, string[]>;
}

export function buildReferenceIndex(views: readonly ArtifactFeatureView[]): ReferenceIndex {
  const byPath = new Map<string, string[]>();
  const byBasename = new Map<string, string[]>();
  for (const view of views) {
    const normalized = normalizeForAnalysis(view.root_relative_path).trim();
    const existing = byPath.get(normalized) ?? [];
    existing.push(view.artifact_id);
    byPath.set(normalized, existing);

    const basename = normalized.split("/").pop() ?? normalized;
    const byName = byBasename.get(basename) ?? [];
    byName.push(view.artifact_id);
    byBasename.set(basename, byName);
  }
  return { byPath, byBasename };
}

export function resolveReference(index: ReferenceIndex, target: string): string | null {
  const exact = index.byPath.get(target);
  if (exact !== undefined && exact.length === 1) return exact[0] as string;
  // A path that resolves to several artifacts (the same relative path on two
  // roots) is not a reference to one of them.
  if (exact !== undefined && exact.length > 1) return null;

  const basename = target.split("/").pop() ?? target;
  const byName = index.byBasename.get(basename);
  if (byName !== undefined && byName.length === 1) return byName[0] as string;
  return null;
}

// ───────────────────────────── candidate generation ─────────────────────────────

function addPosting(index: Map<string, string[]>, key: string, artifactId: string): void {
  const existing = index.get(key) ?? [];
  existing.push(artifactId);
  index.set(key, existing);
}

function pairsFromIndex(
  index: Map<string, string[]>,
  out: Set<string>,
  ceiling: number,
): number {
  let skipped = 0;
  for (const postings of index.values()) {
    if (postings.length < 2) continue;
    if (postings.length > ceiling) {
      skipped += 1;
      continue;
    }
    const ordered = [...postings].sort(compareCodePoints);
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const [a, b] = canonicalPair(ordered[i] as string, ordered[j] as string);
        out.add(`${a} ${b}`);
      }
    }
  }
  return skipped;
}

export interface BuildPairsInput {
  views: readonly ArtifactFeatureView[];
  /** Near-duplicate pairs already established by the corpus pass, with scores. */
  nearDuplicatePairs?: readonly { artifact_a_id: string; artifact_b_id: string; score: number }[];
  /** Cosine scores from the optional embedding pass. Absent when embeddings are off. */
  embeddingPairs?: readonly EmbeddingPairScore[];
  /** Exhaustive scoring, for the reference fixture comparison only. */
  exhaustive?: boolean;
}

/**
 * Score every pair some index proposes.
 *
 * Ordering is by pair id so the output is stable; scoring is independent per
 * pair, so the generated set decides coverage and nothing else does.
 */
export function buildSemanticPairs(input: BuildPairsInput): BuildPairsResult {
  const views = [...input.views].sort((a, b) => compareCodePoints(a.artifact_id, b.artifact_id));
  const byId = new Map(views.map((view) => [view.artifact_id, view]));
  const profileHash = pairSignalProfileHash();
  const diagnostics: PairGenerationDiagnostic[] = [];

  const keyphraseIndex = new Map<string, string[]>();
  const titleIndex = new Map<string, string[]>();
  const identifierIndex = new Map<string, string[]>();
  const duplicateIndex = new Map<string, string[]>();
  for (const view of views) {
    for (const keyphrase of view.keyphrases) addPosting(keyphraseIndex, keyphrase.normalized_term, view.artifact_id);
    for (const token of view.normalized_title_tokens) addPosting(titleIndex, token, view.artifact_id);
    for (const identifier of view.declared_project_identifiers) addPosting(identifierIndex, identifier, view.artifact_id);
    if (view.exact_duplicate_cluster_id !== null) {
      addPosting(duplicateIndex, view.exact_duplicate_cluster_id, view.artifact_id);
    }
  }

  const generated = new Set<string>();
  let skippedTerms = 0;
  if (input.exhaustive === true) {
    for (let i = 0; i < views.length; i += 1) {
      for (let j = i + 1; j < views.length; j += 1) {
        const [a, b] = canonicalPair(
          (views[i] as ArtifactFeatureView).artifact_id,
          (views[j] as ArtifactFeatureView).artifact_id,
        );
        generated.add(`${a} ${b}`);
      }
    }
  } else {
    skippedTerms += pairsFromIndex(keyphraseIndex, generated, MAX_POSTINGS_FOR_PAIR_GENERATION);
    skippedTerms += pairsFromIndex(titleIndex, generated, MAX_POSTINGS_FOR_PAIR_GENERATION);
    // Declared identifiers and duplicate clusters are identity, not vocabulary:
    // no ceiling applies, because a large cluster is exactly the case that matters.
    pairsFromIndex(identifierIndex, generated, Number.MAX_SAFE_INTEGER);
    pairsFromIndex(duplicateIndex, generated, Number.MAX_SAFE_INTEGER);

    const referenceIndex = buildReferenceIndex(views);
    for (const view of views) {
      const targets = [...view.normalized_reference_targets, ...view.declared_dependencies];
      for (const target of targets) {
        const resolved = resolveReference(referenceIndex, target);
        if (resolved === null || resolved === view.artifact_id) continue;
        const [a, b] = canonicalPair(view.artifact_id, resolved);
        generated.add(`${a} ${b}`);
      }
      for (const declaration of view.supersession_declarations) {
        const resolved = resolveReference(referenceIndex, declaration.object);
        if (resolved === null || resolved === view.artifact_id) continue;
        const [a, b] = canonicalPair(view.artifact_id, resolved);
        generated.add(`${a} ${b}`);
      }
    }
    for (const near of input.nearDuplicatePairs ?? []) {
      const [a, b] = canonicalPair(near.artifact_a_id, near.artifact_b_id);
      generated.add(`${a} ${b}`);
    }
    for (const embedding of input.embeddingPairs ?? []) {
      const [a, b] = canonicalPair(embedding.artifact_a_id, embedding.artifact_b_id);
      generated.add(`${a} ${b}`);
    }
  }

  if (skippedTerms > 0) {
    diagnostics.push({
      code: "corpus.pair_generation.high_frequency_terms_skipped",
      severity: "info",
      message:
        `${skippedTerms} term(s) appear in more than ${MAX_POSTINGS_FOR_PAIR_GENERATION} documents and `
        + "were not used to propose pairs; they still contribute to the score of pairs proposed on "
        + "other grounds",
    });
  }

  const nearByPair = new Map<string, number>();
  for (const near of input.nearDuplicatePairs ?? []) {
    const [a, b] = canonicalPair(near.artifact_a_id, near.artifact_b_id);
    nearByPair.set(`${a} ${b}`, near.score);
  }
  const embeddingByPair = new Map<string, number>();
  for (const embedding of input.embeddingPairs ?? []) {
    const [a, b] = canonicalPair(embedding.artifact_a_id, embedding.artifact_b_id);
    embeddingByPair.set(`${a} ${b}`, embedding.score);
  }
  const referenceIndex = buildReferenceIndex(views);

  const pairs: SemanticPair[] = [];
  for (const key of generated) {
    const [aId, bId] = key.split(" ") as [string, string];
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (a === undefined || b === undefined) continue;

    const signals: PairSignal[] = [];
    const evidenceRefs = new Set<string>();

    const title = jaccardOf(a.normalized_title_tokens, b.normalized_title_tokens);
    if (title.score > 0) {
      signals.push({
        kind: "title_overlap", method: TITLE_OVERLAP_METHOD, score: title.score,
        categorical: false, fact: false, detail: title.shared,
      });
    }
    const heading = jaccardOf(a.normalized_heading_tokens, b.normalized_heading_tokens);
    if (heading.score > 0) {
      signals.push({
        kind: "heading_overlap", method: HEADING_OVERLAP_METHOD, score: heading.score,
        categorical: false, fact: false, detail: heading.shared,
      });
    }
    const keyphrase = keyphraseOverlap(a, b);
    if (keyphrase.score > 0) {
      signals.push({
        kind: "keyphrase_overlap", method: KEYPHRASE_OVERLAP_METHOD, score: keyphrase.score,
        categorical: false, fact: false, detail: keyphrase.shared,
      });
    }

    const identifiers = jaccardOf(a.declared_project_identifiers, b.declared_project_identifiers);
    if (identifiers.shared.length > 0) {
      signals.push({
        kind: "declared_identifier_match", method: DECLARED_IDENTIFIER_METHOD, score: 1,
        categorical: true, fact: false, detail: identifiers.shared,
      });
    }

    const referenceDetail: string[] = [];
    for (const [from, to] of [[a, b], [b, a]] as const) {
      for (const target of from.normalized_reference_targets) {
        if (resolveReference(referenceIndex, target) === to.artifact_id) {
          referenceDetail.push(`${from.artifact_id} references ${target}`);
        }
      }
      for (const declaration of from.supersession_declarations) {
        if (resolveReference(referenceIndex, declaration.object) === to.artifact_id) {
          referenceDetail.push(`${from.artifact_id} ${declaration.predicate} ${declaration.object}`);
          evidenceRefs.add(declaration.assertion_id);
        }
      }
    }
    if (referenceDetail.length > 0) {
      signals.push({
        kind: "explicit_reference", method: EXPLICIT_REFERENCE_METHOD, score: 1,
        categorical: true, fact: false, detail: referenceDetail.sort(compareCodePoints),
      });
    }

    const dependencies = jaccardOf(a.declared_dependencies, b.declared_dependencies);
    if (dependencies.score > 0) {
      signals.push({
        kind: "dependency_overlap", method: DEPENDENCY_OVERLAP_METHOD, score: dependencies.score,
        categorical: false, fact: false, detail: dependencies.shared,
      });
    }

    const nearScore = nearByPair.get(key);
    if (nearScore !== undefined) {
      signals.push({
        kind: "near_duplicate", method: NEAR_DUPLICATE_METHOD_REF, score: round(nearScore),
        categorical: false, fact: false, detail: [],
      });
    }

    const isExactDuplicate = a.exact_duplicate_cluster_id !== null
      && a.exact_duplicate_cluster_id === b.exact_duplicate_cluster_id;
    if (isExactDuplicate) {
      signals.push({
        kind: "exact_duplicate", method: EXACT_DUPLICATE_METHOD_REF, score: 1,
        categorical: true, fact: true, detail: [a.exact_duplicate_cluster_id as string],
      });
    }

    const embeddingScore = embeddingByPair.get(key);
    if (embeddingScore !== undefined) {
      signals.push({
        kind: "embedding_similarity", method: "cosine/v1", score: round(embeddingScore),
        categorical: false, fact: false, detail: [],
      });
    }

    const ancestry = sharedAncestry(a, b);
    if (ancestry.length > 0) {
      signals.push({
        kind: "archive_context", method: ARCHIVE_CONTEXT_METHOD, score: 1,
        categorical: true, fact: false, detail: ancestry,
      });
    }

    if (signals.length === 0) continue;

    // Only signals that fired contribute to identity, so a pair's id does not
    // change when an unrelated signal is added to a later version of this module.
    const pairId = stableId("semantic-pair", {
      artifact_a_id: aId,
      artifact_b_id: bId,
      feature_identities: [a.normalized_document_id ?? a.content_hash ?? aId,
        b.normalized_document_id ?? b.content_hash ?? bId].sort(compareCodePoints),
      pair_signal_profile_hash: profileHash,
      // Scores are fixed-precision strings here, never floats: the canonical
      // hasher refuses non-integer numbers precisely because float repr differs
      // between runtimes, and an identity that did that would not be stable.
      signals: signals.map((signal) => ({ kind: signal.kind, score: signal.score.toFixed(6) })),
    });

    pairs.push({
      pair_id: pairId,
      artifact_a_id: aId,
      artifact_b_id: bId,
      signals: signals.sort((x, y) => compareCodePoints(x.kind, y.kind)),
      evidence_refs: [...evidenceRefs].sort(compareCodePoints),
      analysis_profile: {
        pair_signal_profile_id: PAIR_SIGNAL_PROFILE_ID,
        pair_signal_profile_version: PAIR_SIGNAL_PROFILE_VERSION,
        pair_signal_profile_hash: profileHash,
      },
    });
  }

  pairs.sort(
    (x, y) => compareCodePoints(x.artifact_a_id, y.artifact_a_id)
      || compareCodePoints(x.artifact_b_id, y.artifact_b_id),
  );

  return {
    pairs,
    diagnostics,
    generation: {
      artifact_count: views.length,
      generated_pair_count: generated.size,
      scored_pair_count: pairs.length,
      exhaustive_pair_count: (views.length * (views.length - 1)) / 2,
      skipped_high_frequency_terms: skippedTerms,
      posting_ceiling: MAX_POSTINGS_FOR_PAIR_GENERATION,
    },
  };
}

/**
 * Compare index-generated pairs against exhaustive scoring on the same input.
 *
 * The scalability claim is that blocking loses nothing that matters. That is a
 * claim about a specific corpus, so it is checked rather than argued: score every
 * pair both ways and report which scored pairs the generated set missed.
 */
export function referenceFixtureComparison(input: BuildPairsInput): {
  generated: number;
  exhaustive: number;
  missedPairIds: string[];
} {
  const blocked = buildSemanticPairs({ ...input, exhaustive: false });
  const full = buildSemanticPairs({ ...input, exhaustive: true });
  const seen = new Set(blocked.pairs.map((pair) => `${pair.artifact_a_id} ${pair.artifact_b_id}`));
  const missed = full.pairs
    .filter((pair) => !seen.has(`${pair.artifact_a_id} ${pair.artifact_b_id}`))
    .map((pair) => pair.pair_id)
    .sort(compareCodePoints);
  return { generated: blocked.pairs.length, exhaustive: full.pairs.length, missedPairIds: missed };
}
