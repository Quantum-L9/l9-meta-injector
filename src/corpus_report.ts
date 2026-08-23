// corpus_report.ts — the human rendering of a corpus index.
//
// This module reads the index and nothing else. It does not open a source file,
// recompute a score, or reach for the packet: if a number is not in the index it
// does not appear in the report, which is what keeps the two documents unable to
// disagree.
//
// The wording is part of the contract, not decoration. Exact duplicates are
// stated as facts, because byte equality is one. Near-duplicate candidates are
// stated as candidates and as lexical similarity, because that is all a shingle
// score establishes — the report must never say two documents cover the same
// topic, belong to the same project, or should be merged or deleted. And the
// representative of a duplicate cluster is named a representative: it is a
// rendering anchor, not advice about which copy to keep.
import {
  CorpusArtifact,
  CorpusIndex,
  CorpusWorkSignal,
  NearDuplicateCandidate,
} from "./corpus_analysis";
import { compareCodePoints } from "./ordering";

/** Rows shown per table before the remainder is reported as a count. */
const MAX_ROWS = 100;

function escapeCell(value: string): string {
  return value.replace(/\|/g, String.raw`\|`).replace(/\r?\n/g, " ");
}

function code(value: string): string {
  return `\`${escapeCell(value)}\``;
}

/** A markdown table, or an explicit statement that there is nothing to show. */
function table(headers: string[], rows: string[][], empty: string): string[] {
  if (rows.length === 0) return [empty, ""];
  const shown = rows.slice(0, MAX_ROWS);
  const out = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...shown.map((row) => `| ${row.join(" | ")} |`),
  ];
  if (rows.length > shown.length) {
    out.push("", `${rows.length - shown.length} further row(s) are in \`corpus-index.json\`.`);
  }
  out.push("");
  return out;
}

function byPredicate(index: CorpusIndex, predicate: string): CorpusWorkSignal[] {
  return index.work_signals.filter((signal) => signal.predicate === predicate);
}

function signalRows(signals: CorpusWorkSignal[]): string[][] {
  return signals.map((signal) => [
    code(signal.source_path),
    `${signal.source_range.start_line}`,
    escapeCell(signal.object),
    signal.confidence,
  ]);
}

/** Artifacts carrying an explicit status, one row per artifact. */
function statusRows(index: CorpusIndex, statuses: readonly string[]): string[][] {
  return index.artifacts
    .filter((artifact) => artifact.work_signal_summary.statuses.some((value) => statuses.includes(value)))
    .map((artifact) => [
      code(artifact.source_path),
      artifact.work_signal_summary.statuses.join(", "),
      artifact.work_signal_summary.kinds.join(", ") || "—",
      `${artifact.work_signal_summary.open_task_count}`,
    ]);
}

function relationRows(index: CorpusIndex, predicate: string): string[][] {
  return byPredicate(index, predicate).map((signal) => [
    code(signal.source_path),
    `${signal.source_range.start_line}`,
    escapeCell(signal.object),
  ]);
}

function candidateRows(candidates: readonly NearDuplicateCandidate[]): string[][] {
  return candidates.map((candidate) => [
    candidate.score.toFixed(4),
    code(candidate.source_path_a),
    code(candidate.source_path_b),
    `${candidate.shared_shingle_count}/${candidate.union_shingle_count}`,
  ]);
}

function planRows(index: CorpusIndex): string[][] {
  return index.artifacts
    .filter((artifact) => artifact.work_signal_summary.kinds.length > 0)
    .map((artifact: CorpusArtifact) => [
      code(artifact.source_path),
      artifact.work_signal_summary.kinds.join(", "),
      artifact.work_signal_summary.titles.map(escapeCell).join(" / ") || "—",
      artifact.work_signal_summary.statuses.join(", ") || "—",
    ]);
}

/** A heading, an optional prose lead, and a table — the shape every section has. */
function section(heading: string, prose: string[], body: string[]): string[] {
  return [heading, "", ...(prose.length > 0 ? [...prose, ""] : []), ...body];
}

