// corpus_analysis.ts — derived analysis over an acquired corpus.
//
// Three layers meet here, and keeping them apart is the point of the module:
//
//   acquisition   (local_source)     what files exist and what bytes they hold
//   interpretation                   what each file declares, with a cited span
//   corpus analysis (this file)      what those two together imply about the set
//
// Nothing below invents a fact. Exact duplicates are byte equality, which is
// decidable. Near-duplicate candidates are a lexical score with a stated
// algorithm and threshold, and they are candidates — they do not mean two
// documents are about the same thing, and no code path here upgrades them into
// a DUPLICATE_OF edge, a merge recommendation, or a topic.
//
// The corpus index is a projection. Every value in it comes from the acquisition
// observation, the emitted Repository Model Packet, the exact-duplicate
// clustering, or the near-duplicate analysis. It never re-reads a source file to
// discover something those four did not already establish, and it never writes
// anything into the observed source.
import * as fs from "node:fs";
import { InventoryRecord, InventoryResult } from "./inventory";
import {
  DEFAULT_MAX_FILE_BYTES,
  InterpretationResult,
  InterpretedAssertion,
  isSecretCandidatePath,
} from "./interpretation";
import { canonicalPair, compareCodePoints } from "./ordering";
import { probeFileEncoding } from "./encoding";
import {
  RepositoryModelArtifactRecord,
  RepositoryModelDiagnostic,
  RepositoryModelPacket,
  repositoryModelArtifactId,
  sha256TextPrefixed,
  stableId,
} from "./repository_model";

// ───────────────────────────── identity ─────────────────────────────

export const CORPUS_INDEX_SCHEMA = "l9.corpus-index/v1";

/**
 * Identity of the corpus analysis policy.
 *
 * Bound to the work extractor versions, both duplicate algorithms, and the
 * near-duplicate threshold, because changing any of them changes which
 * candidates and which signals the index reports.
 */
export const CORPUS_PROFILE_ID = "l9-meta-injector-corpus-intelligence";
export const CORPUS_PROFILE_VERSION = "1.0.0";

/** Exact duplicate detection: byte equality of known content hashes. */
export const EXACT_DUPLICATE_METHOD = "content-hash-equality/v1";
export const EXACT_DUPLICATE_METHOD_VERSION = "1.0.0";

/** Near-duplicate detection: Jaccard over unique 5-token shingles. */
export const NEAR_DUPLICATE_METHOD = "text-near-duplicate/v1";
export const NEAR_DUPLICATE_METHOD_VERSION = "1.0.0";
export const NEAR_DUPLICATE_SHINGLE_SIZE = 5;
/** Below this token count a shingle set is too small for the score to mean much. */
export const NEAR_DUPLICATE_MIN_TOKENS = 20;
export const DEFAULT_NEAR_DUPLICATE_THRESHOLD = 0.85;
/** Extensions whose text this analysis reads. Mirrors the work-intelligence profile. */
export const NEAR_DUPLICATE_EXTENSIONS: readonly string[] = [".markdown", ".md", ".rst", ".txt"];

/** Decimal places a reported score is rounded to, so replays are byte-identical. */
const SCORE_PRECISION = 6;

// ───────────────────────────── canonical serialization ─────────────────────────────

/**
 * Deterministic JSON for the corpus index.
 *
 * The packet's `canonicalJson` refuses non-integer numbers, which is right for a
 * wire contract whose float formatting must not vary. The corpus index carries
 * similarity scores, so it needs its own renderer: keys in code-point order at
 * every depth, absent fields omitted rather than nulled, and every number finite
 * and already rounded by the producer.
 */
export function canonicalCorpusJson(value: unknown, indent = 2): string {
  const pad = (depth: number): string => (indent > 0 ? "\n" + " ".repeat(indent * depth) : "");
  const render = (node: unknown, depth: number): string => {
    if (node === null) return "null";
    if (typeof node === "boolean") return node ? "true" : "false";
    if (typeof node === "number") {
      if (!Number.isFinite(node)) throw new Error(`corpus-index: ${String(node)} is not serializable`);
      return String(node);
    }
    if (typeof node === "string") return JSON.stringify(node);
    if (Array.isArray(node)) {
      if (node.length === 0) return "[]";
      const items = node.map((item) => pad(depth + 1) + render(item, depth + 1));
      return `[${items.join(",")}${pad(depth)}]`;
    }
    if (typeof node === "object") {
      const source = node as Record<string, unknown>;
      const keys = Object.keys(source).filter((key) => source[key] !== undefined).sort(compareCodePoints);
      if (keys.length === 0) return "{}";
      const items = keys.map(
        (key) => `${pad(depth + 1)}${JSON.stringify(key)}:${indent > 0 ? " " : ""}${render(source[key], depth + 1)}`,
      );
      return `{${items.join(",")}${pad(depth)}}`;
    }
    throw new Error(`corpus-index: unsupported value of type ${typeof node}`);
  };
  return render(value, 0);
}

function roundScore(value: number): number {
  const factor = 10 ** SCORE_PRECISION;
  return Math.round(value * factor) / factor;
}

/** Fixed-width text form of a score, used where a float must enter an identity. */
function scoreKey(value: number): string {
  return roundScore(value).toFixed(SCORE_PRECISION);
}

// ───────────────────────────── near-duplicate algorithm ─────────────────────────────

/**
 * Normalize text for similarity analysis only.
 *
 * The result is never written anywhere and never replaces the file's own content
 * hash: it exists so that two documents differing only in line endings, casing or
 * whitespace are recognized as lexically close. Lowercasing here is why the
 * analysis is explicitly lexical rather than semantic.
 */
export function normalizeForAnalysis(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const TOKEN = /[\p{L}\p{N}_]+/gu;

/** Unicode word tokens of already-normalized text. */
export function analysisTokens(normalized: string): string[] {
  return normalized.match(TOKEN) ?? [];
}

/** The unique 5-token shingles of a token stream, in insertion order. */
export function shingleSet(tokens: string[], size = NEAR_DUPLICATE_SHINGLE_SIZE): Set<string> {
  const shingles = new Set<string>();
  if (tokens.length < size) return shingles;
  for (let index = 0; index + size <= tokens.length; index++) {
    shingles.add(tokens.slice(index, index + size).join(" "));
  }
  return shingles;
}

export interface JaccardResult {
  score: number;
  shared: number;
  union: number;
}

/** Exact Jaccard similarity of two shingle sets. */
export function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): JaccardResult {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let shared = 0;
  for (const shingle of small) if (large.has(shingle)) shared++;
  const union = left.size + right.size - shared;
  return { score: union === 0 ? 0 : shared / union, shared, union };
}

