import { CorpusRootIdentity } from "./corpus_roots";
export declare const CORPUS_SNAPSHOT_SCHEMA = "l9.corpus-snapshot/v1";
export interface CorpusSnapshotArtifact {
    virtual_source_id: string;
    corpus_path: string;
    root_id: string;
    root_relative_path: string;
    content_hash: string | null;
    size_bytes: number | null;
    is_archive_member: boolean;
    artifact_type: string;
    /** Size and mtime, for the next run's scheduling hint. Never an identity. */
    stat_precheck?: {
        size_bytes: number;
        mtime_ms: number;
    };
}
export interface CorpusSnapshotArchive {
    archive_id: string;
    corpus_path: string;
    root_id: string;
    content_hash: string;
    size_bytes: number;
    member_count: number;
    expanded: boolean;
}
export interface CorpusSnapshot {
    schema: string;
    corpus_snapshot_id: string;
    corpus_profile_hash: string;
    roots: CorpusRootIdentity[];
    artifacts: CorpusSnapshotArtifact[];
    archives: CorpusSnapshotArchive[];
    counts: {
        root_count: number;
        artifact_count: number;
        archive_count: number;
        archive_member_count: number;
        total_bytes: number;
    };
}
/** Order a snapshot's contents so two equal corpora render identically. */
export declare function orderCorpusSnapshot(snapshot: CorpusSnapshot): CorpusSnapshot;
/** Canonical bytes of a snapshot. */
export declare function renderCorpusSnapshot(snapshot: CorpusSnapshot): string;
/** Read a snapshot written by an earlier run, refusing anything else. */
export declare function readCorpusSnapshot(snapshotPath: string): CorpusSnapshot;
/** The stat prechecks in a snapshot, keyed by virtual source id. */
export declare function snapshotPrechecks(snapshot: CorpusSnapshot): Map<string, {
    size_bytes: number;
    mtime_ms: number;
}>;