/** The summary table's rows, which are the only place raw counts appear. */
function summaryRows(index: CorpusIndex): string[][] {
  const { summary, analysis_profile: profile, repository_model: model } = index;
  const interpretation = model.interpretation_profile;
  return [
    ["source revision", code(index.source.source_revision)],
    ["physical snapshot", code(index.source.physical_snapshot_hash)],
    ["repository model packet", code(model.packet_id)],
    ["packet semantic hash", code(model.semantic_hash)],
    ["interpretation profile", code(
      interpretation ? `${interpretation.profile_id}@${interpretation.profile_version}` : "not run",
    )],
    ["corpus profile", code(`${profile.corpus_profile_id}@${profile.corpus_profile_version}`)],
    ["artifacts", `${summary.artifact_count}`],
    ["archives", `${summary.archive_count}`],
    ["archive members", `${summary.archive_member_count}`],
    ["interpreted artifacts", `${summary.interpreted_artifact_count}`],
    ["assertions", `${summary.assertion_count}`],
    ["artifacts with work signals", `${summary.artifacts_with_work_signals}`],
    ["exact duplicate clusters", `${summary.exact_duplicate_cluster_count}`],
    ["exact duplicate artifacts", `${summary.exact_duplicate_artifact_count}`],
    ["recoverable duplicate bytes", `${summary.recoverable_duplicate_bytes}`],
    ["near-duplicate candidates", `${summary.near_duplicate_candidate_count}`],
    ["open tasks", `${summary.open_task_count}`],
    ["completed tasks", `${summary.completed_task_count}`],
    ["milestones", `${summary.milestone_count}`],
    ["declared plans", `${summary.plan_count}`],
    ["declared roadmaps", `${summary.roadmap_count}`],
    ["declared WIP", `${summary.wip_count}`],
    ["declared drafts", `${summary.draft_count}`],
    ["declared blocked", `${summary.blocked_count}`],
  ];
}

/** The work-signal subsections, each one an explicit statement documents made. */
function workSignalSections(index: CorpusIndex): string[] {
  const signalTable = (heading: string, column: string, predicate: string, empty: string): string[] =>
    section(`### ${heading}`, [], table(
      ["artifact", "line", column, "confidence"],
      signalRows(byPredicate(index, predicate)),
      empty,
    ));
  return [
    ...section("## Work Signals", [
      "Every row below is an explicit statement a document makes about itself, cited to the",
      "line that makes it. Nothing here is inferred from a filename, a path, a modification",
      "time, or the absence of a signal. Where a document states two conflicting things, both",
      "appear.",
    ], []),
    ...section("### Plans and Roadmaps", [], table(
      ["artifact", "declared kind", "declared title", "declared status"],
      planRows(index),
      "No artifact declares a work kind.",
    )),
    ...section("### WIP and Drafts", [], table(
      ["artifact", "declared status", "declared kind", "open tasks"],
      statusRows(index, ["wip", "draft"]),
      "No artifact declares itself WIP or draft.",
    )),
    ...section("### Blocked Work", [], table(
      ["artifact", "declared status", "declared kind", "open tasks"],
      statusRows(index, ["blocked"]),
      "No artifact declares itself blocked.",
    )),
    ...signalTable("Open Tasks", "task", "work.task.open", "No open task is declared."),
    ...signalTable("Completed Tasks", "task", "work.task.completed", "No completed task is declared."),
    ...signalTable("Milestones", "milestone", "work.milestone", "No milestone is declared."),
  ];
}

/** The five declared-relation subsections, in a fixed order. */
const RELATION_SECTIONS: readonly (readonly [string, string, string])[] = [
  ["Depends On", "work.depends_on", "No dependency is declared."],
  ["Blocked By", "work.blocked_by", "No blocker is declared."],
  ["References", "work.references", "No reference is declared."],
  ["Supersedes", "work.supersedes", "No supersession is declared."],
  ["Superseded By", "work.superseded_by", "No document declares itself superseded."],
];

function relationSections(index: CorpusIndex): string[] {
  return [
    ...section("## Explicit Relationships", [
      "Declared pointers, carried as the exact target text each document wrote. A target is",
      "not resolved to an artifact unless the document named an observed path outright.",
    ], []),
    ...RELATION_SECTIONS.flatMap(([heading, predicate, empty]) => section(
      `### ${heading}`,
      [],
      table(["artifact", "line", "declared target"], relationRows(index, predicate), empty),
    )),
  ];
}

