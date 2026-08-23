"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CORPUS_INDEX_STATEMENT = exports.CORPUS_INDEX_SCHEMA = void 0;
exports.buildCorpusIndex = buildCorpusIndex;
exports.renderCorpusIndex = renderCorpusIndex;
exports.renderCorpusIndexReport = renderCorpusIndexReport;
// corpus_index.ts — the corpus's own table of contents.
//
// Every other document a corpus run writes answers one question about it: what
// was decoded, what looks related, what evidence each candidate body of work
// carries. None of them says what the corpus *is* — which roots it was made of,
// which packet each root produced, where each root's own outputs went, and under
// which identity the rest of the set was written.
//
// That is what this file is. It is deliberately a set of references rather than a
// copy: a reader who wants the readiness counts is pointed at
// `readiness-evidence.json` rather than handed a second, drifting copy of them.
// The only numbers here are the corpus's own denominators, and they are here
// because a table of contents that did not say how big the corpus was would
// invite reading "3 project candidates" without knowing whether it came from
// thirty files or thirty thousand.
const corpus_analysis_1 = require("./corpus_analysis");
const ordering_1 = require("./ordering");
exports.CORPUS_INDEX_SCHEMA = "l9.corpus-index/v1";
exports.CORPUS_INDEX_STATEMENT = "This index names what was observed and where each document was written. It contains no "
    + "ranking, no priority and no recommendation, and the order of any list in it carries none.";
