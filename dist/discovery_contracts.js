"use strict";
/**
 * Read-only filesystem discovery accounting.
 *
 * Every encountered path receives exactly one terminal disposition. The ledger
 * records repository-relative POSIX paths only, so reports remain comparable
 * across checkout locations and operating systems.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCKING_DISCOVERY_DISPOSITIONS = exports.DISCOVERY_DISPOSITIONS = void 0;
exports.emptyDiscoverySummary = emptyDiscoverySummary;
exports.summarizeDiscovery = summarizeDiscovery;
exports.DISCOVERY_DISPOSITIONS = [
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
];
exports.BLOCKING_DISCOVERY_DISPOSITIONS = new Set([
    "unreadable",
    "symlink",
    "unsupported_entry",
]);
function emptyDiscoverySummary() {
    return {
        total: 0,
        eligible: 0,
        blocking: 0,
        byDisposition: Object.fromEntries(exports.DISCOVERY_DISPOSITIONS.map((disposition) => [disposition, 0])),
        entries: [],
    };
}
function summarizeDiscovery(entries) {
    const sorted = [...entries].sort((a, b) => {
        const byPath = a.path.localeCompare(b.path);
        if (byPath !== 0)
            return byPath;
        return a.disposition.localeCompare(b.disposition);
    });
    const summary = emptyDiscoverySummary();
    summary.entries = sorted;
    summary.total = sorted.length;
    for (const entry of sorted) {
        summary.byDisposition[entry.disposition] += 1;
        if (entry.disposition === "eligible")
            summary.eligible += 1;
        if (exports.BLOCKING_DISCOVERY_DISPOSITIONS.has(entry.disposition))
            summary.blocking += 1;
    }
    return summary;
}
//# sourceMappingURL=discovery_contracts.js.map