function diagnosticsSections(index: CorpusIndex): string[] {
  const counted = (rows: { code: string; severity: string; count: number }[]): string[][] =>
    rows.map((entry) => [code(entry.code), entry.severity, `${entry.count}`]);
  return [
    ...section("## Diagnostics and Coverage Gaps", [
      "What the observation could not establish, carried forward rather than rounded away.",
    ], []),
    ...section("### Packet diagnostics", [], table(
      ["code", "severity", "count"],
      counted(index.diagnostics.packet),
      "The packet reported no diagnostics.",
    )),
    ...section("### Interpretation diagnostics", [], table(
      ["code", "severity", "count"],
      counted(index.diagnostics.interpretation),
      "Interpretation reported no diagnostics.",
    )),
    ...section("### Artifacts outside the similarity analysis", [], table(
      ["reason", "count"],
      [...index.diagnostics.near_duplicate_excluded]
        .sort((left, right) => compareCodePoints(left.reason, right.reason))
        .map((entry) => [code(entry.reason), `${entry.count}`]),
      "Every observed artifact was eligible for the similarity analysis.",
    )),
  ];
}

/**
 * Render the report.
 *
 * Section order, row order and wording are fixed, so re-rendering the same index
 * produces the same bytes. No timestamp is written: an observation instant is
 * operational, and putting one here would make every regeneration a diff.
 */
/**
 * The semantic candidate sections.
 *
 * Every sentence here obeys the same rule the documents do: a candidate is
 * offered, never asserted. The words "same project", "should merge", "should
 * delete", "obsolete" and "abandoned" do not appear, because none of them is
 * something this analysis is entitled to say.
 */
function semanticSections(index: CorpusIndex): string[] {
  const semantic = index.semantic;
  if (semantic === null) {
    return section("## Semantic Analysis Coverage", [
      "Semantic candidate discovery did not run for this observation, so this report carries no",
      "topic, project, consolidation or reasoning candidates. That is different from finding none:",
      "nothing looked.",
    ], []);
  }

  const byArtifact = semantic.candidate_ids_by_artifact;
  const artifactsIn = (pick: (entry: {
    topic_candidate_ids: string[];
    project_candidate_ids: string[];
    consolidation_candidate_ids: string[];
    reasoning_candidate_ids: string[];
  }) => string[]): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    for (const artifact of index.artifacts) {
      for (const candidateId of pick(byArtifact[artifact.artifact_id] ?? {
        topic_candidate_ids: [], project_candidate_ids: [],
        consolidation_candidate_ids: [], reasoning_candidate_ids: [],
      })) {
        const members = out.get(candidateId) ?? [];
        members.push(artifact.source_path);
        out.set(candidateId, members);
      }
    }
    return out;
  };

  const rowsFor = (members: Map<string, string[]>): string[][] =>
    [...members.entries()]
      .sort((left, right) => compareCodePoints(left[0], right[0]))
      .map(([candidateId, paths]) => [
        code(candidateId),
        `${paths.length}`,
        paths.map(code).join("<br>"),
      ]);

  return [
    ...section("## Candidate Topics", [
      "Groups of artifacts that appear related by supporting signals — shared titles, shared",
      "headings, shared salient vocabulary. A candidate topic means these documents show evidence",
      "of discussing related subject matter. It does not mean they belong together.",
    ], table(
      ["candidate", "members", "artifacts"],
      rowsFor(artifactsIn((entry) => entry.topic_candidate_ids)),
      "No group of artifacts reached the corroboration required for a topic candidate.",
    )),
    ...section("## Candidate Bodies of Work", [
      "Groups admitted on declared identity, an explicit reference or dependency between",
      "documents, or lexical similarity corroborated by a second independent kind of evidence.",
      "Similarity alone never admits a group here, and neither does a shared folder or archive.",
      "No name is synthesized for any group: identifiers shown are ones a manifest declared.",
    ], table(
      ["candidate", "members", "artifacts"],
      rowsFor(artifactsIn((entry) => entry.project_candidate_ids)),
      "No group of artifacts carries evidence of belonging to one body of work.",
    )),
    ...section("## Consolidation Review Candidates", [
      "Groups worth inspecting together, because they contain byte-identical copies, documents",
      "of high lexical similarity, or a declared supersession. This section recommends no action:",
      "it does not identify a copy to keep, and it does not propose removing anything.",
    ], table(
      ["candidate", "members", "artifacts"],
      rowsFor(artifactsIn((entry) => entry.consolidation_candidate_ids)),
      "No group of artifacts carries duplicate, similarity or supersession evidence.",
    )),
    ...section("## Candidates Recommended for Later Reasoning", [
      "Candidates whose evidence is ambiguous in a way that reading might resolve — contradictory",
      "declared statuses, a supersession pointing two ways, several variants of one document.",
      "Reasoning-eligible means spending attention on it may be useful. It does not mean the",
      "candidate is important, correct, or valuable, and this package does not adjudicate it.",
    ], table(
      ["candidate", "members", "artifacts"],
      rowsFor(artifactsIn((entry) => entry.reasoning_candidate_ids)),
      "No candidate carries the kind of ambiguity that later reasoning could settle.",
    )),
    ...section("## Semantic Analysis Coverage", [
      "What the semantic pass computed, and under which versioned profiles.",
    ], table(
      ["measure", "value"],
      [
        ["pair relations scored", `${semantic.semantic_pair_count}`],
        ["topic candidates", `${semantic.topic_candidate_count}`],
        ["candidate bodies of work", `${semantic.project_candidate_count}`],
        ["consolidation candidates", `${semantic.consolidation_candidate_count}`],
        ["reasoning eligible", `${semantic.reasoning_eligible_count}`],
        ["embeddings", semantic.embedding_enabled ? "enabled" : "disabled"],
        ["embedding provider", semantic.embedding_provider_when_enabled ?? "—"],
        ["embedding model", semantic.embedding_model_when_enabled ?? "—"],
        ["artifacts eligible for embedding", `${semantic.embedding_eligible_artifact_count}`],
        ["artifacts embedded", `${semantic.embedded_artifact_count}`],
        ["keyphrase profile", code(semantic.keyphrase_profile)],
        ["fusion profile", code(semantic.semantic_fusion_profile)],
        ["reasoning routing profile", code(semantic.reasoning_routing_profile)],
        ["model calls", "0"],
      ],
      "No semantic measurements are available.",
    )),
  ];
}