/** Named documents a corpus run may write, in the order a reader meets them. */
const KNOWN_DOCUMENTS = [
    { name: "snapshot", path: "corpus-snapshot.json", schema: "l9.corpus-snapshot/v1" },
    { name: "diff", path: "corpus-diff.json", schema: "l9.corpus-diff/v1" },
    { name: "coverage", path: "corpus-coverage.json", schema: "l9.corpus-coverage/v1" },
    { name: "readiness_evidence", path: "readiness-evidence.json", schema: "l9.readiness-evidence/v1" },
    { name: "candidates", path: "corpus-candidates.json", schema: "l9.corpus-candidates/v1" },
    { name: "document_index", path: "document-index.json", schema: "l9.document-index/v1" },
    { name: "semantic_relations", path: "semantic-relations.json", schema: "l9.semantic-relations/v1" },
    { name: "topic_candidates", path: "topic-candidates.json", schema: "l9.topic-candidates/v1" },
    { name: "project_candidates", path: "project-candidates.json", schema: "l9.project-candidates/v1" },
    {
        name: "consolidation_candidates",
        path: "consolidation-candidates.json",
        schema: "l9.consolidation-candidates/v1",
    },
    { name: "reasoning_candidates", path: "reasoning-candidates.jsonl", schema: null },
    { name: "reasoning_evidence_packs", path: "reasoning-evidence-packs.jsonl", schema: null },
    { name: "report", path: "corpus-report.md", schema: null },
];
function buildCorpusIndex(input) {
    const { snapshot } = input;
    const written = new Set(input.writtenPaths);
    const artifactsByRoot = new Map();
    for (const artifact of snapshot.artifacts) {
        const tally = artifactsByRoot.get(artifact.root_id) ?? { count: 0, bytes: 0 };
        tally.count += 1;
        tally.bytes += artifact.size_bytes ?? 0;
        artifactsByRoot.set(artifact.root_id, tally);
    }
    const archivesByRoot = new Map();
    for (const archive of snapshot.archives) {
        archivesByRoot.set(archive.root_id, (archivesByRoot.get(archive.root_id) ?? 0) + 1);
    }
    const roots = snapshot.roots.map((root) => {
        const directory = input.rootDirectories.get(root.root_id);
        const under = (file) => directory === undefined ? null : `roots/${directory}/${file}`;
        const tally = artifactsByRoot.get(root.root_id) ?? { count: 0, bytes: 0 };
        return {
            root_id: root.root_id,
            root_key: root.root_key,
            source_kind: root.source_kind,
            source_revision: root.source_revision,
            rmp_packet_id: root.rmp_packet_id,
            rmp_semantic_hash: root.rmp_semantic_hash,
            bundle_ref: root.bundle_ref,
            document_index_ref: under("document-index.json"),
            document_coverage_ref: under("document-coverage.json"),
            acquisition_manifest_ref: under("local-source-manifest.json"),
            observation_status: root.observation_status,
            failure_reason: root.failure_reason,
            artifact_count: tally.count,
            archive_count: archivesByRoot.get(root.root_id) ?? 0,
            total_bytes: tally.bytes,
        };
    }).sort((a, b) => (0, ordering_1.compareCodePoints)(a.root_id, b.root_id));
    return {
        schema: exports.CORPUS_INDEX_SCHEMA,
        corpus_id: snapshot.corpus_id,
        corpus_source_snapshot_id: snapshot.corpus_source_snapshot_id,
        corpus_analysis_id: snapshot.analysis.corpus_analysis_id,
        corpus_status: snapshot.corpus_status,
        roots,
        missing_root_ids: [...snapshot.missing_root_ids].sort(ordering_1.compareCodePoints),
        counts: snapshot.counts,
        // Absence is reported rather than omitted: a consumer that cannot find
        // `corpus-diff.json` should be able to tell "this run made no comparison"
        // from "this run wrote it somewhere else".
        documents: KNOWN_DOCUMENTS.map((document) => ({
            ...document,
            present: written.has(document.path),
        })),
        statement: exports.CORPUS_INDEX_STATEMENT,
    };
}
/** Canonical bytes of the index. */
function renderCorpusIndex(index) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(index)}\n`;
}
function row(cells) {
    return `| ${cells.join(" | ")} |`;
}
/** The same index, rendered for a person. */
function renderCorpusIndexReport(index) {
    const lines = [
        `# Corpus report — ${index.corpus_id}`,
        "",
        "Read-only observation. No file under any root was moved, deleted, rewritten or",
        "consolidated, no build or test was executed, and no model was called.",
        "",
        "## Identity",
        "",
        row(["field", "value"]),
        row(["---", "---"]),
        row(["corpus_id", index.corpus_id]),
        row(["corpus_source_snapshot_id", index.corpus_source_snapshot_id]),
        row(["corpus_analysis_id", index.corpus_analysis_id]),
        row(["corpus_status", index.corpus_status]),
        "",
        "The source snapshot identifies what the disks held. The analysis id identifies",
        "what was concluded and under which rules. Changing a threshold or a decoder",
        "moves the second and leaves the first alone.",
        "",
        "## Roots",
        "",
        row(["root", "kind", "status", "artifacts", "archives", "bytes", "packet"]),
        row(["---", "---", "---", "---", "---", "---", "---"]),
        ...index.roots.map((root) => row([
            root.root_key,
            root.source_kind,
            root.observation_status,
            `${root.artifact_count}`,
            `${root.archive_count}`,
            `${root.total_bytes}`,
            root.rmp_packet_id === "" ? "—" : root.rmp_packet_id,
        ])),
        "",
        "Each root keeps its own Repository Model Packet under `roots/`. The corpus is an",
        "analysis across them; it is not a merged filesystem that replaces them.",
        "",
        "## Corpus size",
        "",
        row(["measure", "value"]),
        row(["---", "---"]),
        row(["roots requested", `${index.counts.root_count_requested}`]),
        row(["roots observed", `${index.counts.root_count_observed}`]),
        row(["roots failed", `${index.counts.root_count_failed}`]),
        row(["artifacts", `${index.counts.artifact_count}`]),
        row(["archives", `${index.counts.archive_count}`]),
        row(["archive members", `${index.counts.archive_member_count}`]),
        row(["bytes observed", `${index.counts.total_bytes}`]),
        "",
        "## Documents",
        "",
        row(["document", "path", "written"]),
        row(["---", "---", "---"]),
        ...index.documents.map((document) => row([
            document.name,
            `\`${document.path}\``,
            document.present ? "yes" : "no",
        ])),
        "",
        index.statement,
        "",
    ];
    if (index.missing_root_ids.length > 0) {
        lines.splice(lines.indexOf("## Corpus size"), 0, "## Missing roots", "", "These roots were named and were not observed. Every count above is a count over", "the roots that were.", "", ...index.missing_root_ids.map((rootId) => `- ${rootId}`), "");
    }
    return lines.join("\n");
}
//# sourceMappingURL=corpus_index.js.map