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

/** Merge caller overrides onto the defaults, keeping the version explicit. */
export function resolveLocalArchivePolicy(overrides?: Partial<LocalArchivePolicy>): LocalArchivePolicy {
  return {
    ...DEFAULT_LOCAL_ARCHIVE_POLICY,
    ...overrides,
    version: overrides?.version ?? LOCAL_ARCHIVE_POLICY_VERSION,
  };
}

/**
 * Deterministic fingerprint of a fully resolved archive policy.
 *
 * A cached admission verdict is only reusable for a policy that would judge the
 * archive the same way, and the version string cannot carry that. Two runs share
 * `version: "1"` while one allows a compression ratio of 200 and the other 10;
 * replaying the looser run's verdict under the stricter policy admits an archive
 * the operator has just finished forbidding. Identity therefore has to be the
 * resolved values themselves.
 *
 * Every own enumerable field is included, sorted by key, so the fingerprint does
 * not depend on the order overrides were merged in, and a field added to
 * LocalArchivePolicy later enters the identity on its own rather than being
 * quietly excluded until someone remembers to list it here.
 */
export function localArchivePolicyFingerprint(policy: LocalArchivePolicy): string {
  // compareCodePoints, not a bare sort() and emphatically not localeCompare: this
  // ordering reaches a hash, and src/ordering.ts is the module that exists because
  // locale-aware ordering varies with the runtime's ICU data, so the same policy
  // could fingerprint two ways on two machines.
  const fields = [...Object.keys(policy)]
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

  /** Reason this archive may not be expanded, or null when it may. */
  refuseReason(declaredUncompressedBytes: number): string | null {
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

  recordArchive(expandedBytes: number): void {
    this.expandedArchives++;
    this.expandedBytes += expandedBytes;
  }
}