/** One document admitted to the similarity analysis. */
export interface NearDuplicateDocument {
  artifactId: string;
  sourcePath: string;
  /** Hash of the exact file bytes; equal hashes are exact duplicates, not candidates. */
  contentHash: string;
  /** Hash of the normalized analysis text, recorded so a score is reproducible. */
  normalizedContentHash: string;
  shingles: Set<string>;
  tokenCount: number;
}

/** Build the analysis view of one document's text. */
export function prepareNearDuplicateDocument(input: {
  artifactId: string;
  sourcePath: string;
  contentHash: string;
  text: string;
}): NearDuplicateDocument {
  const normalized = normalizeForAnalysis(input.text);
  const tokens = analysisTokens(normalized);
  return {
    artifactId: input.artifactId,
    sourcePath: input.sourcePath,
    contentHash: input.contentHash,
    normalizedContentHash: sha256TextPrefixed(normalized),
    shingles: shingleSet(tokens),
    tokenCount: tokens.length,
  };
}

export interface NearDuplicateCandidate {
  candidate_id: string;
  artifact_a_id: string;
  artifact_b_id: string;
  source_path_a: string;
  source_path_b: string;
  method: string;
  algorithm_version: string;
  score: number;
  threshold: number;
  normalized_content_hash_a: string;
  normalized_content_hash_b: string;
  shared_shingle_count: number;
  union_shingle_count: number;
}

function candidateFor(
  left: NearDuplicateDocument,
  right: NearDuplicateDocument,
  measured: JaccardResult,
  threshold: number,
): NearDuplicateCandidate {
  // The pair is ordered so the same two artifacts always produce the same
  // candidate, whichever one the scan reached first.
  const [firstId] = canonicalPair(left.artifactId, right.artifactId);
  const [a, b] = firstId === left.artifactId ? [left, right] : [right, left];
  return {
    candidate_id: stableId("near-duplicate", {
      algorithm_id: NEAR_DUPLICATE_METHOD,
      algorithm_version: NEAR_DUPLICATE_METHOD_VERSION,
      // A float cannot enter a canonical identity, so the threshold enters as its
      // fixed-precision text form.
      threshold: scoreKey(threshold),
      artifact_a_id: a.artifactId,
      artifact_b_id: b.artifactId,
      normalized_content_hash_a: a.normalizedContentHash,
      normalized_content_hash_b: b.normalizedContentHash,
    }),
    artifact_a_id: a.artifactId,
    artifact_b_id: b.artifactId,
    source_path_a: a.sourcePath,
    source_path_b: b.sourcePath,
    method: NEAR_DUPLICATE_METHOD,
    algorithm_version: NEAR_DUPLICATE_METHOD_VERSION,
    score: roundScore(measured.score),
    threshold: roundScore(threshold),
    normalized_content_hash_a: a.normalizedContentHash,
    normalized_content_hash_b: b.normalizedContentHash,
    shared_shingle_count: measured.shared,
    union_shingle_count: measured.union,
  };
}

/** True when a pair is out of scope for candidacy before any score is computed. */
function pairIneligible(left: NearDuplicateDocument, right: NearDuplicateDocument): boolean {
  // Byte-identical files are an exact duplicate fact. Reporting them again as a
  // similarity candidate would restate a certainty as an estimate.
  return left.contentHash === right.contentHash;
}

export function compareCandidates(left: NearDuplicateCandidate, right: NearDuplicateCandidate): number {
  return (
    right.score - left.score
    || compareCodePoints(left.artifact_a_id, right.artifact_a_id)
    || compareCodePoints(left.artifact_b_id, right.artifact_b_id)
    || compareCodePoints(left.candidate_id, right.candidate_id)
  );
}

/**
 * Every qualifying pair, compared exhaustively.
 *
 * This is the definition the reported score means. It is quadratic in the corpus
 * size and is kept as the reference the indexed generator below is required to
 * match.
 */
export function nearDuplicateCandidatesExhaustive(
  documents: NearDuplicateDocument[],
  threshold: number,
): NearDuplicateCandidate[] {
  const out: NearDuplicateCandidate[] = [];
  for (let i = 0; i < documents.length; i++) {
    for (let j = i + 1; j < documents.length; j++) {
      if (pairIneligible(documents[i], documents[j])) continue;
      const measured = jaccard(documents[i].shingles, documents[j].shingles);
      if (roundScore(measured.score) < roundScore(threshold)) continue;
      out.push(candidateFor(documents[i], documents[j], measured, threshold));
    }
  }
  return out.sort(compareCandidates);
}

/**
 * The prefix of a shingle set that a qualifying partner must intersect.
 *
 * For Jaccard at threshold `t`, a pair can only reach `t` if it shares at least
 * `ceil(t * |X|)` shingles with the smaller of the two sets. Under any fixed
 * global order over shingles, two sets that share that many elements must both
 * contain one of the first `|X| - ceil(t * |X|) + 1` of them — otherwise the
 * shared elements would all have to sit past a point where fewer than that many
 * elements remain. So indexing only that prefix loses no qualifying pair.
 */
export function prefixLength(setSize: number, threshold: number): number {
  if (setSize === 0) return 0;
  return Math.max(1, setSize - Math.ceil(roundScore(threshold) * setSize) + 1);
}

/**
 * The same qualifying pairs, reached through a shingle index.
 *
 * Two exact filters do the work, and both are consequences of the definition of
 * Jaccard rather than approximations of it:
 *
 *   - a size bound: a set can share at most `min(|A|, |B|)` shingles, so a pair
 *     whose sizes differ by more than a factor of `t` cannot reach `t`;
 *   - a prefix bound: shingles are put in one global order — rarest first — and
 *     only each document's prefix is indexed, because a qualifying pair must
 *     intersect there.
 *
 * The tests hold this to the bounded all-pairs reference above at six thresholds.
 * Rarest-first matters for cost rather than correctness: it puts the shingles
 * every document in a corpus shares — a boilerplate heading, a licence block —
 * at the end of the order, where they are never indexed and so never generate a
 * candidate list the size of the corpus. At a threshold of zero every pair
 * qualifies by definition, and the exhaustive path is used instead.
 */
