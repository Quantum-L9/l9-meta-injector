"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDedupEntries = buildDedupEntries;
exports.buildDedupReport = buildDedupReport;
exports.buildPromptLibraryIndex = buildPromptLibraryIndex;
exports.buildPrimitiveLibraryIndex = buildPrimitiveLibraryIndex;
exports.dedupReportToMarkdown = dedupReportToMarkdown;
function isPromptMeta(m) {
    return typeof m === "object" && m !== null && m.artifact_type === "prompt";
}
function buildDedupEntries(records, prefixLen) {
    return records.map((r) => ({
        id: r.meta.id, sourcePath: r.sourcePath,
        contentHash: r.originalBodyHash, hashPrefix: r.originalBodyHash.slice(0, prefixLen),
        family: isPromptMeta(r.meta) ? r.meta.family : "Unknown",
        artifactType: r.meta.artifact_type,
    }));
}
function buildDedupReport(entries, _threshold, _prefixLen) {
    const hashGroups = new Map();
    for (const e of entries) {
        const g = hashGroups.get(e.contentHash) ?? [];
        g.push(e.sourcePath);
        hashGroups.set(e.contentHash, g);
    }
    const twins = [...hashGroups.entries()].filter(([, paths]) => paths.length > 1).map(([contentHash, paths]) => ({ paths, contentHash }));
    return { generatedAt: new Date().toISOString(), totalScanned: entries.length, auditorTwins: twins, nearDuplicates: [], uniqueCount: entries.length - twins.reduce((a, t) => a + t.paths.length - 1, 0) };
}
function buildPromptLibraryIndex(records) {
    return records.filter((r) => isPromptMeta(r.meta)).map((r) => r.meta);
}
function buildPrimitiveLibraryIndex(records) {
    return records.filter((r) => !isPromptMeta(r.meta) && r.meta.injectable).map((r) => r.meta);
}
function dedupReportToMarkdown(report) {
    const lines = [`# Dedup Report — ${report.generatedAt}`, ``, `Total scanned: ${report.totalScanned}  |  Unique: ${report.uniqueCount}  |  Exact twins: ${report.auditorTwins.length}`, ``];
    if (report.auditorTwins.length > 0) {
        lines.push("## Exact Duplicates");
        for (const t of report.auditorTwins) {
            lines.push(`- \`${t.contentHash.slice(0, 16)}\``);
            t.paths.forEach((p) => lines.push(`  - ${p}`));
        }
    }
    return lines.join("\n") + "\n";
}
//# sourceMappingURL=compiler.js.map