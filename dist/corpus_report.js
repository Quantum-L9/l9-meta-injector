"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderCorpusReport = renderCorpusReport;
/** Escape the characters that would break a Markdown table cell. */
function cell(value) {
    return value
        .replace(/\\/g, String.raw `\\`)
        .replace(/\|/g, String.raw `\|`)
        .replace(/\r?\n/g, " ");
}
function code(value) {
    return `\`${cell(value)}\``;
}
function signalsWith(index, predicate, object) {
    return index.work_signals.filter((signal) => signal.predicate === predicate && (object === undefined || signal.object === object));
}
function location(signal) {
    return `${signal.source_path}:${signal.source_range.start_line}`;
}
function section(title, body) {
    return body.length > 0 ? [`## ${title}`, "", ...body, ""] : [`## ${title}`, "", "_None observed._", ""];
}
function subsection(title, body) {
    return body.length > 0 ? [`### ${title}`, "", ...body, ""] : [];
}
/** A `| a | b |` table, or nothing when there are no rows. */
function table(headers, rows) {
    if (rows.length === 0)
        return [];
    return [
        `| ${headers.join(" | ")} |`,
        `|${headers.map(() => "---").join("|")}|`,
        ...rows.map((row) => `| ${row.join(" | ")} |`),
    ];
}
function summarySection(index) {
    const s = index.summary;
    return section("Corpus Summary", [
        ...table(["measure", "value"], [
            ["source", code(index.source.source_name)],
            ["source revision", code(index.source.source_revision)],
            ["artifacts", String(s.artifact_count)],
            ["archives", String(s.archive_count)],
            ["archive members", String(s.archive_member_count)],
            ["artifacts with work signals", String(s.artifacts_with_work_signals)],
            ["assertions", String(s.assertion_count)],
            ["open tasks", String(s.open_task_count)],
            ["completed tasks", String(s.completed_task_count)],
            ["milestones", String(s.milestone_count)],
            ["exact duplicate clusters", String(s.exact_duplicate_cluster_count)],
            ["artifacts in a duplicate cluster", String(s.exact_duplicate_artifact_count)],
            ["recoverable duplicate bytes", String(s.recoverable_duplicate_bytes)],
            ["near-duplicate candidates", String(s.near_duplicate_candidate_count)],
        ]),
    ]);
}
function declarationRows(signals) {
    return signals.map((signal) => [code(signal.object), code(location(signal)), signal.confidence]);
}
function workSignalsSection(index) {
    const plans = signalsWith(index, "work.kind", "plan");
    const roadmaps = signalsWith(index, "work.kind", "roadmap");
    const wip = signalsWith(index, "work.status", "wip");
    const drafts = signalsWith(index, "work.status", "draft");
    const blocked = signalsWith(index, "work.status", "blocked");
    const open = signalsWith(index, "work.task.open");
    const done = signalsWith(index, "work.task.completed");
    const milestones = signalsWith(index, "work.milestone");
    const body = [
        "Every row below is a declaration the document makes about itself, with the line",
        "that states it. Nothing here is inferred from age, location, or task counts.",
        "",
        ...subsection("Plans and Roadmaps", table(["kind", "document", "declared at", "confidence"], [...plans, ...roadmaps].map((signal) => [
            signal.object, code(signal.source_path), code(location(signal)), signal.confidence,
        ]))),
        ...subsection("WIP and Drafts", table(["status", "document", "declared at"], [...wip, ...drafts].map((signal) => [
            signal.object, code(signal.source_path), code(location(signal)),
        ]))),
        ...subsection("Blocked Work", table(["document", "declared at"], blocked.map((signal) => [code(signal.source_path), code(location(signal))]))),
        ...subsection("Open Tasks", table(["task", "declared at", "confidence"], declarationRows(open))),
        ...subsection("Completed Tasks", table(["task", "declared at", "confidence"], declarationRows(done))),
        ...subsection("Milestones", table(["milestone", "declared at", "confidence"], declarationRows(milestones))),
    ];
    const hasAny = [plans, roadmaps, wip, drafts, blocked, open, done, milestones]
        .some((group) => group.length > 0);
    return hasAny ? ["## Work Signals", "", ...body] : section("Work Signals", []);
}
const RELATION_SECTIONS = [
    { title: "Depends On", predicate: "work.depends_on" },
    { title: "Blocked By", predicate: "work.blocked_by" },
    { title: "References", predicate: "work.references" },
    { title: "Supersedes", predicate: "work.supersedes" },
    { title: "Superseded By", predicate: "work.superseded_by" },
];
function relationshipsSection(index) {
    const body = [];
    for (const { title, predicate } of RELATION_SECTIONS) {
        const signals = signalsWith(index, predicate);
        body.push(...subsection(title, table(["document", "declared target", "declared at"], signals.map((signal) => [
            code(signal.source_path), code(signal.object), code(location(signal)),
        ]))));
    }
    if (body.length === 0)
        return section("Explicit Relationships", []);
    return [
        "## Explicit Relationships",
        "",
        "Targets are quoted exactly as the document wrote them. They are not resolved to",
        "artifacts by guesswork, so a target naming a file that does not exist stays as",
        "written.",
        "",
        ...body,
    ];
}
function duplicatesSection(index) {
    const clusters = index.exact_duplicate_clusters;
    if (clusters.length === 0)
        return section("Exact Duplicate Clusters", []);
    const body = [
        "Byte-identical artifacts, grouped by content hash. This is a fact about the",
        "bytes: every member of a cluster has exactly the same content.",
        "",
        "The representative is a fixed rendering anchor, chosen by shortest path. It is",
        "not a recommendation about which copy to keep — this analysis has no basis for",
        "one, and no file has been moved, deleted, or changed.",
        "",
        ...table(["cluster", "copies", "recoverable bytes", "representative", "other paths"], clusters.map((cluster) => [
            code(cluster.content_hash.slice(0, 19)),
            String(cluster.count),
            String(cluster.recoverable_bytes),
            code(cluster.representative_source_path),
            cluster.source_paths
                .filter((sourcePath) => sourcePath !== cluster.representative_source_path)
                .map(code)
                .join("<br>"),
        ])),
    ];
    return ["## Exact Duplicate Clusters", "", ...body, ""];
}
function candidateRow(candidate) {
    return [
        candidate.score.toFixed(6),
        code(candidate.source_path_a),
        code(candidate.source_path_b),
        `${candidate.shared_shingle_count}/${candidate.union_shingle_count}`,
    ];
}
function nearDuplicatesSection(index) {
    if (!index.analysis_profile.near_duplicate_analysed) {
        return [
            "## Near-Duplicate Candidates",
            "",
            "_Similarity analysis was not run for this corpus._",
            "",
        ];
    }
    const candidates = index.near_duplicate_candidates;
    const profile = index.analysis_profile;
    const preamble = [
        `Pairs whose **lexical similarity** reached the ${profile.near_duplicate_threshold} threshold under`,
        `${code(profile.near_duplicate_method)} \`${profile.near_duplicate_version}\`: exact Jaccard over unique`,
        "5-token shingles of normalized text.",
        "",
        "These are **candidates for a reader to look at**, and the score measures shared",
        "wording only. Shared wording is not shared subject matter, shared ownership, or",
        "supersession: two documents can score highly by reusing a template, and two",
        "documents covering one subject can score near zero. Nothing here proposes that",
        "either document be changed. Byte-identical pairs are reported as exact",
        "duplicates above and are excluded from this table.",
        "",
    ];
    if (candidates.length === 0) {
        return ["## Near-Duplicate Candidates", "", ...preamble, "_No pair reached the threshold._", ""];
    }
    return [
        "## Near-Duplicate Candidates",
        "",
        ...preamble,
        ...table(["similarity", "document A", "document B", "shared/union shingles"], candidates.map(candidateRow)),
        "",
    ];
}
function archivesSection(index) {
    const members = index.artifacts.filter((artifact) => artifact.is_archive_member);
    if (members.length === 0)
        return section("Archives and Virtual Members", []);
    return [
        "## Archives and Virtual Members",
        "",
        "Archive members are observed in place. Nothing was extracted into the source",
        "tree; each member is named by a virtual locator.",
        "",
        ...table(["member", "type", "size"], members.map((member) => [
            code(member.source_path),
            member.artifact_type,
            member.size_bytes === null ? "Unknown" : String(member.size_bytes),
        ])),
        "",
    ];
}
function diagnosticsSection(index) {
    if (index.diagnostics.length === 0) {
        return ["## Diagnostics and Coverage Gaps", "", "_No diagnostics were reported._", ""];
    }
    return [
        "## Diagnostics and Coverage Gaps",
        "",
        "What acquisition could not observe. A gap here means the corpus above is",
        "incomplete in a known, named way.",
        "",
        ...table(["severity", "code", "path", "message"], index.diagnostics.map((diagnostic) => [
            diagnostic.severity,
            code(diagnostic.code),
            diagnostic.source_path === undefined ? "—" : code(diagnostic.source_path),
            cell(diagnostic.message),
        ])),
        "",
    ];
}
/**
 * Render a corpus index as Markdown.
 *
 * Deterministic: the same index always produces the same bytes. No timestamp is
 * emitted, because a generation time would make every run differ while nothing
 * about the corpus had changed.
 */
function renderCorpusReport(index) {
    const lines = [
        `# Corpus Report — ${index.source.source_name}`,
        "",
        `Source revision: \`${index.source.source_revision}\``,
        `Packet: \`${index.repository_model.packet_id}\``,
        `Corpus profile: \`${index.analysis_profile.corpus_profile_id}\` \`${index.analysis_profile.corpus_profile_version}\``,
        "",
        "This report is a projection of the corpus index. Every figure below traces to an",
        "observation, an assertion with a cited source span, or one of the two duplicate",
        "analyses. No file was moved, deleted, or modified to produce it.",
        "",
        ...summarySection(index),
        ...workSignalsSection(index),
        ...relationshipsSection(index),
        ...duplicatesSection(index),
        ...nearDuplicatesSection(index),
        ...archivesSection(index),
        ...diagnosticsSection(index),
    ];
    return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
//# sourceMappingURL=corpus_report.js.map