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
import { canonicalCorpusJson } from "./corpus_analysis";
import { compareCodePoints } from "./ordering";
import type { CorpusCoverage } from "./corpus_coverage";
import type { CorpusDocumentSignals } from "./corpus_document_signals";
import type { CorpusSnapshot } from "./corpus_snapshot";

export const CORPUS_INDEX_SCHEMA = "l9.corpus-index/v1";

/** One root, as the index points at it. */
export interface CorpusIndexRoot {
  root_id: string;
  root_key: string;
  source_kind: string;
  source_revision: string;
  rmp_packet_id: string;
  rmp_semantic_hash: string;
  bundle_ref: string | null;
  document_index_ref: string | null;
  document_coverage_ref: string | null;
  acquisition_manifest_ref: string | null;
  observation_status: string;
  failure_reason: string | null;
  artifact_count: number;
  archive_count: number;
  total_bytes: number;
}

/** A document this run wrote, named so a consumer does not have to guess. */
export interface CorpusIndexArtifactRef {
  name: string;
  path: string;
  schema: string | null;
  present: boolean;
}

export interface CorpusIndex {
  schema: string;
  corpus_id: string;
  corpus_source_snapshot_id: string;
  corpus_analysis_id: string;
  corpus_status: string;
  roots: CorpusIndexRoot[];
  missing_root_ids: string[];
  counts: CorpusSnapshot["counts"];
  documents: CorpusIndexArtifactRef[];
  /**
   * What was understood, and what was not.
   *
   * Present so the report an operator reads can answer the question the corpus
   * exists to answer — "we inspected this and found nothing" against "we could
   * not understand this" — without their having to open two JSON files and join
   * them by hand. Optional because an index can be built from a snapshot alone,
   * and a coverage section invented from one would be a fabrication.
   */
  coverage?: CorpusIndexCoverage;
  statement: string;
}

/** Every count the coverage law requires the report to state. */
export interface CorpusIndexCoverage {
  hashed_artifact_count: number;
  unhashed_artifact_count: number;
  /** Per format: eligible, decoded, and the refusals, by the decoder's reason. */
  decoding: {
    format: string;
    decoder_id: string;
    eligible_count: number;
    decoded_count: number;
    interpreted_count: number;
    refusals: { name: string; count: number }[];
  }[];
  ocr_required_count: number;
  encrypted_count: number;
  unsupported_legacy_counts: { extension: string; count: number; bytes: number }[];
  decoder_failure_count: number;
  intelligence: {
    artifacts_with_work_signals: number;
    exact_duplicate_clusters: number;
    near_duplicate_candidates: number;
    topic_candidates: number;
    project_candidates: number;
    consolidation_candidates: number;
    reasoning_eligible_candidates: number;
  };
  embedding: {
    enabled: boolean;
    eligible_artifacts: number | null;
    embedded_artifacts: number | null;
    skipped_secret_artifacts: number | null;
    provider_failures: number | null;
  };
}

export const CORPUS_INDEX_STATEMENT =
  "This index names what was observed and where each document was written. It contains no "
  + "ranking, no priority and no recommendation, and the order of any list in it carries none.";

export interface BuildCorpusIndexInput {
  snapshot: CorpusSnapshot;
  /** Root-directory name for each root id, as written under `roots/`. */
  rootDirectories: ReadonlyMap<string, string>;
  /** Output-relative paths this run actually wrote. */
  writtenPaths: readonly string[];
  /** The coverage document and the document signals, joined into the report. */
  coverage?: CorpusCoverage;
  documentSignals?: CorpusDocumentSignals;
}

/**
 * Join the two coverage documents into the counts the report states.
 *
 * Both already exist as JSON. What did not exist was one place a person could
 * read them together — and "eleven PDFs decoded" beside "zero PDFs understood"
 * is a finding that neither file states on its own.
 */
