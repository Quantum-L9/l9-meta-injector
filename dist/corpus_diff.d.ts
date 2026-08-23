import type { CandidateKind } from "./corpus_analysis_manifest";
import type { RootIdentityClass } from "./corpus_roots";
import { CorpusSnapshot } from "./corpus_snapshot";
import type { InferredRootHistoryOverride } from "./corpus_root_history";
export declare const CORPUS_DIFF_SCHEMA = "l9.corpus-diff/v1";
export declare const CORPUS_DIFF_CATEGORIES: readonly ["added", "removed", "changed_content", "renamed_candidate", "unchanged", "archive_added", "archive_removed", "archive_changed", "archive_unchanged"];
/** How each root fared between two snapshots. */
export declare const CORPUS_ROOT_DIFF_CATEGORIES: readonly ["root_added", "root_removed", "root_changed", "root_unchanged"];
export type CorpusRootDiffCategory = (typeof CORPUS_ROOT_DIFF_CATEGORIES)[number];
/** How the analysis over the corpus fared, as distinct from the corpus itself. */
export declare const CORPUS_ANALYSIS_DIFF_CATEGORIES: readonly ["candidate_added", "candidate_removed", "candidate_changed", "readiness_evidence_changed"];
export type CorpusAnalysisDiffCategory = (typeof CORPUS_ANALYSIS_DIFF_CATEGORIES)[number];
export type CorpusDiffCategory = (typeof CORPUS_DIFF_CATEGORIES)[number];
/** Per-document cache layers keyed on a content hash. */
export declare const CONTENT_KEYED_LAYERS: readonly string[];
/** Cache layers keyed on the whole corpus, so any membership change retires them. */
export declare const CORPUS_SCOPED_LAYERS: readonly string[];
export interface CorpusDiffEntry {
    category: CorpusDiffCategory;
    virtual_source_id: string;
    corpus_path: string;
    root_id: string;
    content_hash: string | null;
    previous_content_hash?: string;
    /** Present on `renamed_candidate` only: where the same bytes used to be. */
    previous_corpus_path?: string;
    previous_virtual_source_id?: string;
    size_bytes?: number | null;
}
export interface CorpusDiffInvalidation {
    /** True when the analysis rules changed, which retires every derived layer. */
    profile_changed: boolean;
    /** Content hashes in the corpus now that were not in it before. */
    new_content_hashes: string[];
    /** Content hashes that left the corpus. Their cache entries are kept. */
    retired_content_hashes: string[];
    /** Hashes present in both snapshots: every content-keyed layer is reusable. */
    retained_content_hash_count: number;
    /** Layers that must be recomputed for each new content hash. */
    content_keyed_layers: readonly string[];
    /** Corpus-scope layers retired by this diff, empty when nothing moved. */
    corpus_scoped_layers_invalidated: readonly string[];
    /** Always zero. A departed artifact never causes a cache entry to be deleted. */
    cache_entries_removed: number;
}
/** One root, and what happened to it between the two snapshots. */
export interface CorpusRootDiffEntry {
    category: CorpusRootDiffCategory;
    root_id: string;
    root_key: string;
    /**
     * How much this row's continuity claim is worth.
     *
     * `declared` on both sides: the operator named this root, so "the same root as
     * last run" is a person's statement and the row means what it says.
     *
     * `inferred` on either side: the key is a mount point's final segment. Two
     * runs matching on it are usually the same disk and are not necessarily so —
     * `/Volumes/Backup` and an unrelated `/mnt/usb/Backup` produce the same root
     * id, and nothing in the bytes distinguishes them. The row is still emitted;
     * it is marked, and the diff carries a caution naming it.
     */
    identity_basis: RootIdentityClass | "mixed";
    previous_source_revision: string | null;
    current_source_revision: string | null;
    previous_rmp_packet_id: string | null;
    current_rmp_packet_id: string | null;
}
/**
 * A root matched across two runs on a key nobody declared.
 *
 * Not an error and not a refusal to compare: it is the statement that the
 * comparison rests on a basename. An operator reading "root_unchanged" for a
 * drive they never named is owed the knowledge that the run cannot tell that
 * drive from another one whose path ends the same way, and that declaring a key
 * is what makes the claim solid.
 */
