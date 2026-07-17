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
// Word-shingle signature used for near-duplicate similarity. Exact-hash twins are
// caught separately (identical bytes); near-duplicates are bodies that are highly
// similar but not byte-identical, which a content hash cannot detect. k-word
// shingles + Jaccard give a stable, order-sensitive similarity in [0,1] that the
// `nearDupThreshold` ratio (e.g. 0.9) is meaningfully compared against.
const SHINGLE_K = 4;
function shingles(text) {
    const toks = text.toLowerCase().replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    if (toks.length === 0)
        return new Set();
    if (toks.length < SHINGLE_K)
        return new Set([toks.join(" ")]);
    const out = new Set();
    for (let i = 0; i + SHINGLE_K <= toks.length; i++)
        out.add(toks.slice(i, i + SHINGLE_K).join(" "));
    return out;
}
function jaccard(a, b) {
    // No signal either side → not comparable; return 0 so missing bodies never
    // masquerade as matches (two empty sets are treated as "unknown", not "identical").
    if (a.size === 0 || b.size === 0)
        return 0;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}
// `bodies` maps sourcePath → the clean body used for hashing/classification. When
// supplied, each entry carries a shingle signature enabling near-duplicate
// detection; when omitted, signatures are empty and near-dup detection reports
// nothing (by construction, not by silent stubbing) — the pipeline always supplies it.
function buildDedupEntries(records, prefixLen, bodies) {
    return records.map((r) => ({
        id: r.meta.id, sourcePath: r.sourcePath,
        contentHash: r.originalBodyHash, hashPrefix: r.originalBodyHash.slice(0, prefixLen),
        family: isPromptMeta(r.meta) ? r.meta.family : "Unknown",
        artifactType: r.meta.artifact_type,
        shingles: shingles(bodies?.get(r.sourcePath) ?? ""),
    }));
}
function buildDedupReport(entries, threshold, _prefixLen) {
    const hashGroups = new Map();
    for (const e of entries) {
        const g = hashGroups.get(e.contentHash) ?? [];
        g.push(e.sourcePath);
        hashGroups.set(e.contentHash, g);
    }
    const twins = [...hashGroups.entries()].filter(([, paths]) => paths.length > 1).map(([contentHash, paths]) => ({ paths, contentHash }));
    // Near-duplicates: pairs whose body similarity ≥ threshold but whose full
    // content hash differs (byte-identical pairs are already reported as twins).
    // O(n²) over injected files, which is the intended dedup scope.
    const nearDuplicates = [];
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            if (entries[i].contentHash === entries[j].contentHash)
                continue; // exact twin, not "near"
            const sim = jaccard(entries[i].shingles, entries[j].shingles);
            if (sim >= threshold) {
                nearDuplicates.push({ paths: [entries[i].sourcePath, entries[j].sourcePath], similarity: Math.round(sim * 1000) / 1000 });
            }
        }
    }
    nearDuplicates.sort((a, b) => b.similarity - a.similarity);
    return { generatedAt: new Date().toISOString(), totalScanned: entries.length, auditorTwins: twins, nearDuplicates, uniqueCount: entries.length - twins.reduce((a, t) => a + t.paths.length - 1, 0) };
}
function buildPromptLibraryIndex(records) {
    return records.filter((r) => isPromptMeta(r.meta)).map((r) => r.meta);
}
function buildPrimitiveLibraryIndex(records) {
    return records.filter((r) => !isPromptMeta(r.meta) && r.meta.injectable).map((r) => r.meta);
}
function dedupReportToMarkdown(report) {
    const lines = [`# Dedup Report — ${report.generatedAt}`, ``, `Total scanned: ${report.totalScanned}  |  Unique: ${report.uniqueCount}  |  Exact twins: ${report.auditorTwins.length}  |  Near duplicates: ${report.nearDuplicates.length}`, ``];
    if (report.auditorTwins.length > 0) {
        lines.push("## Exact Duplicates");
        for (const t of report.auditorTwins) {
            lines.push(`- \`${t.contentHash.slice(0, 16)}\``);
            t.paths.forEach((p) => lines.push(`  - ${p}`));
        }
    }
    if (report.nearDuplicates.length > 0) {
        lines.push("", "## Near Duplicates");
        for (const n of report.nearDuplicates) {
            lines.push(`- similarity ${n.similarity}`);
            n.paths.forEach((p) => lines.push(`  - ${p}`));
        }
    }
    return lines.join("\n") + "\n";
}
//# sourceMappingURL=compiler.js.map