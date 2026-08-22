/** Contract version recorded in the acquisition manifest and packet diagnostics. */
export declare const LOCAL_ARCHIVE_POLICY_VERSION = "1";
export interface LocalArchivePolicy {
    /** Contract version. Recorded so a manifest states which rules produced it. */
    version: string;
    /** Largest archive file, in bytes, that will be staged at all. */
    maxArchiveCompressedBytes: number;
    /** Largest number of central-directory entries a single archive may declare. */
    maxMemberCount: number;
    /** Largest uncompressed size for one member. */
    maxSingleMemberUncompressedBytes: number;
    /** Largest total uncompressed size across one archive. */
    maxTotalUncompressedBytesPerArchive: number;
    /** Largest total uncompressed size across every archive in one acquisition. */
    maxTotalUncompressedBytesPerSession: number;
    /** Largest permitted uncompressed:compressed ratio for one archive. */
    maxCompressionRatio: number;
    /** Nesting depth ceiling. The outermost archive is depth 0. */
    maxNestedDepth: number;
    /** Largest number of archives expanded in one acquisition, nested included. */
    maxNestedArchiveCount: number;
    /** Longest permitted member path, in UTF-16 code units. */
    maxPathLength: number;
    /** Wall-clock ceiling for the whole acquisition, in milliseconds. */
    maxProcessingMs: number;
}
/**
 * Conservative defaults. An operator who needs more raises the limit explicitly,
 * which makes the decision auditable instead of implicit.
 */
export declare const DEFAULT_LOCAL_ARCHIVE_POLICY: LocalArchivePolicy;
/** Merge caller overrides onto the defaults, keeping the version explicit. */
export declare function resolveLocalArchivePolicy(overrides?: Partial<LocalArchivePolicy>): LocalArchivePolicy;
/**
 * Acquisition-wide accounting.
 *
 * Per-archive limits cannot bound a tree of many small archives, so expanded
 * bytes, archive count and elapsed time are tracked across the whole run and
 * consulted before each archive is expanded.
 */
export declare class ArchiveSessionBudget {
    readonly policy: LocalArchivePolicy;
    private readonly startedAtMs;
    private readonly nowMs;
    private expandedBytes;
    private expandedArchives;
    constructor(policy: LocalArchivePolicy, startedAtMs: number, nowMs: () => number);
    get totalExpandedBytes(): number;
    get totalExpandedArchives(): number;
    /** Remaining session byte allowance; never negative. */
    remainingBytes(): number;
    /** Reason this archive may not be expanded, or null when it may. */
    refuseReason(declaredUncompressedBytes: number): string | null;
    recordArchive(expandedBytes: number): void;
}
