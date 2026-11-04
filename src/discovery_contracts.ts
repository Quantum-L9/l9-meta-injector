/**
 * Read-only filesystem discovery accounting.
 *
 * Every encountered path receives exactly one terminal disposition. The ledger
 * records repository-relative POSIX paths only, so reports remain comparable
 * across checkout locations and operating systems.
 */

import { compareCodePoints } from "./ordering";

export const DISCOVERY_DISPOSITIONS = [
  "eligible",
  "traversed_directory",
  "omitted",
  "hidden_control",
  "generated_artifact",
  "extension_filtered",
  "glob_filtered",
  "known_binary",
  "binary_detected",
  "unsupported_encoding",
  "unreadable",
  "symlink",
  "unsupported_entry",
] as const;

export type DiscoveryDisposition = (typeof DISCOVERY_DISPOSITIONS)[number];
export type DiscoveryEntryKind = "file" | "directory" | "symlink" | "other";

export interface DiscoveryLedgerEntry {
  path: string;
  kind: DiscoveryEntryKind;
  disposition: DiscoveryDisposition;
  reason: string;
  sizeBytes?: number;
}

export interface DiscoverySummary {
  total: number;
  eligible: number;
  blocking: number;
  byDisposition: Record<DiscoveryDisposition, number>;
  entries: DiscoveryLedgerEntry[];
}

export const BLOCKING_DISCOVERY_DISPOSITIONS: ReadonlySet<DiscoveryDisposition> = new Set([
  "unreadable",
  "symlink",
  "unsupported_entry",
]);

export function emptyDiscoverySummary(): DiscoverySummary {
  return {
    total: 0,
    eligible: 0,
    blocking: 0,
    byDisposition: Object.fromEntries(
      DISCOVERY_DISPOSITIONS.map((disposition) => [disposition, 0]),
    ) as Record<DiscoveryDisposition, number>,
    entries: [],
  };
}

export function summarizeDiscovery(entries: DiscoveryLedgerEntry[]): DiscoverySummary {
  const sorted = [...entries].sort((a, b) => {
    const byPath = compareCodePoints(a.path, b.path);
    if (byPath !== 0) return byPath;
    return compareCodePoints(a.disposition, b.disposition);
  });
  const summary = emptyDiscoverySummary();
  summary.entries = sorted;
  summary.total = sorted.length;
  for (const entry of sorted) {
    summary.byDisposition[entry.disposition] += 1;
    if (entry.disposition === "eligible") summary.eligible += 1;
    if (BLOCKING_DISCOVERY_DISPOSITIONS.has(entry.disposition)) summary.blocking += 1;
  }
  return summary;
}

/** Exact Git commit-tree facts. This is not filesystem candidate discovery. */
export interface TrackedGitEntry {
  /** Strict UTF-8 spelling, or null when Git path bytes are not valid UTF-8. */
  readonly path: string | null;
  /** Lossless canonical base64 of the exact Git repository-relative path bytes. */
  readonly path_bytes_base64: string;
  readonly mode: "100644" | "100755" | "120000" | "160000";
  readonly object_type: "blob" | "commit";
  /** Git object identity, not a SHA-256 of subject contents. */
  readonly object_oid: string;
}

export interface TrackedGitSnapshot {
  readonly repository_id: string;
  readonly revision: string;
  readonly tree_oid: string;
  readonly object_format: "sha1" | "sha256";
  readonly entries: readonly TrackedGitEntry[];
}

export interface ReadTrackedGitSnapshotInput {
  readonly root: string;
  readonly revision: string;
  readonly repositoryId: string;
  readonly maxOutputBytes?: number;
  readonly timeoutMs?: number;
}

/** Versioned universal index-first evidence; never an inline mutation authorization. */
export const TRACKED_COVERAGE_SCHEMA = "l9.metadata-coverage/v2" as const;
export const TRACKED_POLICY_SCHEMA = "l9.tracked-carrier-policy/v2" as const;
export type TrackedDisposition = "indexed" | "protected" | "unsupported";
export type TrackedReason =
  | "index_only" | "link_as_link" | "gitlink_as_reference" | "name_hint_inventory"
  | "protected_self" | "protected_manifest" | "protected_git_internal" | "protected_secret"
  | "unsupported_path" | "unsupported_git_entry";

export interface TrackedCarrierDecision extends TrackedGitEntry {
  readonly carrier: "central_manifest" | "inventory_only" | "hard_skip";
  readonly disposition: TrackedDisposition;
  readonly reason: TrackedReason;
}

export interface LegacyTrackedAliasGroup {
  readonly schema: "l9.namespace-alias/v1";
  readonly alias: string;
  /** Exact canonical v2 identities. An ambiguous alias is never a reconciliation key. */
  readonly ids: readonly string[];
}