function coverageFor(
  coverage: CorpusCoverage,
  signals: CorpusDocumentSignals | undefined,
): CorpusIndexCoverage {
  const participation = new Map(
    (signals?.analysis_participation.by_format ?? []).map((entry) => [entry.format, entry]),
  );
  return {
    hashed_artifact_count: coverage.exact_hash_coverage.covered,
    unhashed_artifact_count:
      coverage.exact_hash_coverage.eligible - coverage.exact_hash_coverage.covered,
    decoding: (signals?.formats ?? []).map((entry) => ({
      format: entry.format,
      decoder_id: entry.decoder_id,
      eligible_count: entry.eligible_count,
      decoded_count: entry.decoded_count,
      interpreted_count: participation.get(entry.format)?.interpreted_count ?? 0,
      refusals: entry.refusals.map((refusal) => ({ ...refusal })),
    })),
    ocr_required_count: coverage.documents.ocr_required_count,
    encrypted_count: coverage.documents.encrypted_document_count,
    unsupported_legacy_counts: coverage.unsupported_format_counts.map((entry) => ({ ...entry })),
    decoder_failure_count: coverage.documents.decoder_failure_count,
    intelligence: {
      artifacts_with_work_signals: coverage.semantics.work_signal_artifact_count,
      exact_duplicate_clusters: coverage.semantics.exact_duplicate_cluster_count,
      near_duplicate_candidates: coverage.semantics.near_duplicate_candidate_count,
      topic_candidates: coverage.semantics.topic_candidate_count,
      project_candidates: coverage.semantics.project_candidate_count,
      consolidation_candidates: coverage.semantics.consolidation_candidate_count,
      reasoning_eligible_candidates:
        coverage.reasoning_handoff.reasoning_eligible_candidate_count,
    },
    embedding: {
      enabled: coverage.embeddings.enabled,
      eligible_artifacts: coverage.embeddings.eligible_count,
      embedded_artifacts: coverage.embeddings.embedded_count,
      skipped_secret_artifacts: coverage.embeddings.secret_skipped_count,
      provider_failures: coverage.embeddings.provider_failure_count,
    },
  };
}

