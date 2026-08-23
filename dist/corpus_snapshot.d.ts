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
/** How a root observed. `observed` is the only status a complete corpus allows. */
export declare const CORPUS_OBSERVATION_STATUSES: readonly ["observed", "failed", "missing"];
export type CorpusObservationStatus = (typeof CORPUS_OBSERVATION_STATUSES)[number];
/** How a corpus as a whole observed. */
export declare const CORPUS_STATUSES: readonly ["complete", "partial", "failed"];
export type CorpusStatus = (typeof CORPUS_STATUSES)[number];
/**
 * A root inside a snapshot: its identity, plus its own Repository Model Packet.
 *
 * The packet id is here because it is what makes the corpus source identity
 * checkable. A corpus that recorded only the roots' content hashes would say two
 * runs saw the same bytes; recording the packet each root produced says they also
 * modelled them the same way, which is the claim a consumer actually depends on.
 */
export interface CorpusSnapshotRoot extends CorpusRootIdentity {
    /** Packet id of this root's own RMP. Empty when the root did not observe. */
    rmp_packet_id: string;
    rmp_semantic_hash: string;
    /** Output-relative location of the root's bundle. Never absolute. */
    bundle_ref: string | null;
    observation_status: CorpusObservationStatus;
    /** Why the root did not observe. Null whenever it did. */
    failure_reason: string | null;
}
/** The analysis policies a snapshot's derived layers were computed under. */
export interface CorpusAnalysisIdentity {
    corpus_analysis_id: string;
    corpus_profile: string;
    document_decoder_profiles: string[];
    interpretation_profile: string;
    semantic_candidate_profile: string;
    embedding_profile: string | null;
    readiness_profile: string;
}
export interface CorpusSnapshot {
    schema: string;
    /** Operator's name for this corpus. A label: it enters no identity. */
    corpus_id: string;
    /** Identity of what the disks held. Excludes every analysis profile. */
    corpus_source_snapshot_id: string;
    /** Identity of what was concluded from them, and under which rules. */
    analysis: CorpusAnalysisIdentity;
    corpus_status: CorpusStatus;
    /** Roots the operator asked for but that did not observe. */
    missing_root_ids: string[];
    roots: CorpusSnapshotRoot[];
    artifacts: CorpusSnapshotArtifact[];
    archives: CorpusSnapshotArchive[];
    counts: {
        root_count_requested: number;
        root_count_observed: number;
        root_count_failed: number;
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
