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