export function nearDuplicateCandidates(
  documents: NearDuplicateDocument[],
  threshold: number,
): NearDuplicateCandidate[] {
  if (roundScore(threshold) <= 0) return nearDuplicateCandidatesExhaustive(documents, threshold);

  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const shingle of document.shingles) {
      documentFrequency.set(shingle, (documentFrequency.get(shingle) ?? 0) + 1);
    }
  }
  const globalOrder = (left: string, right: string): number =>
    (documentFrequency.get(left) ?? 0) - (documentFrequency.get(right) ?? 0)
    || compareCodePoints(left, right);

  // Smallest set first, so that when a document is compared it has already seen
  // every partner that could satisfy the size bound from below.
  const ordered = documents
    .map((document, index) => ({ document, index }))
    .sort(
      (left, right) =>
        left.document.shingles.size - right.document.shingles.size
        || compareCodePoints(left.document.artifactId, right.document.artifactId),
    );

  const postings = new Map<string, number[]>();
  const out: NearDuplicateCandidate[] = [];
  const seen = new Set<number>();

  for (let position = 0; position < ordered.length; position++) {
    const current = ordered[position].document;
    const size = current.shingles.size;
    if (size === 0) continue;
    const shingles = [...current.shingles].sort(globalOrder);
    const prefix = shingles.slice(0, prefixLength(size, threshold));

    // Candidates for this document only. Kept per document rather than for the
    // whole corpus, so a corpus of ten thousand documents never has to hold ten
    // thousand squared pair keys at once.
    seen.clear();
    for (const shingle of prefix) {
      for (const other of postings.get(shingle) ?? []) {
        if (seen.has(other)) continue;
        seen.add(other);
        const partner = ordered[other].document;
        // Size bound: `partner` is no larger than `current`, so a pair can only
        // reach the threshold when the smaller set is at least `t` of the larger.
        if (partner.shingles.size < roundScore(threshold) * size) continue;
        if (pairIneligible(current, partner)) continue;
        const measured = jaccard(current.shingles, partner.shingles);
        if (roundScore(measured.score) < roundScore(threshold)) continue;
        out.push(candidateFor(current, partner, measured, threshold));
      }
    }

    for (const shingle of prefix) {
      const bucket = postings.get(shingle);
      if (bucket === undefined) postings.set(shingle, [position]);
      else bucket.push(position);
    }
  }
  return out.sort(compareCandidates);
}

// ───────────────────────────── corpus inputs ─────────────────────────────

/**
 * The acquisition facts the corpus index projects.
 *
 * Structural rather than an import of `LocalSourceObservation`, so analysis never
 * acquires a dependency on how a corpus was acquired.
 */
export interface CorpusAcquisition {
  sourceName: string;
  sourceRevision: string;
  physicalSnapshotHash: string;
  inventory: InventoryResult;
  archives: readonly {
    sourcePath: string;
    contentHash: string;
    sizeBytes: number;
    nestedDepth: number;
    expanded: boolean;
    memberCount: number;
    omittedMemberCount: number;
    holds: readonly { code: string }[];
  }[];
  virtualArtifacts: readonly {
    virtualSourcePath: string;
    memberPath: string;
    contentHash: string;
    sizeBytes: number;
    parentArchivePath: string;
    parentArchiveHash: string;
    nestedDepth: number;
  }[];
  diagnostics: readonly { code: string; severity: string; message: string; sourcePath?: string }[];
}

export interface NearDuplicateOptions {
  /** Skip the similarity pass entirely. Exact duplicates are unaffected. */
  enabled?: boolean;
  threshold?: number;
  /** Ceiling on the bytes read per document. Defaults to the interpretation limit. */
  maxFileBytes?: number;
}

export interface CorpusAnalysisInput {
  /** Semantic candidate discovery, when a caller has run it. */
  semantic?: CorpusSemanticProjection;
  acquisition: CorpusAcquisition;
  packet: RepositoryModelPacket;
  interpretation?: InterpretationResult;
  /**
   * Claims read out of decoded documents, keyed by nothing: each names its own
   * subject. Absent when no document format in the corpus had any.
   */
  blockSignals?: readonly CorpusBlockWorkSignal[];
  nearDuplicates?: NearDuplicateOptions;
}

// ───────────────────────────── index shape ─────────────────────────────

export interface CorpusWorkSignal {
  assertion_id: string;
  artifact_id: string;
  predicate: string;
  object: string;
  source_path: string;
  /**
   * The line span, for a signal read out of a file that has lines.
   *
   * Absent for a signal read out of a decoded document, where `block_evidence`
   * below carries the coordinate instead. Optional rather than filled with a
   * placeholder span: `{start_line: 0, end_line: 0}` would be a location, and a
   * reader who followed it would find nothing there.
   */
  source_range?: { start_line: number; end_line: number };
  /** The block coordinate, for a signal read out of a decoded document. */
  block_evidence?: {
    normalized_document_id: string | null;
    decoder_id: string;
    block_id: string;
    block_kind: string;
    locator: Record<string, unknown>;
  };
  extractor_id: string;
  evidence_class: string;
  confidence: string;
}

/**
 * A claim read out of a decoded document's blocks, as this projection needs it.
 *
 * Structurally the block-bound half of the work-signal vocabulary. Kept as its
 * own input rather than widened into `InterpretedAssertion`, because that type's
 * evidence is a line span and it is what the Repository Model Packet carries: a
 * `pptx_shape` locator has no meaning to a consumer promised line numbers.
 */
export interface CorpusBlockWorkSignal {
  assertion_id: string;
  subject_id: string;
  predicate: string;
  object: string;
  source_path: string;
  extractor_id: string;
  evidence_class: string;
  confidence: string;
  evidence: {
    normalized_document_id: string | null;
    decoder_id: string;
    block_id: string;
    block_kind: string;
    locator: Record<string, unknown>;
  };
}

export interface CorpusWorkSignalSummary {
  statuses: string[];
  kinds: string[];
  titles: string[];
  heading_count: number;
  open_task_count: number;
  completed_task_count: number;
  milestone_count: number;
  depends_on: string[];
  blocked_by: string[];
  references: string[];
  supersedes: string[];
  superseded_by: string[];
  signal_count: number;
}

export interface CorpusArtifact {
  artifact_id: string;
  source_path: string;
  artifact_type: string;
  content_hash: string;
  size_bytes: number | null;
  is_archive_member: boolean;
  assertion_ids: string[];
  work_signal_summary: CorpusWorkSignalSummary;
  exact_duplicate_cluster_id: string | null;
  near_duplicate_candidate_ids: string[];
  /** Empty when the semantic pass did not run; `index.semantic` says which. */
  topic_candidate_ids: string[];
  project_candidate_ids: string[];
  consolidation_candidate_ids: string[];
  reasoning_candidate_ids: string[];
}

