import type { ArtifactFeatureView } from "./corpus_semantics";
export declare const PAIR_SIGNAL_PROFILE_ID = "corpus-pair-signals/v1";
export declare const PAIR_SIGNAL_PROFILE_VERSION = "1.0.0";
export declare const TITLE_OVERLAP_METHOD = "title-token-jaccard/v1";
export declare const HEADING_OVERLAP_METHOD = "heading-keyphrase-jaccard/v1";
export declare const KEYPHRASE_OVERLAP_METHOD = "keyphrase-weighted-overlap/v1";
export declare const DECLARED_IDENTIFIER_METHOD = "declared-identifier-match/v1";
export declare const EXPLICIT_REFERENCE_METHOD = "explicit-reference/v1";
export declare const DEPENDENCY_OVERLAP_METHOD = "dependency-overlap/v1";
export declare const NEAR_DUPLICATE_METHOD_REF = "text-near-duplicate/v1";
export declare const EXACT_DUPLICATE_METHOD_REF = "content-hash-equality/v1";
export declare const ARCHIVE_CONTEXT_METHOD = "shared-archive-ancestry/v1";
/**
 * Documents a term may appear in and still be used to propose pairs.
 *
 * Above this it is corpus vocabulary rather than a shared subject, and using it
 * as a blocking key costs `n²/2` pairs to learn nothing. Chosen as a flat count
 * rather than a share of the corpus so that behaviour does not change underneath
 * an operator when the corpus grows.
 */
export declare const MAX_POSTINGS_FOR_PAIR_GENERATION = 64;
export type PairSignalKind = "title_overlap" | "heading_overlap" | "keyphrase_overlap" | "declared_identifier_match" | "explicit_reference" | "dependency_overlap" | "near_duplicate" | "exact_duplicate" | "archive_context" | "embedding_similarity";
/**
 * Evidence families.
 *
 * Fusion counts *families*, never signals, because three metrics computed from
 * one document's words are one piece of evidence wearing three hats. This mapping
 * is the whole of that rule.
 */
export type EvidenceFamily = "lexical" | "declared_identity" | "graph" | "semantic_model" | "context";
export declare const SIGNAL_FAMILY: Readonly<Record<PairSignalKind, EvidenceFamily>>;
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
export declare function pairSignalProfileHash(): string;
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
export declare function buildReferenceIndex(views: readonly ArtifactFeatureView[]): ReferenceIndex;
export declare function resolveReference(index: ReferenceIndex, target: string): string | null;
export interface BuildPairsInput {
    views: readonly ArtifactFeatureView[];
    /** Near-duplicate pairs already established by the corpus pass, with scores. */
    nearDuplicatePairs?: readonly {
        artifact_a_id: string;
        artifact_b_id: string;
        score: number;
    }[];
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
export declare function buildSemanticPairs(input: BuildPairsInput): BuildPairsResult;
/**
 * Compare index-generated pairs against exhaustive scoring on the same input.
 *
 * The scalability claim is that blocking loses nothing that matters. That is a
 * claim about a specific corpus, so it is checked rather than argued: score every
 * pair both ways and report which scored pairs the generated set missed.
 */
export declare function referenceFixtureComparison(input: BuildPairsInput): {
    generated: number;
    exhaustive: number;
    missedPairIds: string[];
};
