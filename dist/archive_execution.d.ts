import { ArchivePreflightResult, PreflightMember } from "./archive_preflight";
import { ArchiveSessionBudget, LocalArchivePolicy } from "./local_archive_policy";
import { ZipDirectory } from "./zip_reader";
/**
 * Version of the canonical ZIP reader and preflight whose verdict this context carries.
 *
 * Bumped whenever an admission rule changes, because a warm archive-manifest
 * verdict is keyed on it: 1.1.0 added the file/directory path-conflict rule, and
 * an archive accepted under 1.0.0 may be held under 1.1.0.
 */
export declare const ARCHIVE_READER_VERSION = "1.1.0";
/**
 * Expected refusal caused by archive/resource policy, not a host/tool failure.
 * The local-files orchestrator converts only this class (plus canonical ZIP
 * format/budget errors) into ArchiveRecord.heldReason; filesystem and invariant
 * failures continue to throw so they cannot masquerade as hostile input.
 */
export declare class ArchiveExecutionHeldError extends Error {
    constructor(message: string);
}
/** Policy and acquisition-wide budget, resolved once per run. */
export interface ArchiveExecutionResolution {
    policy: LocalArchivePolicy;
    budget: ArchiveSessionBudget;
}
/** Single resolution point shared by observation and materialization paths. */
export declare function resolveArchiveExecution(overrides?: Partial<LocalArchivePolicy>, nowMs?: () => number): ArchiveExecutionResolution;
export interface ArchiveExecutionContextInput {
    /** Live source path. It is copied once and never read again by admission/extraction. */
    zipPath: string;
    extractDir: string;
    /** Real nesting depth of this archive; the outermost archive is 0. */
    depth: number;
    /** Run-scoped resolution. Every archive in one acquisition must share this object. */
    resolution?: ArchiveExecutionResolution;
    /** Convenience for standalone callers that are not already inside an acquisition. */
    policy?: Partial<LocalArchivePolicy>;
    nowMs?: () => number;
    /** Tool-owned scratch parent. Defaults outside the source tree. */
    stagingParent?: string;
}
/**
 * Admission facts for one archive.
 *
 * Construction stages and hashes the source in one streaming pass, then all ZIP
 * parsing, preflight and materialization read only the staged path. This closes
 * the live-path TOCTOU window: the verdict and the bytes written always describe
 * the same immutable snapshot.
 */
export declare class ArchiveExecutionContext {
    readonly zipPath: string;
    readonly extractDir: string;
    readonly depth: number;
    readonly policy: LocalArchivePolicy;
    readonly budget: ArchiveSessionBudget;
    readonly archiveCompressedBytes: number;
    readonly archiveSha256: string;
    readonly readerVersion = "1.1.0";
    readonly policyFingerprint: string;
    readonly stagedZipPath: string;
    readonly centralDirectory: ZipDirectory;
    readonly preflight: ArchivePreflightResult;
    private readonly stagingRoot;
    private disposed;
    constructor(input: ArchiveExecutionContextInput);
    /** File members eligible for materialization, narrowed in O(n) time. */
    planMembers(allowedMembers?: string[]): PreflightMember[];
    /** Run-scoped refusal after archive-local preflight has accepted. */
    sessionRefusalReason(): string | null;
    /** Fail closed when wall-clock time expires during staging/member streaming. */
    assertProcessingWithinBudget(): void;
    /** Consume acquisition-wide accounting only after a verified archive succeeds. */
    recordSuccess(expandedBytes: number): void;
    /** The single archive-local refusal sentence every path reports, or null. */
    holdReasons(): string | null;
    dispose(): void;
}