export interface CorpusDuplicateCluster {
  cluster_id: string;
  content_hash: string;
  /**
   * A deterministic member chosen so a graph has a star centre to draw to.
   *
   * It is not a recommendation. Nothing here says the representative is the copy
   * to keep, the original, or the correct one — equivalence inside a cluster is
   * exact and symmetric, so every member is as authoritative as every other.
   */
  representative_artifact_id: string;
  representative_source_path: string;
  artifact_ids: string[];
  source_paths: string[];
  count: number;
  recoverable_bytes: number;
}

export interface CorpusRelation {
  relation_id: string;
  type: "DUPLICATE_OF";
  source_artifact_id: string;
  target_artifact_id: string;
  duplicate_cluster_id: string;
  content_hash: string;
  /** Exact byte equivalence holds in both directions and across the whole cluster. */
  symmetric: true;
}

export interface CorpusArchive {
  source_path: string;
  content_hash: string;
  size_bytes: number;
  nested_depth: number;
  expanded: boolean;
  member_count: number;
  omitted_member_count: number;
  hold_codes: string[];
}

export interface CorpusSummary {
  artifact_count: number;
  archive_count: number;
  archive_member_count: number;
  interpreted_artifact_count: number;
  assertion_count: number;
  artifacts_with_work_signals: number;
  exact_duplicate_cluster_count: number;
  exact_duplicate_artifact_count: number;
  recoverable_duplicate_bytes: number;
  near_duplicate_candidate_count: number;
  open_task_count: number;
  completed_task_count: number;
  milestone_count: number;
  wip_count: number;
  draft_count: number;
  blocked_count: number;
  roadmap_count: number;
  plan_count: number;
}

export interface CorpusDiagnostics {
  packet: { code: string; severity: string; count: number }[];
  interpretation: { code: string; severity: string; count: number }[];
  /** Why an artifact was not eligible for the similarity pass. */
  near_duplicate_excluded: { reason: string; count: number }[];
}

/**
 * The semantic pass's projection into the corpus index.
 *
 * Declared here as plain data rather than imported from `corpus_semantic_run`,
 * so the index does not depend on the analysis that fills it — the semantic
 * modules already import this one, and a return edge would close a cycle.
 *
 * Null on the index means the pass did not run. That is deliberately different
 * from zeros: "no candidates were found" and "nobody looked" are not the same
 * statement about a corpus.
 */
export interface CorpusSemanticProjection {
  semantic_analysis_profile_id: string;
  semantic_analysis_profile_version: string;
  keyphrase_profile: string;
  semantic_fusion_profile: string;
  reasoning_routing_profile: string;
  embedding_enabled: boolean;
  embedding_provider_when_enabled: string | null;
  embedding_model_when_enabled: string | null;
  embedding_model_revision_when_available: string | null;
  semantic_pair_count: number;
  topic_candidate_count: number;
  project_candidate_count: number;
  consolidation_candidate_count: number;
  reasoning_eligible_count: number;
  embedding_eligible_artifact_count: number;
  embedded_artifact_count: number;
  /** Candidate ids per artifact id, for the per-artifact rows below. */
  candidate_ids_by_artifact: Record<string, {
    topic_candidate_ids: string[];
    project_candidate_ids: string[];
    consolidation_candidate_ids: string[];
    reasoning_candidate_ids: string[];
  }>;
  /** Restated so a reader of the index alone sees the boundary. */
  candidate_statement: string;
}

export interface CorpusIndex {
  schema: string;
  source: { source_name: string; source_revision: string; physical_snapshot_hash: string };
  repository_model: {
    packet_id: string;
    semantic_hash: string;
    packet_version: string;
    interpretation_profile: {
      profile_id: string;
      profile_version: string;
      profile_hash: string;
    } | null;
  };
  analysis_profile: {
    corpus_profile_id: string;
    corpus_profile_version: string;
    corpus_profile_hash: string;
    exact_duplicate_method: string;
    exact_duplicate_version: string;
    near_duplicate_method: string;
    near_duplicate_version: string;
    near_duplicate_threshold: number;
    near_duplicate_enabled: boolean;
  };
  summary: CorpusSummary;
  artifacts: CorpusArtifact[];
  work_signals: CorpusWorkSignal[];
  exact_duplicate_clusters: CorpusDuplicateCluster[];
  relations: CorpusRelation[];
  near_duplicate_candidates: NearDuplicateCandidate[];
  archives: CorpusArchive[];
  diagnostics: CorpusDiagnostics;
  /** Semantic candidate discovery, or null when the pass did not run. */
  semantic: CorpusSemanticProjection | null;
}

// ───────────────────────────── work signal projection ─────────────────────────────

const STATUS_PREDICATE = "work.status";
const KIND_PREDICATE = "work.kind";
const TITLE_PREDICATE = "document.title";
const HEADING_PREDICATE = "document.heading";
const OPEN_TASK_PREDICATE = "work.task.open";
const COMPLETED_TASK_PREDICATE = "work.task.completed";
const MILESTONE_PREDICATE = "work.milestone";
const RELATION_PREDICATES: Readonly<Record<string, keyof CorpusWorkSignalSummary>> = {
  "work.depends_on": "depends_on",
  "work.blocked_by": "blocked_by",
  "work.references": "references",
  "work.supersedes": "supersedes",
  "work.superseded_by": "superseded_by",
};

/** Predicates the corpus index treats as work intelligence. */
export const CORPUS_WORK_PREDICATES: readonly string[] = [
  HEADING_PREDICATE,
  TITLE_PREDICATE,
  "work.blocked_by",
  "work.depends_on",
  KIND_PREDICATE,
  MILESTONE_PREDICATE,
  "work.references",
  STATUS_PREDICATE,
  "work.superseded_by",
  "work.supersedes",
  COMPLETED_TASK_PREDICATE,
  OPEN_TASK_PREDICATE,
];

function emptySummary(): CorpusWorkSignalSummary {
  return {
    statuses: [], kinds: [], titles: [], heading_count: 0,
    open_task_count: 0, completed_task_count: 0, milestone_count: 0,
    depends_on: [], blocked_by: [], references: [], supersedes: [], superseded_by: [],
    signal_count: 0,
  };
}

function addSignal(
  summary: CorpusWorkSignalSummary,
  assertion: { predicate: string; object: string },
): void {
  summary.signal_count++;
  switch (assertion.predicate) {
    case STATUS_PREDICATE: summary.statuses.push(assertion.object); return;
    case KIND_PREDICATE: summary.kinds.push(assertion.object); return;
    case TITLE_PREDICATE: summary.titles.push(assertion.object); return;
    case HEADING_PREDICATE: summary.heading_count++; return;
    case OPEN_TASK_PREDICATE: summary.open_task_count++; return;
    case COMPLETED_TASK_PREDICATE: summary.completed_task_count++; return;
    case MILESTONE_PREDICATE: summary.milestone_count++; return;
    default: break;
  }
  const bucket = RELATION_PREDICATES[assertion.predicate];
  if (bucket !== undefined) (summary[bucket] as string[]).push(assertion.object);
}

