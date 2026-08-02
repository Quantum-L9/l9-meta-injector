/**
 * Read-only filesystem discovery accounting.
 *
 * Every encountered path receives exactly one terminal disposition. The ledger
 * records repository-relative POSIX paths only, so reports remain comparable
 * across checkout locations and operating systems.
 */
export declare const DISCOVERY_DISPOSITIONS: readonly ["eligible", "traversed_directory", "omitted", "hidden_control", "generated_artifact", "extension_filtered", "known_binary", "binary_detected", "unsupported_encoding", "unreadable", "symlink", "unsupported_entry"];
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
export declare const BLOCKING_DISCOVERY_DISPOSITIONS: ReadonlySet<DiscoveryDisposition>;
export declare function emptyDiscoverySummary(): DiscoverySummary;
export declare function summarizeDiscovery(entries: DiscoveryLedgerEntry[]): DiscoverySummary;