/** Named documents a corpus run may write, in the order a reader meets them. */
const KNOWN_DOCUMENTS: { name: string; path: string; schema: string | null }[] = [
  { name: "snapshot", path: "corpus-snapshot.json", schema: "l9.corpus-snapshot/v1" },
  { name: "diff", path: "corpus-diff.json", schema: "l9.corpus-diff/v1" },
  { name: "coverage", path: "corpus-coverage.json", schema: "l9.corpus-coverage/v1" },
  { name: "readiness_evidence", path: "readiness-evidence.json", schema: "l9.readiness-evidence/v1" },
  { name: "candidates", path: "corpus-candidates.json", schema: "l9.corpus-candidates/v1" },
  { name: "document_index", path: "document-index.json", schema: "l9.document-index/v2" },
  {
    name: "document_signals",
    path: "document-signals.json",
    schema: "l9.document-signals/v1",
  },
  {
    name: "document_work_signals",
    path: "document-work-signals.jsonl",
    schema: "l9.document-work-signals/v1",
  },
  {
    name: "document_work_signals_manifest",
    path: "document-work-signals.manifest.json",
    schema: "l9.document-work-signals-manifest/v1",
  },
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

export function buildCorpusIndex(input: BuildCorpusIndexInput): CorpusIndex {
  const { snapshot } = input;
  const written = new Set(input.writtenPaths);

  const artifactsByRoot = new Map<string, { count: number; bytes: number }>();
  for (const artifact of snapshot.artifacts) {
    const tally = artifactsByRoot.get(artifact.root_id) ?? { count: 0, bytes: 0 };
    tally.count += 1;
    tally.bytes += artifact.size_bytes ?? 0;
    artifactsByRoot.set(artifact.root_id, tally);
  }
  const archivesByRoot = new Map<string, number>();
  for (const archive of snapshot.archives) {
    archivesByRoot.set(archive.root_id, (archivesByRoot.get(archive.root_id) ?? 0) + 1);
  }

  const roots: CorpusIndexRoot[] = snapshot.roots.map((root) => {
    const directory = input.rootDirectories.get(root.root_id);
    const under = (file: string): string | null =>
      directory === undefined ? null : `roots/${directory}/${file}`;
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
  }).sort((a, b) => compareCodePoints(a.root_id, b.root_id));

  return {
    schema: CORPUS_INDEX_SCHEMA,
    corpus_id: snapshot.corpus_id,
    corpus_source_snapshot_id: snapshot.corpus_source_snapshot_id,
    corpus_analysis_id: snapshot.analysis.corpus_analysis_id,
    corpus_status: snapshot.corpus_status,
    roots,
    missing_root_ids: [...snapshot.missing_root_ids].sort(compareCodePoints),
    counts: snapshot.counts,
    // Absence is reported rather than omitted: a consumer that cannot find
    // `corpus-diff.json` should be able to tell "this run made no comparison"
    // from "this run wrote it somewhere else".
    documents: KNOWN_DOCUMENTS.map((document) => ({
      ...document,
      present: written.has(document.path),
    })),
    ...(input.coverage !== undefined
      ? { coverage: coverageFor(input.coverage, input.documentSignals) }
      : {}),
    statement: CORPUS_INDEX_STATEMENT,
  };
}

/** Canonical bytes of the index. */
export function renderCorpusIndex(index: CorpusIndex): string {
  return `${canonicalCorpusJson(index)}\n`;
}

function row(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/**
 * What the run understood, stated so the two failures cannot be confused.
 *
 * "Nothing found here" and "this could not be read" look identical in a total.
 * Split by format, with the refusal reasons the decoders actually gave, they are
 * two different rows — which is the whole difference between a corpus an
 * operator can act on and a number they have to trust.
 */
function coverageSection(index: CorpusIndex): string[] {
  const coverage = index.coverage;
  if (coverage === undefined) return [];
  const embedding = coverage.embedding;
  const value = (count: number | null): string => (count === null ? "—" : `${count}`);
  const lines = [
    "## Exact observation",
    "",
    row(["count", "value"]),
    row(["---", "---"]),
    row(["artifacts hashed", `${coverage.hashed_artifact_count}`]),
    row(["artifacts unhashed", `${coverage.unhashed_artifact_count}`]),
    "",
    "## Decoding",
    "",
    "`eligible` is what a decoder claimed, `decoded` is what it read, and",
    "`understood` is how many of those were found to state anything. A format",
    "decoded but never understood is a decoder wired to nothing.",
    "",
    row(["format", "decoder", "eligible", "decoded", "understood", "refused"]),
    row(["---", "---", "---", "---", "---", "---"]),
    ...coverage.decoding.map((entry) => row([
      entry.format,
      `\`${entry.decoder_id}\``,
      `${entry.eligible_count}`,
      `${entry.decoded_count}`,
      `${entry.interpreted_count}`,
      entry.refusals.map((refusal) => `${refusal.name} ${refusal.count}`).join(", ") || "—",
    ])),
    "",
    row(["gap", "count"]),
    row(["---", "---"]),
    row(["needs OCR", `${coverage.ocr_required_count}`]),
    row(["encrypted", `${coverage.encrypted_count}`]),
    row(["decoder failures", `${coverage.decoder_failure_count}`]),
    "",
  ];
  if (coverage.unsupported_legacy_counts.length > 0) {
    lines.push(
      "Formats no decoder in this release claims, by extension. Counted rather than",
      "omitted: an operator has to be able to see how much of an archive is invisible.",
      "",
      row(["extension", "artifacts", "bytes"]),
      row(["---", "---", "---"]),
      ...coverage.unsupported_legacy_counts.map((entry) => row([
        `\`${entry.extension}\``,
        `${entry.count}`,
        `${entry.bytes}`,
      ])),
      "",
    );
  }
  lines.push(
    "## Intelligence",
    "",
    row(["finding", "count"]),
    row(["---", "---"]),
    row(["artifacts with work signals", `${coverage.intelligence.artifacts_with_work_signals}`]),
    row(["exact duplicate clusters", `${coverage.intelligence.exact_duplicate_clusters}`]),
    row(["near-duplicate candidates", `${coverage.intelligence.near_duplicate_candidates}`]),
    row(["topic candidates", `${coverage.intelligence.topic_candidates}`]),
    row(["project candidates", `${coverage.intelligence.project_candidates}`]),
    row(["consolidation candidates", `${coverage.intelligence.consolidation_candidates}`]),
    row(["reasoning-eligible candidates", `${coverage.intelligence.reasoning_eligible_candidates}`]),
    "",
    "Every row above is a candidate or an observation. None is a ranking, a",
    "priority, or an instruction to do anything with the files it names.",
    "",
    "## Embedding",
    "",
    row(["field", "value"]),
    row(["---", "---"]),
    row(["enabled", embedding.enabled ? "yes" : "no"]),
    row(["eligible artifacts", value(embedding.eligible_artifacts)]),
    row(["embedded artifacts", value(embedding.embedded_artifacts)]),
    row(["skipped as secret candidates", value(embedding.skipped_secret_artifacts)]),
    row(["provider failures", value(embedding.provider_failures)]),
    "",
  );
  return lines;
}

/** The same index, rendered for a person. */
export function renderCorpusIndexReport(index: CorpusIndex): string {
  const lines: string[] = [
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
    ...coverageSection(index),
    index.statement,
    "",
  ];
  if (index.missing_root_ids.length > 0) {
    lines.splice(
      lines.indexOf("## Corpus size"),
      0,
      "## Missing roots",
      "",
      "These roots were named and were not observed. Every count above is a count over",
      "the roots that were.",
      "",
      ...index.missing_root_ids.map((rootId) => `- ${rootId}`),
      "",
    );
  }
  return lines.join("\n");
}
