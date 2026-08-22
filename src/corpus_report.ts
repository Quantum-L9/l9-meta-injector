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
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
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

/**
 * Render the report.
 *
 * Section order, row order and wording are fixed, so re-rendering the same index
 * produces the same bytes. No timestamp is written: an observation instant is
 * operational, and putting one here would make every regeneration a diff.
 */
export function renderCorpusReport(index: CorpusIndex): string {
  const { summary, analysis_profile: profile } = index;
  const lines: string[] = [];

  lines.push(`# Corpus report — ${index.source.source_name}`, "");
  lines.push(
    "Read-only observation. No file under the source was moved, deleted, rewritten, or consolidated.",
    "",
  );

  lines.push("## Corpus Summary", "");
  lines.push(
    ...table(
      ["measure", "value"],
      [
        ["source revision", code(index.source.source_revision)],
        ["physical snapshot", code(index.source.physical_snapshot_hash)],
        ["repository model packet", code(index.repository_model.packet_id)],
        ["packet semantic hash", code(index.repository_model.semantic_hash)],
        ["interpretation profile", code(
          index.repository_model.interpretation_profile
            ? `${index.repository_model.interpretation_profile.profile_id}@${index.repository_model.interpretation_profile.profile_version}`
            : "not run",
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
      ],
      "No measurements are available.",
    ),
  );

  lines.push("## Work Signals", "");
  lines.push(
    "Every row below is an explicit statement a document makes about itself, cited to the",
    "line that makes it. Nothing here is inferred from a filename, a path, a modification",
    "time, or the absence of a signal. Where a document states two conflicting things, both",
    "appear.",
    "",
  );

  lines.push("### Plans and Roadmaps", "");
  lines.push(...table(
    ["artifact", "declared kind", "declared title", "declared status"],
    planRows(index),
    "No artifact declares a work kind.",
  ));

  lines.push("### WIP and Drafts", "");
  lines.push(...table(
    ["artifact", "declared status", "declared kind", "open tasks"],
    statusRows(index, ["wip", "draft"]),
    "No artifact declares itself WIP or draft.",
  ));

  lines.push("### Blocked Work", "");
  lines.push(...table(
    ["artifact", "declared status", "declared kind", "open tasks"],
    statusRows(index, ["blocked"]),
    "No artifact declares itself blocked.",
  ));

  lines.push("### Open Tasks", "");
  lines.push(...table(
    ["artifact", "line", "task", "confidence"],
    signalRows(byPredicate(index, "work.task.open")),
    "No open task is declared.",
  ));

  lines.push("### Completed Tasks", "");
  lines.push(...table(
    ["artifact", "line", "task", "confidence"],
    signalRows(byPredicate(index, "work.task.completed")),
    "No completed task is declared.",
  ));

  lines.push("### Milestones", "");
  lines.push(...table(
    ["artifact", "line", "milestone", "confidence"],
    signalRows(byPredicate(index, "work.milestone")),
    "No milestone is declared.",
  ));

  lines.push("## Explicit Relationships", "");
  lines.push(
    "Declared pointers, carried as the exact target text each document wrote. A target is",
    "not resolved to an artifact unless the document named an observed path outright.",
    "",
  );
  for (const [heading, predicate, empty] of [
    ["Depends On", "work.depends_on", "No dependency is declared."],
    ["Blocked By", "work.blocked_by", "No blocker is declared."],
    ["References", "work.references", "No reference is declared."],
    ["Supersedes", "work.supersedes", "No supersession is declared."],
    ["Superseded By", "work.superseded_by", "No document declares itself superseded."],
  ] as const) {
    lines.push(`### ${heading}`, "");
    lines.push(...table(["artifact", "line", "declared target"], relationRows(index, predicate), empty));
  }

  lines.push("## Exact Duplicate Clusters", "");
  lines.push(
    "Byte-identical files. Membership is content-hash equality, so a physical file and a",
    "file inside an archive can share a cluster. The representative is a deterministic",
    "rendering anchor — every member of a cluster is exactly equivalent to every other, and",
    "naming one says nothing about which copy anything should be done with.",
    "",
  );
  lines.push(...table(
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
  ));

  lines.push("## Near-Duplicate Candidates", "");
  lines.push(
    `Candidates from \`${profile.near_duplicate_method}\` at a lexical similarity threshold`,
    `of ${profile.near_duplicate_threshold}. The score is the exact Jaccard overlap of the unique`,
    "5-token shingles of two normalized documents.",
    "",
    "A candidate means the two documents share wording. It does not establish that they",
    "cover one subject, belong to one effort, supersede one another, or that anything",
    "should be done about them. Byte-identical files are excluded here and reported as",
    "exact duplicates above.",
    "",
  );
  lines.push(...table(
    ["score", "artifact a", "artifact b", "shared/union shingles"],
    candidateRows(index.near_duplicate_candidates),
    profile.near_duplicate_enabled
      ? "No pair of eligible documents reaches the similarity threshold."
      : "Similarity analysis was disabled for this run.",
  ));

  lines.push("## Archives and Virtual Members", "");
  lines.push(
    "Archives are observed in place and expanded into tool-owned staging. Members are",
    "carried as virtual artifacts named `<archive>!/<member>`; nothing is extracted beside",
    "the source.",
    "",
  );
  lines.push(...table(
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
  ));

  lines.push("## Diagnostics and Coverage Gaps", "");
  lines.push(
    "What the observation could not establish, carried forward rather than rounded away.",
    "",
  );
  lines.push("### Packet diagnostics", "");
  lines.push(...table(
    ["code", "severity", "count"],
    index.diagnostics.packet.map((entry) => [code(entry.code), entry.severity, `${entry.count}`]),
    "The packet reported no diagnostics.",
  ));
  lines.push("### Interpretation diagnostics", "");
  lines.push(...table(
    ["code", "severity", "count"],
    index.diagnostics.interpretation.map((entry) => [code(entry.code), entry.severity, `${entry.count}`]),
    "Interpretation reported no diagnostics.",
  ));
  lines.push("### Artifacts outside the similarity analysis", "");
  lines.push(...table(
    ["reason", "count"],
    [...index.diagnostics.near_duplicate_excluded]
      .sort((left, right) => compareCodePoints(left.reason, right.reason))
      .map((entry) => [code(entry.reason), `${entry.count}`]),
    "Every observed artifact was eligible for the similarity analysis.",
  ));

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
