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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArchiveSessionBudget = exports.DEFAULT_LOCAL_ARCHIVE_POLICY = exports.LOCAL_ARCHIVE_POLICY_VERSION = void 0;
exports.validateLocalArchivePolicy = validateLocalArchivePolicy;
exports.resolveLocalArchivePolicy = resolveLocalArchivePolicy;
exports.localArchivePolicyFingerprint = localArchivePolicyFingerprint;
const crypto = __importStar(require("node:crypto"));
const ordering_1 = require("./ordering");
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
const POSITIVE_INTEGER_FIELDS = [
    "maxArchiveCompressedBytes",
    "maxMemberCount",
    "maxSingleMemberUncompressedBytes",
    "maxTotalUncompressedBytesPerArchive",
    "maxTotalUncompressedBytesPerSession",
    "maxNestedArchiveCount",
    "maxPathLength",
    "maxProcessingMs",
];
/** Validate caller-controlled resource ceilings before any archive is read. */
function validateLocalArchivePolicy(policy) {
    if (typeof policy.version !== "string" || policy.version.length === 0) {
        throw new Error("local archive policy version must be a non-empty string");
    }
    for (const field of POSITIVE_INTEGER_FIELDS) {
        const value = policy[field];
        if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
            throw new Error(`local archive policy ${String(field)} must be a positive finite integer`);
        }
    }
    if (!Number.isFinite(policy.maxNestedDepth) || !Number.isInteger(policy.maxNestedDepth) || policy.maxNestedDepth < 0) {
        throw new Error("local archive policy maxNestedDepth must be a non-negative finite integer");
    }
    if (!Number.isFinite(policy.maxCompressionRatio) || policy.maxCompressionRatio <= 0) {
        throw new Error("local archive policy maxCompressionRatio must be a positive finite number");
    }
    return policy;
}
/** Merge caller overrides onto the defaults, keeping the version explicit. */
function resolveLocalArchivePolicy(overrides) {
    return validateLocalArchivePolicy({
        ...exports.DEFAULT_LOCAL_ARCHIVE_POLICY,
        ...overrides,
        version: overrides?.version ?? exports.LOCAL_ARCHIVE_POLICY_VERSION,
    });
}
/**
 * Deterministic fingerprint of a fully resolved archive policy.
 *
 * Every resolved field contributes, including the contract version. The numeric
 * ceilings are the direct admission semantics; the version is a conservative
 * semantic epoch. A version bump therefore invalidates warm verdicts even when
 * the currently visible numeric limits happen to be unchanged, which is safer
 * than replaying a verdict across an intentionally revised policy contract.
 */
function localArchivePolicyFingerprint(policy) {
    const fields = Object.keys(policy)
        .sort(ordering_1.compareCodePoints)
        .map((key) => [key, policy[key]]);
    return `lap1:${crypto.createHash("sha256").update(JSON.stringify(fields), "utf8").digest("hex")}`;
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
    /** Wall-clock-only refusal, safe to call during member streaming. */
    processingRefusalReason() {
        if (this.nowMs() - this.startedAtMs > this.policy.maxProcessingMs) {
            return `acquisition exceeded the ${this.policy.maxProcessingMs}ms processing budget`;
        }
        return null;
    }
    /** Reason this archive may not be expanded, or null when it may. */
    refuseReason(declaredUncompressedBytes) {
        if (this.expandedArchives >= this.policy.maxNestedArchiveCount) {
            return `session archive count limit of ${this.policy.maxNestedArchiveCount} reached`;
        }
        const processing = this.processingRefusalReason();
        if (processing !== null)
            return processing;
        if (this.expandedBytes + declaredUncompressedBytes > this.policy.maxTotalUncompressedBytesPerSession) {
            return `session expansion budget of ${this.policy.maxTotalUncompressedBytesPerSession} bytes would be exceeded`;
        }
        return null;
    }
    recordArchive(expandedBytes) {
        if (!Number.isFinite(expandedBytes) || expandedBytes < 0) {
            throw new Error("archive session accounting requires a non-negative finite byte count");
        }
        this.expandedArchives++;
        this.expandedBytes += expandedBytes;
    }
}
exports.ArchiveSessionBudget = ArchiveSessionBudget;
//# sourceMappingURL=local_archive_policy.js.map