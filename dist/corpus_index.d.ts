import type { CorpusSnapshot } from "./corpus_snapshot";
export declare const CORPUS_INDEX_SCHEMA = "l9.corpus-index/v1";
/** One root, as the index points at it. */
export interface CorpusIndexRoot {
    root_id: string;
    root_key: string;
    source_kind: string;
    source_revision: string;
    rmp_packet_id: string;
    rmp_semantic_hash: string;
    bundle_ref: string | null;
    document_index_ref: string | null;
    document_coverage_ref: string | null;
    acquisition_manifest_ref: string | null;
    observation_status: string;
    failure_reason: string | null;
    artifact_count: number;
    archive_count: number;
    total_bytes: number;
}
/** A document this run wrote, named so a consumer does not have to guess. */
export interface CorpusIndexArtifactRef {
    name: string;
    path: string;
    schema: string | null;
    present: boolean;
}
export interface CorpusIndex {
    schema: string;
    corpus_id: string;
    corpus_source_snapshot_id: string;
    corpus_analysis_id: string;
    corpus_status: string;
    roots: CorpusIndexRoot[];
    missing_root_ids: string[];
    counts: CorpusSnapshot["counts"];
    documents: CorpusIndexArtifactRef[];
    statement: string;
}
export declare const CORPUS_INDEX_STATEMENT: string;
export interface BuildCorpusIndexInput {
    snapshot: CorpusSnapshot;
    /** Root-directory name for each root id, as written under `roots/`. */
    rootDirectories: ReadonlyMap<string, string>;
    /** Output-relative paths this run actually wrote. */
    writtenPaths: readonly string[];
}
export declare function buildCorpusIndex(input: BuildCorpusIndexInput): CorpusIndex;
/** Canonical bytes of the index. */
export declare function renderCorpusIndex(index: CorpusIndex): string;
/** The same index, rendered for a person. */
export declare function renderCorpusIndexReport(index: CorpusIndex): string;
