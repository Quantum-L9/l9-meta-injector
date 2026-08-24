import { CorpusRootIdentity } from "./corpus_roots";
import type { CorpusAnalysisManifest } from "./corpus_analysis_manifest";
import type { DocumentWorkSignalsRef } from "./corpus_work_signal_export";
import type { InferredRootHistoryOverride } from "./corpus_root_history";
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
    /**
     * Size and mtime as this run saw them. Never an identity, and never content
     * truth: it is what `--incremental` revalidates against on the next run.
     */
    stat_precheck?: {
        size_bytes: number;
        mtime_ms: number;
        mtime_ns?: string;
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
/**
 * How this run established the hashes it reports.
 *
 * `fully_verified` means every byte was read on this run. `cached_unchanged_assumption`
 * means at least one hash was carried over from a previous run because size and
 * mtime had not moved — a revalidation signal, not content truth. The two are
 * separate words because collapsing them would let a stat-assisted scan be read
 * as a byte-verified one, which is the one claim this whole layer exists to keep
 * honest.
 */
export declare const VERIFICATION_CLASSES: readonly ["fully_verified", "cached_unchanged_assumption"];
export type VerificationClass = (typeof VERIFICATION_CLASSES)[number];
/** What the operator asked for, as distinct from what was achieved. */
export declare const VERIFICATION_MODES: readonly ["full", "incremental"];
export type VerificationMode = (typeof VERIFICATION_MODES)[number];
export interface CorpusVerification {
    mode: VerificationMode;
    /** True when `--verify-content` forced a full read regardless of mode. */
    verify_content_requested: boolean;
    verification_class: VerificationClass;
    fully_rehashed_artifact_count: number;
    cached_hash_reuse_count: number;
    unhashed_artifact_count: number;
    statement: string;
}
export declare const FULLY_VERIFIED_STATEMENT: string;
export declare const CACHED_ASSUMPTION_STATEMENT: string;
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
    /** Rules read over decoded blocks, for the formats that have no line numbers. */
    document_block_profile: string;
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
    /**
     * The candidates this run produced, by id and payload hash.
     *
     * Absent on a snapshot written before manifests existed, which is why the
     * field is optional and why `buildCorpusDiff` reports `null` rather than zero
     * when it is missing. It enters neither identity: `corpus_source_snapshot_id`
     * is about the disks and `corpus_analysis_id` is about the rules, and this is
     * about the conclusions, which are a function of both.
     */
    analysis_manifest?: CorpusAnalysisManifest;
    /**
     * Where the complete document work-signal payload is, and what it should be.
     *
     * A reference rather than the records: the payload is a separate file in the
     * same generation precisely because it can be large, and copying it into the
     * snapshot would defeat that. The record count and the two hashes are enough
     * for a reader holding this snapshot to tell whether the payload beside it is
     * the one this run produced.
     */
    document_work_signals?: DocumentWorkSignalsRef;
    /**
     * What the operator authorized about this run, as distinct from what was seen.
     *
     * Absent unless something was authorized. It enters no identity:
     * `corpus_source_snapshot_id` is about the bytes on the disks, and an operator
     * accepting a weaker continuity claim changes the strength of a claim about
     * history rather than the bytes this run observed.
     */
    operational_provenance?: {
        inferred_root_history_override?: InferredRootHistoryOverride;
    };
    corpus_status: CorpusStatus;
    /** How the hashes in this snapshot were established. */
    verification: CorpusVerification;
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
