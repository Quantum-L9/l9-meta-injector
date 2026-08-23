export declare const CANDIDATE_KINDS: readonly ["exact_duplicate_cluster", "near_duplicate", "topic", "project"];
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];
export interface AnalysisManifestEntry {
    candidate_id: string;
    candidate_kind: CandidateKind;
    /** Hash over what the candidate claims, not over how it was written down. */
    semantic_payload_hash: string;
}
export interface CorpusAnalysisManifest {
    /** Bumped when the payload definition changes, so old hashes are not compared. */
    manifest_version: string;
    entries: AnalysisManifestEntry[];
    counts: Record<CandidateKind, number>;
}
export declare const ANALYSIS_MANIFEST_VERSION = "1.0.0";
/** The candidate shapes this manifest is built from, narrowed to what it reads. */
export interface ManifestInput {
    exactDuplicateClusters: readonly {
        cluster_id: string;
        content_hash: string;
        artifact_ids: readonly string[];
    }[];
    nearDuplicates: readonly {
        candidate_id: string;
        artifact_a_id: string;
        artifact_b_id: string;
        score: number;
    }[];
    topics: readonly {
        candidate_id: string;
        member_ids: readonly string[];
        shared_terms: readonly string[];
    }[];
    projects: readonly {
        candidate_id: string;
        project_key: string;
        identifier_is_declared: boolean;
        member_ids: readonly string[];
    }[];
}
/** Build the manifest a run writes into its snapshot. */
export declare function buildAnalysisManifest(input: ManifestInput): CorpusAnalysisManifest;
/** The three real numbers, or three nulls when there is nothing to compare. */
export interface CandidateDelta {
    candidate_added: number | null;
    candidate_removed: number | null;
    candidate_changed: number | null;
    candidate_unchanged: number | null;
    /**
     * Why the numbers are null, when they are. Empty when they are real.
     *
     * A reader meeting `null` is owed the reason: a snapshot from before manifests
     * existed and a snapshot whose manifest used an incompatible payload
     * definition are different situations, and only one of them is fixed by
     * re-running.
     */
    not_computed_reason: string | null;
    /** Kinds present in either manifest, so a null cannot hide a whole category. */
    by_kind: {
        candidate_kind: CandidateKind;
        added: number;
        removed: number;
        changed: number;
        unchanged: number;
    }[];
}
/**
 * Diff two analysis manifests.
 *
 * Missing on either side is `null` with a reason, never zero: a run that cannot
 * compare has not found that nothing changed.
 */
export declare function diffAnalysisManifests(previous: CorpusAnalysisManifest | null | undefined, current: CorpusAnalysisManifest | null | undefined): CandidateDelta;