/** Deduplicate and order the multi-valued summary lists. */
function settleSummary(summary: CorpusWorkSignalSummary): CorpusWorkSignalSummary {
  const settle = (values: string[]): string[] => [...new Set(values)].sort(compareCodePoints);
  return {
    ...summary,
    statuses: settle(summary.statuses),
    kinds: settle(summary.kinds),
    titles: settle(summary.titles),
    depends_on: settle(summary.depends_on),
    blocked_by: settle(summary.blocked_by),
    references: settle(summary.references),
    supersedes: settle(summary.supersedes),
    superseded_by: settle(summary.superseded_by),
  };
}

// ───────────────────────────── exact duplicates ─────────────────────────────

function clusterId(contentHash: string): string {
  return `duplicate-cluster:sha256:${contentHash.replace(/^sha256:/, "")}`;
}

/**
 * The member a rendering draws toward: shortest source path, then code point.
 *
 * Shared by both clusterers so "representative" has one definition. It is a
 * drawing convenience and nothing else — every member of an exact cluster is
 * byte-equal to every other, so no member is the original, the canonical copy or
 * the one to keep.
 */
export function duplicateRepresentative<T extends { sourcePath: string }>(members: readonly T[]): T {
  return [...members].sort(
    (left, right) =>
      left.sourcePath.length - right.sourcePath.length
      || compareCodePoints(left.sourcePath, right.sourcePath),
  )[0];
}

/** Total order over clusters: most recoverable bytes, then size, then id. */
export function compareDuplicateClusters(
  left: CorpusDuplicateCluster,
  right: CorpusDuplicateCluster,
): number {
  return (
    right.recoverable_bytes - left.recoverable_bytes
    || right.count - left.count
    || compareCodePoints(left.cluster_id, right.cluster_id)
  );
}

/** One artifact's contribution to exact-duplicate clustering. */
export interface ExactDuplicateInput {
  artifactId: string;
  sourcePath: string;
  contentHash: string;
  sizeBytes: number | null;
}

/**
 * Cluster artifacts by byte equality, over any artifact set.
 *
 * The corpus-scope counterpart of `buildCorpusDuplicateClusters`: same rule —
 * equal known content hashes, two or more members — reached from a flat artifact
 * list rather than from one repository's inventory, so a cluster can span roots,
 * disks and archives.
 */
export function clusterExactDuplicates(
  artifacts: readonly ExactDuplicateInput[],
): CorpusDuplicateCluster[] {
  const byHash = new Map<string, ExactDuplicateInput[]>();
  for (const artifact of artifacts) {
    if (artifact.contentHash.length === 0) continue;
    const bucket = byHash.get(artifact.contentHash);
    if (bucket === undefined) byHash.set(artifact.contentHash, [artifact]);
    else bucket.push(artifact);
  }
  const clusters: CorpusDuplicateCluster[] = [];
  for (const [hash, group] of byHash) {
    if (group.length < 2) continue;
    const members = [...group].sort((left, right) => compareCodePoints(left.sourcePath, right.sourcePath));
    const representative = duplicateRepresentative(members);
    const size = members[0].sizeBytes ?? 0;
    clusters.push({
      cluster_id: clusterId(hash),
      content_hash: `sha256:${hash.replace(/^sha256:/, "")}`,
      representative_artifact_id: representative.artifactId,
      representative_source_path: representative.sourcePath,
      artifact_ids: members.map((member) => member.artifactId).sort(compareCodePoints),
      source_paths: members.map((member) => member.sourcePath),
      count: members.length,
      recoverable_bytes: (members.length - 1) * size,
    });
  }
  return clusters.sort(compareDuplicateClusters);
}

/**
 * Project the canonical duplicate clusters onto artifact identity.
 *
 * Membership is decided by the acquisition clustering, which is byte equality.
 * All this adds is the artifact each path resolves to and the deterministic
 * representative a star rendering needs.
 */
export function buildCorpusDuplicateClusters(
  inventory: InventoryResult,
  repositoryId: string,
  emittedArtifactIds: ReadonlySet<string>,
): CorpusDuplicateCluster[] {
  const clusters: CorpusDuplicateCluster[] = [];
  for (const cluster of inventory.duplicates) {
    const paths = [...cluster.paths].sort(compareCodePoints);
    const resolved = paths
      .map((sourcePath) => ({ sourcePath, artifactId: repositoryModelArtifactId(repositoryId, sourcePath) }))
      .filter((entry) => emittedArtifactIds.has(entry.artifactId));
    if (resolved.length < 2) continue;
    const representative = duplicateRepresentative(resolved);
    clusters.push({
      cluster_id: clusterId(cluster.content_hash),
      content_hash: `sha256:${cluster.content_hash.replace(/^sha256:/, "")}`,
      representative_artifact_id: representative.artifactId,
      representative_source_path: representative.sourcePath,
      artifact_ids: resolved.map((entry) => entry.artifactId).sort(compareCodePoints),
      source_paths: resolved.map((entry) => entry.sourcePath),
      count: resolved.length,
      recoverable_bytes: cluster.wasted_bytes,
    });
  }
  return clusters.sort(compareDuplicateClusters);
}

/**
 * One relation per non-representative member.
 *
 * A cluster of n members has n(n-1)/2 equivalent pairs; rendering them all would
 * drown a graph in edges that say the same thing. Each member points at the
 * representative instead, and every relation carries the cluster id so a consumer
 * can see that the equivalence is cluster-wide and symmetric rather than a
 * hub-and-spoke claim.
 */
export function buildDuplicateRelations(clusters: readonly CorpusDuplicateCluster[]): CorpusRelation[] {
  const relations: CorpusRelation[] = [];
  for (const cluster of clusters) {
    for (const artifactId of cluster.artifact_ids) {
      if (artifactId === cluster.representative_artifact_id) continue;
      relations.push({
        relation_id: stableId("relation", {
          type: "DUPLICATE_OF",
          source_artifact_id: artifactId,
          target_artifact_id: cluster.representative_artifact_id,
          duplicate_cluster_id: cluster.cluster_id,
        }),
        type: "DUPLICATE_OF",
        source_artifact_id: artifactId,
        target_artifact_id: cluster.representative_artifact_id,
        duplicate_cluster_id: cluster.cluster_id,
        content_hash: cluster.content_hash,
        symmetric: true,
      });
    }
  }
  return relations.sort(
    (left, right) =>
      compareCodePoints(left.duplicate_cluster_id, right.duplicate_cluster_id)
      || compareCodePoints(left.source_artifact_id, right.source_artifact_id),
  );
}

