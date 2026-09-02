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

import * as crypto from "node:crypto";
import { compareCodePoints } from "./ordering";

/** Contract version recorded in the acquisition manifest and packet diagnostics. */
export const LOCAL_ARCHIVE_POLICY_VERSION = "1";

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
export const DEFAULT_LOCAL_ARCHIVE_POLICY: LocalArchivePolicy = Object.freeze({
  version: LOCAL_ARCHIVE_POLICY_VERSION,
  maxArchiveCompressedBytes: 256 * 1024 * 1024,
  maxMemberCount: 10_000,
  maxSingleMemberUncompressedBytes: 64 * 1024 * 1024,
  maxTotalUncompressedBytesPerArchive: 512 * 1024 * 1024,
  maxTotalUncompressedBytesPerSession: 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxNestedDepth: 3,
  maxNestedArchiveCount: 64,
  maxPathLength: 1024,
  maxProcessingMs: 5 * 60 * 1000,
});

const POSITIVE_INTEGER_FIELDS: ReadonlyArray<keyof LocalArchivePolicy> = [
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
export function validateLocalArchivePolicy(policy: LocalArchivePolicy): LocalArchivePolicy {
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
export function resolveLocalArchivePolicy(overrides?: Partial<LocalArchivePolicy>): LocalArchivePolicy {
  return validateLocalArchivePolicy({
    ...DEFAULT_LOCAL_ARCHIVE_POLICY,
    ...overrides,
    version: overrides?.version ?? LOCAL_ARCHIVE_POLICY_VERSION,
  });
}

/**
 * Deterministic fingerprint of a fully resolved archive policy.
 *
 * The informational policy version is intentionally excluded. Cache identity is
 * the semantic resolved limits themselves, matching ADR-044: changing a version
 * label alone must not answer a different archive-admission question.
 */
export function localArchivePolicyFingerprint(policy: LocalArchivePolicy): string {
  const fields = [...Object.keys(policy)]
    .filter((key) => key !== "version")
    .sort(compareCodePoints)
    .map((key) => [key, (policy as unknown as Record<string, unknown>)[key]]);
  return `lap1:${crypto.createHash("sha256").update(JSON.stringify(fields), "utf8").digest("hex")}`;
}

/**
 * Acquisition-wide accounting.
 *
 * Per-archive limits cannot bound a tree of many small archives, so expanded
 * bytes, archive count and elapsed time are tracked across the whole run and
 * consulted before each archive is expanded.
 */
export class ArchiveSessionBudget {
  private expandedBytes = 0;
  private expandedArchives = 0;

  constructor(
    readonly policy: LocalArchivePolicy,
    private readonly startedAtMs: number,
    private readonly nowMs: () => number,
  ) {}

  get totalExpandedBytes(): number { return this.expandedBytes; }
  get totalExpandedArchives(): number { return this.expandedArchives; }

  /** Remaining session byte allowance; never negative. */
  remainingBytes(): number {
    return Math.max(0, this.policy.maxTotalUncompressedBytesPerSession - this.expandedBytes);
  }

  /** Wall-clock-only refusal, safe to call during member streaming. */
  processingRefusalReason(): string | null {
    if (this.nowMs() - this.startedAtMs > this.policy.maxProcessingMs) {
      return `acquisition exceeded the ${this.policy.maxProcessingMs}ms processing budget`;
    }
    return null;
  }

  /** Reason this archive may not be expanded, or null when it may. */
  refuseReason(declaredUncompressedBytes: number): string | null {
    if (this.expandedArchives >= this.policy.maxNestedArchiveCount) {
      return `session archive count limit of ${this.policy.maxNestedArchiveCount} reached`;
    }
    const processing = this.processingRefusalReason();
    if (processing !== null) return processing;
    if (this.expandedBytes + declaredUncompressedBytes > this.policy.maxTotalUncompressedBytesPerSession) {
      return `session expansion budget of ${this.policy.maxTotalUncompressedBytesPerSession} bytes would be exceeded`;
    }
    return null;
  }

  recordArchive(expandedBytes: number): void {
    if (!Number.isFinite(expandedBytes) || expandedBytes < 0) {
      throw new Error("archive session accounting requires a non-negative finite byte count");
    }
    this.expandedArchives++;
    this.expandedBytes += expandedBytes;
  }
}