export interface LongitudinalIdentityCaution {
    root_id: string;
    root_key: string;
    previous_class: RootIdentityClass;
    current_class: RootIdentityClass;
    message: string;
}
/**
 * One artifact that moved between roots without changing.
 *
 * A candidate and never a conclusion: identical bytes leaving one root and
 * appearing in another is consistent with a move, with a copy that was then
 * deleted, and with two unrelated files that happen to be identical — which in a
 * corpus of backups is the ordinary case rather than the exotic one.
 */
export interface CrossRootMoveCandidate {
    content_hash: string;
    from_root_id: string;
    from_corpus_path: string;
    to_root_id: string;
    to_corpus_path: string;
}
export declare const CROSS_ROOT_MOVE_STATEMENT: string;
export interface CorpusDiffCounts {
    added: number;
    removed: number;
    changed_content: number;
    renamed_candidate: number;
    unchanged: number;
    archive_added: number;
    archive_removed: number;
    archive_changed: number;
    archive_unchanged: number;
    root_added: number;
    root_removed: number;
    root_changed: number;
    root_unchanged: number;
}
export interface CorpusDiff {
    schema: string;
    previous_corpus_source_snapshot_id: string;
    current_corpus_source_snapshot_id: string;
    previous_corpus_analysis_id: string;
    current_corpus_analysis_id: string;
    /** True when the bytes differ, independently of any analysis-policy change. */
    source_changed: boolean;
    previous_root_ids: string[];
    current_root_ids: string[];
    counts: CorpusDiffCounts;
    roots: CorpusRootDiffEntry[];
    /**
     * Roots compared across runs on an inferred key. Empty when every match was
     * between roots the operator named, which is the case worth aiming for.
     */
    longitudinal_identity_cautions: LongitudinalIdentityCaution[];
    /**
     * The operator's explicit acceptance of an inferred continuity claim.
     *
     * Absent unless `--allow-inferred-root-history` was supplied. A diff carrying
     * cautions and no override was produced from declared keys on at least one
     * side; a diff carrying this was produced because someone said the two disks
     * were the same disk.
     */
    inferred_root_history_override?: InferredRootHistoryOverride;
    /**
     * What changed about the analysis, kept apart from what changed on the disks.
     *
     * The three candidate counts are computed from the two snapshots' analysis
     * manifests when both carry one, and are `null` — with `not_computed_reason`
     * saying why — when either does not. They are never zero as a stand-in for
     * "not computed": three zeros read as "nothing changed" to anyone who does not
     * check a flag first, and that is a claim this diff has no basis to make.
     */
    analysis: {
        candidate_added: number | null;
        candidate_removed: number | null;
        candidate_changed: number | null;
        candidate_unchanged: number | null;
        /** Null exactly when the counts above are real. */
        not_computed_reason: string | null;
        /** The same four counts per candidate kind, so a null cannot hide a category. */
        by_kind: {
            candidate_kind: CandidateKind;
            added: number;
            removed: number;
            changed: number;
            unchanged: number;
        }[];
        readiness_evidence_changed: boolean;
        /**
         * True when the two runs were computed under the same rules over the same
         * bytes, so a candidate difference would be a genuine surprise.
         *
         * Distinct from whether the counts could be computed at all: an incomparable
         * pair of runs still gets real counts when both carry manifests, and the
         * counts are then explained by the profile change rather than doubted.
         */
        comparable: boolean;
    };
    cross_root_move_candidates: CrossRootMoveCandidate[];
    cross_root_move_statement: string;
    entries: CorpusDiffEntry[];
    invalidation: CorpusDiffInvalidation;
    /** Restated in the document so a consumer reading only JSON sees the limit. */
    renamed_candidate_statement: string;
}
export declare const RENAMED_CANDIDATE_STATEMENT: string;
export declare function buildCorpusDiff(previous: CorpusSnapshot, current: CorpusSnapshot): CorpusDiff;
/** Canonical bytes of a diff. */
export declare function renderCorpusDiff(diff: CorpusDiff): string;