// ───────────────────────────── near-duplicate corpus pass ─────────────────────────────

interface NearDuplicateOutcome {
  candidates: NearDuplicateCandidate[];
  analyzed: number;
  excluded: Map<string, number>;
}

function extensionOf(sourcePath: string): string {
  const slash = sourcePath.lastIndexOf("/");
  const name = slash >= 0 ? sourcePath.slice(slash + 1) : sourcePath;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function exclude(excluded: Map<string, number>, reason: string): void {
  excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
}

/**
 * Read the eligible documents and score them against each other.
 *
 * Eligibility is decided from facts acquisition already established — the file's
 * type, its size, its hash, whether its path is a credential candidate — plus the
 * encoding probe, which is the same refusal interpretation applies. A document
 * that cannot be read as UTF-8 text is excluded and counted, never guessed at.
 */
function analyzeNearDuplicates(
  records: readonly InventoryRecord[],
  artifactIdFor: (sourcePath: string) => string,
  emittedArtifactIds: ReadonlySet<string>,
  options: Required<Pick<NearDuplicateOptions, "threshold" | "maxFileBytes">>,
): NearDuplicateOutcome {
  const excluded = new Map<string, number>();
  const documents: NearDuplicateDocument[] = [];

  for (const record of records) {
    if (record.artifact_type === "folder") continue;
    const artifactId = artifactIdFor(record.relative_path);
    if (!emittedArtifactIds.has(artifactId)) continue;
    if (!NEAR_DUPLICATE_EXTENSIONS.includes(extensionOf(record.relative_path))) {
      exclude(excluded, "unsupported_extension");
      continue;
    }
    if (isSecretCandidatePath(record.relative_path)) {
      exclude(excluded, "secret_candidate_path");
      continue;
    }
    if (record.content_hash === null) {
      exclude(excluded, "content_hash_unavailable");
      continue;
    }
    if (record.size_bytes !== null && record.size_bytes > options.maxFileBytes) {
      exclude(excluded, "above_analysis_size_limit");
      continue;
    }
    const absolute = record.absolute_path;
    if (absolute === null) {
      exclude(excluded, "content_unavailable");
      continue;
    }
    if (probeFileEncoding(absolute).status !== "utf8") {
      exclude(excluded, "unsupported_encoding");
      continue;
    }
    let text: string;
    try {
      text = fs.readFileSync(absolute, "utf8");
    } catch {
      exclude(excluded, "content_unavailable");
      continue;
    }
    const document = prepareNearDuplicateDocument({
      artifactId,
      sourcePath: record.relative_path,
      contentHash: `sha256:${record.content_hash.replace(/^sha256:/, "")}`,
      text,
    });
    if (document.tokenCount < NEAR_DUPLICATE_MIN_TOKENS) {
      exclude(excluded, "below_minimum_token_count");
      continue;
    }
    documents.push(document);
  }

  documents.sort((left, right) => compareCodePoints(left.artifactId, right.artifactId));
  return {
    candidates: nearDuplicateCandidates(documents, options.threshold),
    analyzed: documents.length,
    excluded,
  };
}

// ───────────────────────────── index assembly ─────────────────────────────

function countByCode(
  entries: readonly { code: string; severity: string }[],
): { code: string; severity: string; count: number }[] {
  const counts = new Map<string, { code: string; severity: string; count: number }>();
  for (const entry of entries) {
    const key = `${entry.code} ${entry.severity}`;
    const existing = counts.get(key);
    if (existing === undefined) counts.set(key, { code: entry.code, severity: entry.severity, count: 1 });
    else existing.count++;
  }
  return [...counts.values()].sort(
    (left, right) => compareCodePoints(left.code, right.code) || compareCodePoints(left.severity, right.severity),
  );
}

/**
 * The interpretation profile that produced the assertions being projected.
 *
 * The inline result carries it when interpretation ran in this process; a packet
 * built elsewhere carries it on the packet. Reading only the former would bind an
 * empty extractor set into the hash that is supposed to identify exactly which
 * extractors ran.
 */
function resolveInterpretationProfile(
  interpretation: InterpretationResult | undefined,
  packet: RepositoryModelPacket,
): { profile_version: string; extractor_versions: Record<string, string> } | null {
  if (interpretation) {
    return {
      profile_version: interpretation.profile.profile_version,
      extractor_versions: interpretation.profile.extractor_versions,
    };
  }
  if (packet.interpretation_profile) {
    return {
      profile_version: packet.interpretation_profile.profile_version,
      extractor_versions: packet.interpretation_profile.extractor_versions,
    };
  }
  return null;
}

function corpusProfileHash(
  interpretationProfile: { profile_version: string; extractor_versions: Record<string, string> } | null,
  threshold: number,
  nearDuplicatesEnabled: boolean,
): string {
  return stableId("corpus-profile", {
    id: CORPUS_PROFILE_ID,
    version: CORPUS_PROFILE_VERSION,
    work_extractor_versions: interpretationProfile?.extractor_versions ?? {},
    interpretation_profile_version: interpretationProfile?.profile_version ?? null,
    exact_duplicate_method: EXACT_DUPLICATE_METHOD,
    exact_duplicate_version: EXACT_DUPLICATE_METHOD_VERSION,
    near_duplicate_method: NEAR_DUPLICATE_METHOD,
    near_duplicate_version: NEAR_DUPLICATE_METHOD_VERSION,
    near_duplicate_threshold: scoreKey(threshold),
    near_duplicate_enabled: nearDuplicatesEnabled,
    shingle_size: NEAR_DUPLICATE_SHINGLE_SIZE,
    minimum_tokens: NEAR_DUPLICATE_MIN_TOKENS,
    ordering: "code-point",
  });
}

/**
 * Build the corpus index from an acquisition, its packet, and its interpretation.
 *
 * The index resolves every artifact it names against the packet, so a reference
 * that does not resolve cannot be emitted. Where the packet has no artifact for
 * something acquisition saw, the index simply has nothing to say about it.
 */
export function buildCorpusIndex(input: CorpusAnalysisInput): CorpusIndex {
  const { acquisition, packet } = input;
  const repositoryId = packet.subject.repository_id;
  const artifactIdFor = (sourcePath: string): string => repositoryModelArtifactId(repositoryId, sourcePath);

  const artifactRecords: RepositoryModelArtifactRecord[] = [...packet.payload.artifacts];
  const emittedArtifactIds = new Set(artifactRecords.map((artifact) => artifact.artifact_id));
  const sizeByPath = new Map(
    acquisition.inventory.records.map((record) => [record.relative_path, record.size_bytes]),
  );
  const memberPaths = new Set(acquisition.virtualArtifacts.map((member) => member.virtualSourcePath));

  const nearDuplicateOptions = input.nearDuplicates ?? {};
  const nearDuplicatesEnabled = nearDuplicateOptions.enabled !== false;
  const rawThreshold = nearDuplicateOptions.threshold ?? DEFAULT_NEAR_DUPLICATE_THRESHOLD;
  if (!Number.isFinite(rawThreshold) || rawThreshold < 0 || rawThreshold > 1) {
    throw new Error(`corpus-analysis: the near-duplicate threshold must be within [0, 1], got ${rawThreshold}`);
  }
  const threshold = roundScore(rawThreshold);

  // Work signals are assertions from the work-intelligence profile. They are
  // artifact-scoped, so each already points at the file that made it.
  const workPredicates = new Set(CORPUS_WORK_PREDICATES);
  const assertions: InterpretedAssertion[] = [
    ...(input.interpretation?.assertions ?? (packet.payload.assertions as InterpretedAssertion[])),
  ];
  const assertionIdsByArtifact = new Map<string, string[]>();
  const summaries = new Map<string, CorpusWorkSignalSummary>();
  const workSignals: CorpusWorkSignal[] = [];
  for (const assertion of assertions) {
    if (!emittedArtifactIds.has(assertion.subject_id)) continue;
    const ids = assertionIdsByArtifact.get(assertion.subject_id) ?? [];
    ids.push(assertion.assertion_id);
    assertionIdsByArtifact.set(assertion.subject_id, ids);
    if (!workPredicates.has(assertion.predicate)) continue;
    const summary = summaries.get(assertion.subject_id) ?? emptySummary();
    addSignal(summary, assertion);
    summaries.set(assertion.subject_id, summary);
    workSignals.push({
      assertion_id: assertion.assertion_id,
      artifact_id: assertion.subject_id,
      predicate: assertion.predicate,
      object: assertion.object,
      source_path: assertion.source_path,
      source_range: { ...assertion.source_range },
      extractor_id: assertion.extractor_id,
      evidence_class: assertion.evidence_class,
      confidence: assertion.confidence,
    });
  }

  // The same vocabulary, read out of decoded documents. Projected here rather
  // than left in `document-signals.json` alone, because `corpus-index.json` and
  // the report an operator actually reads are built from this list: a corpus
  // whose index shows three blocked plans and omits the twenty Word documents
  // beside them has answered the question wrong, not partially.
  for (const signal of input.blockSignals ?? []) {
    if (!emittedArtifactIds.has(signal.subject_id)) continue;
    const ids = assertionIdsByArtifact.get(signal.subject_id) ?? [];
    ids.push(signal.assertion_id);
    assertionIdsByArtifact.set(signal.subject_id, ids);
    if (!workPredicates.has(signal.predicate)) continue;
    const summary = summaries.get(signal.subject_id) ?? emptySummary();
    addSignal(summary, signal);
    summaries.set(signal.subject_id, summary);
    workSignals.push({
      assertion_id: signal.assertion_id,
      artifact_id: signal.subject_id,
      predicate: signal.predicate,
      object: signal.object,
      source_path: signal.source_path,
      block_evidence: { ...signal.evidence, locator: { ...signal.evidence.locator } },
      extractor_id: signal.extractor_id,
      evidence_class: signal.evidence_class,
      confidence: signal.confidence,
    });
  }

  const clusters = buildCorpusDuplicateClusters(acquisition.inventory, repositoryId, emittedArtifactIds);
  const relations = buildDuplicateRelations(clusters);
  const clusterByArtifact = new Map<string, string>();
  for (const cluster of clusters) {
    for (const artifactId of cluster.artifact_ids) clusterByArtifact.set(artifactId, cluster.cluster_id);
  }

  const near: NearDuplicateOutcome = nearDuplicatesEnabled
    ? analyzeNearDuplicates(acquisition.inventory.records, artifactIdFor, emittedArtifactIds, {
        threshold,
        maxFileBytes: nearDuplicateOptions.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      })
    : { candidates: [], analyzed: 0, excluded: new Map([["analysis_disabled", 1]]) };
  const candidateIdsByArtifact = new Map<string, string[]>();
  for (const candidate of near.candidates) {
    for (const artifactId of [candidate.artifact_a_id, candidate.artifact_b_id]) {
      const ids = candidateIdsByArtifact.get(artifactId) ?? [];
      ids.push(candidate.candidate_id);
      candidateIdsByArtifact.set(artifactId, ids);
    }
  }

  // Candidate ids per artifact, or four empty lists when the pass did not run.
  // `index.semantic` is what tells those two cases apart; empty lists here never
  // claim on their own that a corpus has no candidates.
  const semanticIdsFor = (artifactId: string): {
    topic_candidate_ids: string[];
    project_candidate_ids: string[];
    consolidation_candidate_ids: string[];
    reasoning_candidate_ids: string[];
  } => {
    const entry = input.semantic?.candidate_ids_by_artifact[artifactId];
    return {
      topic_candidate_ids: [...(entry?.topic_candidate_ids ?? [])].sort(compareCodePoints),
      project_candidate_ids: [...(entry?.project_candidate_ids ?? [])].sort(compareCodePoints),
      consolidation_candidate_ids: [...(entry?.consolidation_candidate_ids ?? [])].sort(compareCodePoints),
      reasoning_candidate_ids: [...(entry?.reasoning_candidate_ids ?? [])].sort(compareCodePoints),
    };
  };

  const artifacts: CorpusArtifact[] = artifactRecords
    .map((artifact) => ({
      artifact_id: artifact.artifact_id,
      source_path: artifact.source_path,
      artifact_type: artifact.artifact_type,
      content_hash: artifact.content_hash,
      size_bytes: sizeByPath.get(artifact.source_path) ?? null,
      is_archive_member: memberPaths.has(artifact.source_path),
      assertion_ids: (assertionIdsByArtifact.get(artifact.artifact_id) ?? []).sort(compareCodePoints),
      work_signal_summary: settleSummary(summaries.get(artifact.artifact_id) ?? emptySummary()),
      exact_duplicate_cluster_id: clusterByArtifact.get(artifact.artifact_id) ?? null,
      near_duplicate_candidate_ids: (candidateIdsByArtifact.get(artifact.artifact_id) ?? []).sort(compareCodePoints),
      ...semanticIdsFor(artifact.artifact_id),
    }))
    .sort((left, right) => compareCodePoints(left.source_path, right.source_path));

  const withWorkSignals = artifacts.filter((artifact) => artifact.work_signal_summary.signal_count > 0);
  const statusCount = (status: string): number =>
    artifacts.filter((artifact) => artifact.work_signal_summary.statuses.includes(status)).length;
  const kindCount = (kind: string): number =>
    artifacts.filter((artifact) => artifact.work_signal_summary.kinds.includes(kind)).length;
  const signalCount = (predicate: string): number =>
    workSignals.filter((signal) => signal.predicate === predicate).length;

  const summary: CorpusSummary = {
    artifact_count: artifacts.length,
    archive_count: acquisition.archives.length,
    archive_member_count: acquisition.virtualArtifacts.length,
    interpreted_artifact_count: new Set(assertions.map((assertion) => assertion.source_path)).size,
    assertion_count: assertions.length,
    artifacts_with_work_signals: withWorkSignals.length,
    exact_duplicate_cluster_count: clusters.length,
    exact_duplicate_artifact_count: clusters.reduce((total, cluster) => total + cluster.count, 0),
    recoverable_duplicate_bytes: clusters.reduce((total, cluster) => total + cluster.recoverable_bytes, 0),
    near_duplicate_candidate_count: near.candidates.length,
    open_task_count: signalCount(OPEN_TASK_PREDICATE),
    completed_task_count: signalCount(COMPLETED_TASK_PREDICATE),
    milestone_count: signalCount(MILESTONE_PREDICATE),
    wip_count: statusCount("wip"),
    draft_count: statusCount("draft"),
    blocked_count: statusCount("blocked"),
    roadmap_count: kindCount("roadmap"),
    plan_count: kindCount("plan"),
  };

  const archives: CorpusArchive[] = [...acquisition.archives]
    .map((archive) => ({
      source_path: archive.sourcePath,
      content_hash: archive.contentHash,
      size_bytes: archive.sizeBytes,
      nested_depth: archive.nestedDepth,
      expanded: archive.expanded,
      member_count: archive.memberCount,
      omitted_member_count: archive.omittedMemberCount,
      hold_codes: archive.holds.map((hold) => hold.code).sort(compareCodePoints),
    }))
    .sort((left, right) => compareCodePoints(left.source_path, right.source_path));

  const interpretationProfile = resolveInterpretationProfile(input.interpretation, packet);

  const orderedWorkSignals = [...workSignals].sort(
    (left, right) =>
      compareCodePoints(left.source_path, right.source_path)
      // A signal with a line span orders by it; one with a block coordinate
      // orders by block id. The two never compete for a position, because a
      // single artifact is read by one reader or the other and never by both.
      || (left.source_range?.start_line ?? 0) - (right.source_range?.start_line ?? 0)
      || compareCodePoints(
        left.block_evidence?.block_id ?? "",
        right.block_evidence?.block_id ?? "",
      )
      || compareCodePoints(left.predicate, right.predicate)
      || compareCodePoints(left.object, right.object)
      || compareCodePoints(left.assertion_id, right.assertion_id),
  );

  const packetDiagnostics: readonly RepositoryModelDiagnostic[] = packet.payload.diagnostics;
  return {
    schema: CORPUS_INDEX_SCHEMA,
    source: {
      source_name: acquisition.sourceName,
      source_revision: acquisition.sourceRevision,
      physical_snapshot_hash: acquisition.physicalSnapshotHash,
    },
    repository_model: {
      packet_id: packet.packet_id,
      semantic_hash: packet.semantic_hash,
      packet_version: packet.packet_version,
      interpretation_profile: packet.interpretation_profile
        ? {
            profile_id: packet.interpretation_profile.profile_id,
            profile_version: packet.interpretation_profile.profile_version,
            profile_hash: packet.interpretation_profile.profile_hash,
          }
        : null,
    },
    analysis_profile: {
      corpus_profile_id: CORPUS_PROFILE_ID,
      corpus_profile_version: CORPUS_PROFILE_VERSION,
      corpus_profile_hash: corpusProfileHash(interpretationProfile, threshold, nearDuplicatesEnabled),
      exact_duplicate_method: EXACT_DUPLICATE_METHOD,
      exact_duplicate_version: EXACT_DUPLICATE_METHOD_VERSION,
      near_duplicate_method: NEAR_DUPLICATE_METHOD,
      near_duplicate_version: NEAR_DUPLICATE_METHOD_VERSION,
      near_duplicate_threshold: threshold,
      near_duplicate_enabled: nearDuplicatesEnabled,
    },
    summary,
    artifacts,
    work_signals: orderedWorkSignals,
    exact_duplicate_clusters: clusters,
    relations,
    near_duplicate_candidates: near.candidates,
    archives,
    diagnostics: {
      packet: countByCode(packetDiagnostics),
      interpretation: countByCode(input.interpretation?.diagnostics ?? []),
      near_duplicate_excluded: [...near.excluded.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((left, right) => compareCodePoints(left.reason, right.reason)),
    },
    semantic: input.semantic ?? null,
  };
}

/**
 * Attach a semantic projection to an already-built index.
 *
 * A pure transformation, and the reason this module does not import the semantic
 * analysis: the semantic modules already import this one, so a call in the other
 * direction would close a cycle. The caller runs the pass and hands the result
 * back here.
 */
export function withSemanticProjection(
  index: CorpusIndex,
  semantic: CorpusSemanticProjection,
): CorpusIndex {
  const empty = {
    topic_candidate_ids: [] as string[],
    project_candidate_ids: [] as string[],
    consolidation_candidate_ids: [] as string[],
    reasoning_candidate_ids: [] as string[],
  };
  return {
    ...index,
    artifacts: index.artifacts.map((artifact) => {
      const entry = semantic.candidate_ids_by_artifact[artifact.artifact_id] ?? empty;
      return {
        ...artifact,
        topic_candidate_ids: [...entry.topic_candidate_ids].sort(compareCodePoints),
        project_candidate_ids: [...entry.project_candidate_ids].sort(compareCodePoints),
        consolidation_candidate_ids: [...entry.consolidation_candidate_ids].sort(compareCodePoints),
        reasoning_candidate_ids: [...entry.reasoning_candidate_ids].sort(compareCodePoints),
      };
    }),
    semantic,
  };
}

/** Serialize an index to the bytes written as `corpus-index.json`. */
export function renderCorpusIndex(index: CorpusIndex): string {
  return `${canonicalCorpusJson(index)}\n`;
}
