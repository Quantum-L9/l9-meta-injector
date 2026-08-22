"use strict";
// local_archive_policy.ts — declared resource budget for local-source archives.
//
// Every limit is explicit and configurable because an archive is attacker-shaped
// input: a 42 KB file can declare a 4.5 PB expansion. Limits are checked twice —
// once against the central directory before extraction begins, and again against
// bytes actually produced — because a malicious archive can also lie about its
// own metadata, and a metadata-only check would authorize the very expansion it
// was meant to prevent.
//
// Defaults are deliberately conservative. Tests bind their own small budgets
// rather than depending on these numbers, so tightening a default can never
// silently invalidate a security test.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArchiveSessionBudget = exports.DEFAULT_LOCAL_ARCHIVE_POLICY = exports.LOCAL_ARCHIVE_POLICY_VERSION = void 0;
exports.resolveLocalArchivePolicy = resolveLocalArchivePolicy;
/** Contract version recorded in the acquisition manifest and packet diagnostics. */
exports.LOCAL_ARCHIVE_POLICY_VERSION = "1";
/**
 * Conservative defaults. An operator who needs more raises the limit explicitly,
 * which makes the decision auditable instead of implicit.
 */
exports.DEFAULT_LOCAL_ARCHIVE_POLICY = Object.freeze({
    version: exports.LOCAL_ARCHIVE_POLICY_VERSION,
    maxArchiveCompressedBytes: 256 * 1024 * 1024,
    maxMemberCount: 10000,
    maxSingleMemberUncompressedBytes: 64 * 1024 * 1024,
    maxTotalUncompressedBytesPerArchive: 512 * 1024 * 1024,
    maxTotalUncompressedBytesPerSession: 1024 * 1024 * 1024,
    maxCompressionRatio: 200,
    maxNestedDepth: 3,
    maxNestedArchiveCount: 64,
    maxPathLength: 1024,
    maxProcessingMs: 5 * 60 * 1000,
});
/** Merge caller overrides onto the defaults, keeping the version explicit. */
function resolveLocalArchivePolicy(overrides) {
    return {
        ...exports.DEFAULT_LOCAL_ARCHIVE_POLICY,
        ...overrides,
        version: overrides?.version ?? exports.LOCAL_ARCHIVE_POLICY_VERSION,
    };
}
/**
 * Acquisition-wide accounting.
 *
 * Per-archive limits cannot bound a tree of many small archives, so expanded
 * bytes, archive count and elapsed time are tracked across the whole run and
 * consulted before each archive is expanded.
 */
class ArchiveSessionBudget {
    constructor(policy, startedAtMs, nowMs) {
        this.policy = policy;
        this.startedAtMs = startedAtMs;
        this.nowMs = nowMs;
        this.expandedBytes = 0;
        this.expandedArchives = 0;
    }
    get totalExpandedBytes() { return this.expandedBytes; }
    get totalExpandedArchives() { return this.expandedArchives; }
    /** Remaining session byte allowance; never negative. */
    remainingBytes() {
        return Math.max(0, this.policy.maxTotalUncompressedBytesPerSession - this.expandedBytes);
    }
    /** Reason this archive may not be expanded, or null when it may. */
    refuseReason(declaredUncompressedBytes) {
        if (this.expandedArchives >= this.policy.maxNestedArchiveCount) {
            return `session archive count limit of ${this.policy.maxNestedArchiveCount} reached`;
        }
        if (this.nowMs() - this.startedAtMs > this.policy.maxProcessingMs) {
            return `acquisition exceeded the ${this.policy.maxProcessingMs}ms processing budget`;
        }
        if (this.expandedBytes + declaredUncompressedBytes > this.policy.maxTotalUncompressedBytesPerSession) {
            return `session expansion budget of ${this.policy.maxTotalUncompressedBytesPerSession} bytes would be exceeded`;
        }
        return null;
    }
    recordArchive(expandedBytes) {
        this.expandedArchives++;
        this.expandedBytes += expandedBytes;
    }
}
exports.ArchiveSessionBudget = ArchiveSessionBudget;
//# sourceMappingURL=local_archive_policy.js.map