export function renderCorpusReport(index: CorpusIndex): string {
  const profile = index.analysis_profile;
  const lines = [
    `# Corpus report — ${index.source.source_name}`,
    "",
    "Read-only observation. No file under the source was moved, deleted, rewritten, or consolidated.",
    "",
    ...section("## Corpus Summary", [], table(
      ["measure", "value"],
      summaryRows(index),
      "No measurements are available.",
    )),
    ...workSignalSections(index),
    ...relationSections(index),
    ...section("## Exact Duplicate Clusters", [
      "Byte-identical files. Membership is content-hash equality, so a physical file and a",
      "file inside an archive can share a cluster. The representative is a deterministic",
      "rendering anchor — every member of a cluster is exactly equivalent to every other, and",
      "naming one says nothing about which copy anything should be done with.",
    ], table(
      ["count", "recoverable bytes", "representative", "other members"],
      index.exact_duplicate_clusters.map((cluster) => [
        `${cluster.count}`,
        `${cluster.recoverable_bytes}`,
        code(cluster.representative_source_path),
        cluster.source_paths
          .filter((sourcePath) => sourcePath !== cluster.representative_source_path)
          .map(code)
          .join("<br>"),
      ]),
      "No two observed artifacts are byte-identical.",
    )),
    ...section("## Near-Duplicate Candidates", [
      `Candidates from \`${profile.near_duplicate_method}\` at a lexical similarity threshold`,
      `of ${profile.near_duplicate_threshold}. The score is the exact Jaccard overlap of the unique`,
      "5-token shingles of two normalized documents.",
      "",
      "A candidate means the two documents share wording. It does not establish that they",
      "cover one subject, belong to one effort, supersede one another, or that anything",
      "should be done about them. Byte-identical files are excluded here and reported as",
      "exact duplicates above.",
    ], table(
      ["score", "artifact a", "artifact b", "shared/union shingles"],
      candidateRows(index.near_duplicate_candidates),
      profile.near_duplicate_enabled
        ? "No pair of eligible documents reaches the similarity threshold."
        : "Similarity analysis was disabled for this run.",
    )),
    ...section("## Archives and Virtual Members", [
      "Archives are observed in place and expanded into tool-owned staging. Members are",
      "carried as virtual artifacts named `<archive>!/<member>`; nothing is extracted beside",
      "the source.",
    ], table(
      ["archive", "depth", "expanded", "members", "omitted", "holds"],
      index.archives.map((archive) => [
        code(archive.source_path),
        `${archive.nested_depth}`,
        archive.expanded ? "yes" : "no",
        `${archive.member_count}`,
        `${archive.omitted_member_count}`,
        archive.hold_codes.length > 0 ? archive.hold_codes.map(code).join(", ") : "—",
      ]),
      "No archive was observed.",
    )),
    ...semanticSections(index),
    ...diagnosticsSections(index),
  ];

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
