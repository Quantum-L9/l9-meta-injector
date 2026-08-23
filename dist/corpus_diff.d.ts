import { CorpusSnapshot } from "./corpus_snapshot";
export declare const CORPUS_DIFF_SCHEMA = "l9.corpus-diff/v1";
export declare const CORPUS_DIFF_CATEGORIES: readonly ["added", "removed", "changed_content", "renamed_candidate", "unchanged", "archive_added", "archive_removed", "archive_changed"];
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
export interface CorpusDiffCounts {
    added: number;
    removed: number;
    changed_content: number;
    renamed_candidate: number;
    unchanged: number;
    archive_added: number;
    archive_removed: number;
    archive_changed: number;
}
export interface CorpusDiff {
    schema: string;
    previous_corpus_snapshot_id: string;
    current_corpus_snapshot_id: string;
    previous_root_ids: string[];
    current_root_ids: string[];
    counts: CorpusDiffCounts;
    entries: CorpusDiffEntry[];
    invalidation: CorpusDiffInvalidation;
    /** Restated in the document so a consumer reading only JSON sees the limit. */
    renamed_candidate_statement: string;
}
export declare const RENAMED_CANDIDATE_STATEMENT: string;
/** Classify a current snapshot against a previous one. */
export declare function buildCorpusDiff(previous: CorpusSnapshot, current: CorpusSnapshot): CorpusDiff;
/** Canonical bytes of a diff. */
export declare function renderCorpusDiff(diff: CorpusDiff): string;
