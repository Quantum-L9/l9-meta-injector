// corpus_analysis.ts — derived analysis over an already-observed corpus.
//
// This module reads nothing from disk except the member bytes already staged by
// acquisition. It projects what acquisition and interpretation established into
// two derived views:
//
//   exact duplicates    — a fact. Two artifacts are duplicates when their content
//                         hashes are equal. Nothing else qualifies, and nothing
//                         about names, dates, or locations is consulted.
//
//   near duplicates     — a candidate. A deterministic lexical similarity score
//                         over normalized token shingles, above a stated
//                         threshold. It is evidence that two documents share
//                         wording. It is NOT a claim that they share a topic, a
//                         project, or a purpose, and it never recommends that
//                         anything be merged or deleted.
//
// The distinction is the point of the module. An exact duplicate can be acted on
// mechanically; a near-duplicate candidate is a question for a reader. Collapsing
// the two — reporting a 0.9 Jaccard score as "duplicate" — would turn a lexical
// observation into a deletion recommendation nobody made.
//
// The corpus index assembled here is a projection: every value in it is traceable
// to the acquisition observation, the Repository Model Packet, or one of the two
// analyses above. It introduces no facts of its own.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { InventoryRecord } from "./inventory";
import { LocalSourceObservation } from "./local_source";
import { InterpretedAssertion } from "./interpretation";
import {
  RepositoryModelPacket,
  artifactIdFor,
  repositoryIdFor,
  semanticHash,
  stableId,
} from "./repository_model";
import { canonicalPair, compareCodePoints } from "./ordering";
import { probeBufferEncoding } from "./encoding";
import { isSecretCandidatePath } from "./interpretation";

export const CORPUS_INDEX_SCHEMA = "l9.corpus-index/v1";

/** Identity of the corpus analysis policy as a whole. */
export const CORPUS_PROFILE_ID = "l9-meta-injector-corpus-intelligence";
export const CORPUS_PROFILE_VERSION = "1.0.0";

/** Identity of the near-duplicate algorithm specifically. */
export const NEAR_DUPLICATE_METHOD = "text-near-duplicate/v1";
export const NEAR_DUPLICATE_VERSION = "1.0.0";
export const DEFAULT_NEAR_DUPLICATE_THRESHOLD = 0.85;

/** Shingle width, in tokens. Part of the algorithm's identity. */
export const NEAR_DUPLICATE_SHINGLE_SIZE = 5;
/** Below this many tokens a document is too short for the score to mean anything. */
export const NEAR_DUPLICATE_MIN_TOKENS = 20;
/** Bytes above which a document is not analysed for similarity. */
export const NEAR_DUPLICATE_MAX_BYTES = 1024 * 1024;

/** Extensions whose text this analysis reads. */
const ANALYSABLE_EXTENSIONS = [".md", ".markdown", ".txt", ".rst"];

// ───────────────────────────── exact duplicates ─────────────────────────────

export interface CorpusDuplicateCluster {
  /** `duplicate-cluster:sha256:<content-hash>` — identity is the content, not a path. */
  cluster_id: string;
  content_hash: string;
  /**
   * A deterministic star target for rendering, chosen by shortest path then code
   * point. It is NOT a recommendation about which copy to keep: this analysis has
   * no opinion about that and the data to form one is not in scope.
   */
  representative_artifact_id: string;
  representative_source_path: string;
  artifact_ids: string[];
  source_paths: string[];
  count: number;
  /** Bytes that would be released if the cluster held one copy. Not advice to do so. */
  recoverable_bytes: number;
}

export interface CorpusDuplicateRelation {
  relation_id: string;
  type: "DUPLICATE_OF";
  source_artifact_id: string;
  target_artifact_id: string;
  duplicate_cluster_id: string;
  content_hash: string;
  /** Byte equality is symmetric; the star rendering is a layout, not a direction. */
  symmetric: true;
}

// ───────────────────────────── near duplicates ─────────────────────────────

export interface CorpusNearDuplicateCandidate {
  candidate_id: string;
  artifact_a_id: string;
  artifact_b_id: string;
  source_path_a: string;
  source_path_b: string;
  method: string;
  algorithm_version: string;
  /** Exact Jaccard over unique token shingles, rounded to 6 decimal places. */
  score: number;
  threshold: number;
  normalized_content_hash_a: string;
  normalized_content_hash_b: string;
  shared_shingle_count: number;
  union_shingle_count: number;
}

// ───────────────────────────── index shape ─────────────────────────────

export interface CorpusWorkSignal {
  assertion_id: string;
  artifact_id: string;
  predicate: string;
  object: string;
  source_path: string;
  source_range: { start_line: number; end_line: number };
  extractor_id: string;
  evidence_class: string;
  confidence: string;
}

export interface CorpusArtifactEntry {
  artifact_id: string;
  source_path: string;
  artifact_type: string;
  content_hash: string | null;
  size_bytes: number | null;
  is_archive_member: boolean;
  assertion_ids: string[];
  work_signal_summary: Record<string, number>;
  exact_duplicate_cluster_id: string | null;
  near_duplicate_candidate_ids: string[];
}

export interface CorpusIndexSummary {
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

export interface CorpusIndex {
  schema: typeof CORPUS_INDEX_SCHEMA;
  source: {
    source_name: string;
    source_revision: string;
    physical_snapshot_hash: string;
  };
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
    near_duplicate_method: string;
    near_duplicate_version: string;
    near_duplicate_threshold: number;
    near_duplicate_analysed: boolean;
  };
  summary: CorpusIndexSummary;
  artifacts: CorpusArtifactEntry[];
  work_signals: CorpusWorkSignal[];
  exact_duplicate_clusters: CorpusDuplicateCluster[];
  relations: CorpusDuplicateRelation[];
  near_duplicate_candidates: CorpusNearDuplicateCandidate[];
  diagnostics: { code: string; severity: string; message: string; source_path?: string }[];
}

// ───────────────────────────── text normalization ─────────────────────────────

/**
 * The exact normalization the similarity score is defined over.
 *
 * Every step is lossy on purpose, and every step is part of the algorithm's
 * identity: changing any of them changes what a score means, which is why the
 * method carries a version.
 */
export function normalizeForSimilarity(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n|\r/g, "\n")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Unicode word tokens of the normalized text. */
export function tokenize(normalized: string): string[] {
  return normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Unique k-token shingles. The set, not the sequence: order is not scored. */
export function shingleSet(tokens: string[], size = NEAR_DUPLICATE_SHINGLE_SIZE): Set<string> {
  const out = new Set<string>();
  if (tokens.length < size) {
    if (tokens.length > 0) out.add(tokens.join(" "));
    return out;
  }
  for (let i = 0; i + size <= tokens.length; i++) out.add(tokens.slice(i, i + size).join(" "));
  return out;
}

/**
 * Whether a scored pair qualifies as a candidate.
 *
 * A pair must share at least some wording. Without that floor a threshold of 0
 * would admit every pair in the corpus, including documents with nothing at all
 * in common — the full cross product, presented as "candidates". Requiring a
 * positive score also makes the shingle-indexed generator exactly equivalent to
 * the all-pairs definition: a pair sharing no shingle scores 0 and is out under
 * both, so pruning it is not an approximation.
 */
function qualifies(score: number, threshold: number): boolean {
  return score > 0 && score >= threshold;
}

/** Exact Jaccard over two shingle sets. Two empty sets are unknown, not identical. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Fixed precision so a score is byte-stable across runtimes. */
function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

// ───────────────────────────── analysis inputs ─────────────────────────────

export interface CorpusAnalysisInput {
  observation: LocalSourceObservation;
  packet: RepositoryModelPacket;
  /** Repository name the packet was built with; artifact IDs derive from it. */
  repositoryName: string;
  /** Similarity threshold in [0,1]. Participates in analysis identity. */
  nearDuplicateThreshold?: number;
  /** Skip similarity analysis entirely. Exact duplicates are still reported. */
  skipNearDuplicates?: boolean;
}

interface AnalysableDocument {
  artifactId: string;
  sourcePath: string;
  normalizedHash: string;
  shingles: Set<string>;
}

function isAnalysableExtension(sourcePath: string): boolean {
  const lower = sourcePath.toLowerCase();
  return ANALYSABLE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Read the text of one record for similarity analysis.
 *
 * Returns null whenever the bytes are unavailable, oversized, binary, or not
 * valid UTF-8. A document that cannot be read is absent from the analysis rather
 * than scored as empty, because an empty document would score 0 against
 * everything and look like a confident negative.
 */
function readAnalysableText(record: InventoryRecord): string | null {
  if (!record.absolute_path) return null;
  if (record.size_bytes !== null && record.size_bytes > NEAR_DUPLICATE_MAX_BYTES) return null;
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(record.absolute_path);
  } catch {
    return null;
  }
  if (bytes.byteLength > NEAR_DUPLICATE_MAX_BYTES) return null;
  const probe = probeBufferEncoding(bytes);
  if (probe.status !== "utf8") return null;
  return bytes.toString("utf8");
}

// ───────────────────────────── exact duplicate projection ─────────────────────────────

/**
 * Project acquisition's content-hash clusters onto artifact identity.
 *
 * The clustering itself already happened during acquisition, over the unified
 * record set. This adds artifact IDs, a cluster identity derived from the content
 * hash, and the star relations the index renders.
 */
export function buildDuplicateProjection(
  observation: LocalSourceObservation,
  repositoryId: string,
): { clusters: CorpusDuplicateCluster[]; relations: CorpusDuplicateRelation[] } {
  const clusters: CorpusDuplicateCluster[] = [];
  const relations: CorpusDuplicateRelation[] = [];

  for (const cluster of observation.inventory.duplicates) {
    const paths = [...cluster.paths].sort(compareCodePoints);
    // Shortest path first, then code point. Deterministic and content-independent,
    // which is what a rendering anchor needs to be.
    const representativePath = [...paths].sort(
      (a, b) => a.length - b.length || compareCodePoints(a, b),
    )[0];
    const contentHash = cluster.content_hash.startsWith("sha256:")
      ? cluster.content_hash
      : `sha256:${cluster.content_hash}`;
    const clusterId = `duplicate-cluster:${contentHash}`;
    const representativeArtifactId = artifactIdFor(repositoryId, representativePath);

    clusters.push({
      cluster_id: clusterId,
      content_hash: contentHash,
      representative_artifact_id: representativeArtifactId,
      representative_source_path: representativePath,
      artifact_ids: paths.map((sourcePath) => artifactIdFor(repositoryId, sourcePath)),
      source_paths: paths,
      count: cluster.count,
      recoverable_bytes: cluster.wasted_bytes,
    });

    // One relation per non-representative member: a star, not the full pair set.
    // An n-member cluster renders n-1 edges instead of n(n-1)/2, and the
    // cluster ID on every edge says the equivalence is cluster-wide.
    for (const sourcePath of paths) {
      if (sourcePath === representativePath) continue;
      const sourceArtifactId = artifactIdFor(repositoryId, sourcePath);
      relations.push({
        relation_id: stableId("relation", {
          type: "DUPLICATE_OF",
          source_artifact_id: sourceArtifactId,
          target_artifact_id: representativeArtifactId,
          duplicate_cluster_id: clusterId,
        }),
        type: "DUPLICATE_OF",
        source_artifact_id: sourceArtifactId,
        target_artifact_id: representativeArtifactId,
        duplicate_cluster_id: clusterId,
        content_hash: contentHash,
        symmetric: true,
      });
    }
  }

  clusters.sort((a, b) =>
    b.recoverable_bytes - a.recoverable_bytes
    || b.count - a.count
    || compareCodePoints(a.cluster_id, b.cluster_id));
  relations.sort((a, b) =>
    compareCodePoints(a.duplicate_cluster_id, b.duplicate_cluster_id)
    || compareCodePoints(a.source_artifact_id, b.source_artifact_id));
  return { clusters, relations };
}

// ───────────────────────────── near-duplicate analysis ─────────────────────────────

/**
 * Documents eligible for similarity scoring, in a fixed order.
 *
 * An exact-duplicate cluster contributes exactly one document: its
 * representative. Two things follow, and both are intended.
 *
 * Byte-identical pairs never appear as candidates, because they are already
 * reported as the stronger fact. But a file that happens to have an exact twin
 * is still compared against everything else — dropping it entirely would lose a
 * real finding, which is what a naive "skip anything in a cluster" rule does.
 *
 * And a cluster of N copies alongside a near-twin produces one candidate rather
 * than N restatements of the same observation. On the corpora this is built for
 * — synced drives full of repeated bundles — the difference is between a
 * readable list and a combinatorial one. The artifact entry carries its
 * `exact_duplicate_cluster_id`, so a reader can see which copies the
 * representative stands for.
 */
function analysableDocuments(
  observation: LocalSourceObservation,
  repositoryId: string,
  duplicateRepresentatives: ReadonlyMap<string, string>,
): AnalysableDocument[] {
  const documents: AnalysableDocument[] = [];
  const records = [...observation.inventory.records].sort((a, b) =>
    compareCodePoints(a.relative_path, b.relative_path));

  for (const record of records) {
    if (record.artifact_type === "folder") continue;
    const sourcePath = record.relative_path;
    if (!isAnalysableExtension(sourcePath)) continue;
    const representative = duplicateRepresentatives.get(sourcePath);
    if (representative !== undefined && representative !== sourcePath) continue;
    if (isSecretCandidatePath(sourcePath)) continue;

    const text = readAnalysableText(record);
    if (text === null) continue;
    const normalized = normalizeForSimilarity(text);
    const tokens = tokenize(normalized);
    if (tokens.length < NEAR_DUPLICATE_MIN_TOKENS) continue;

    documents.push({
      artifactId: artifactIdFor(repositoryId, sourcePath),
      sourcePath,
      normalizedHash: semanticHash(normalized),
      shingles: shingleSet(tokens),
    });
  }
  return documents;
}

function candidateIdFor(
  a: AnalysableDocument,
  b: AnalysableDocument,
  threshold: number,
): string {
  const [firstId, secondId] = canonicalPair(a.artifactId, b.artifactId);
  const first = a.artifactId === firstId ? a : b;
  const second = first === a ? b : a;
  return corpusStableId("near-duplicate", {
    algorithm_id: NEAR_DUPLICATE_METHOD,
    algorithm_version: NEAR_DUPLICATE_VERSION,
    threshold,
    artifact_a_id: firstId,
    artifact_b_id: secondId,
    normalized_content_hash_a: first.normalizedHash,
    normalized_content_hash_b: second.normalizedHash,
  });
}

function toCandidate(
  a: AnalysableDocument,
  b: AnalysableDocument,
  score: number,
  threshold: number,
): CorpusNearDuplicateCandidate {
  const [firstId] = canonicalPair(a.artifactId, b.artifactId);
  const first = a.artifactId === firstId ? a : b;
  const second = first === a ? b : a;
  let shared = 0;
  for (const shingle of first.shingles) if (second.shingles.has(shingle)) shared++;
  return {
    candidate_id: candidateIdFor(a, b, threshold),
    artifact_a_id: first.artifactId,
    artifact_b_id: second.artifactId,
    source_path_a: first.sourcePath,
    source_path_b: second.sourcePath,
    method: NEAR_DUPLICATE_METHOD,
    algorithm_version: NEAR_DUPLICATE_VERSION,
    score: roundScore(score),
    threshold,
    normalized_content_hash_a: first.normalizedHash,
    normalized_content_hash_b: second.normalizedHash,
    shared_shingle_count: shared,
    union_shingle_count: first.shingles.size + second.shingles.size - shared,
  };
}

/**
 * The reference scorer: every pair, scored exactly.
 *
 * Quadratic and therefore not the production path, but it is the definition of
 * the result the production path must reproduce. Tests run both over the same
 * corpora and require identical output.
 */
export function referenceNearDuplicates(
  documents: AnalysableDocument[],
  threshold: number,
): CorpusNearDuplicateCandidate[] {
  const candidates: CorpusNearDuplicateCandidate[] = [];
  for (let i = 0; i < documents.length; i++) {
    for (let j = i + 1; j < documents.length; j++) {
      const score = jaccard(documents[i].shingles, documents[j].shingles);
      if (qualifies(score, threshold)) candidates.push(toCandidate(documents[i], documents[j], score, threshold));
    }
  }
  return sortCandidates(candidates);
}

function sortCandidates(candidates: CorpusNearDuplicateCandidate[]): CorpusNearDuplicateCandidate[] {
  return candidates.sort((a, b) =>
    b.score - a.score
    || compareCodePoints(a.artifact_a_id, b.artifact_a_id)
    || compareCodePoints(a.artifact_b_id, b.artifact_b_id)
    || compareCodePoints(a.candidate_id, b.candidate_id));
}

/**
 * Candidate generation via a shingle index.
 *
 * Two documents can only reach the threshold if they share at least one shingle,
 * so only pairs that co-occur in some shingle's posting list are scored. Every
 * surviving pair is then scored exactly, by the same function the reference uses,
 * so this is a way of skipping pairs that cannot qualify — not an approximation.
 */
export function indexedNearDuplicates(
  documents: AnalysableDocument[],
  threshold: number,
): CorpusNearDuplicateCandidate[] {
  const postings = new Map<string, number[]>();
  documents.forEach((document, index) => {
    for (const shingle of document.shingles) {
      const list = postings.get(shingle);
      if (list === undefined) postings.set(shingle, [index]);
      else if (list[list.length - 1] !== index) list.push(index);
    }
  });

  const pairs = new Set<string>();
  for (const list of postings.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) pairs.add(`${list[i]}:${list[j]}`);
    }
  }

  const candidates: CorpusNearDuplicateCandidate[] = [];
  for (const pair of pairs) {
    const [left, right] = pair.split(":").map((value) => Number.parseInt(value, 10));
    const score = jaccard(documents[left].shingles, documents[right].shingles);
    if (qualifies(score, threshold)) candidates.push(toCandidate(documents[left], documents[right], score, threshold));
  }
  return sortCandidates(candidates);
}

// ───────────────────────────── index assembly ─────────────────────────────

const WORK_SIGNAL_PREFIXES = ["document.", "work."];

function isWorkSignal(assertion: InterpretedAssertion | { predicate: string }): boolean {
  return WORK_SIGNAL_PREFIXES.some((prefix) => assertion.predicate.startsWith(prefix));
}

function matching(
  signals: CorpusWorkSignal[],
  predicate: string,
  object?: string,
): CorpusWorkSignal[] {
  return signals.filter((signal) =>
    signal.predicate === predicate && (object === undefined || signal.object === object));
}

/** How many declaration events matched. Right for tasks: each one is its own item. */
function countMatching(signals: CorpusWorkSignal[], predicate: string, object?: string): number {
  return matching(signals, predicate, object).length;
}

/**
 * How many artifacts matched.
 *
 * Right for status and kind, where one document commonly declares the same thing
 * in several places — frontmatter, title, and an H1 can all say "plan". Counting
 * events there would report a four-plan corpus as holding twelve plans.
 */
function countArtifacts(signals: CorpusWorkSignal[], predicate: string, object?: string): number {
  return new Set(matching(signals, predicate, object).map((signal) => signal.artifact_id)).size;
}

/**
 * Assemble the corpus index.
 *
 * Every field is copied from the observation, the packet, or one of the two
 * analyses. Nothing is recomputed from source bytes here, so the index cannot
 * disagree with the packet it cites.
 */
export function buildCorpusIndex(input: CorpusAnalysisInput): CorpusIndex {
  const { observation, packet } = input;
  const repositoryId = repositoryIdFor(input.repositoryName);
  const threshold = input.nearDuplicateThreshold ?? DEFAULT_NEAR_DUPLICATE_THRESHOLD;
  if (!(threshold >= 0 && threshold <= 1)) {
    throw new Error(`corpus-analysis: near-duplicate threshold must be within [0,1], got ${threshold}`);
  }

  const { clusters, relations } = buildDuplicateProjection(observation, repositoryId);
  const duplicatePaths = new Set(clusters.flatMap((cluster) => cluster.source_paths));
  const clusterByPath = new Map<string, string>();
  const representativeByPath = new Map<string, string>();
  for (const cluster of clusters) {
    for (const sourcePath of cluster.source_paths) {
      clusterByPath.set(sourcePath, cluster.cluster_id);
      representativeByPath.set(sourcePath, cluster.representative_source_path);
    }
  }

  const candidates = input.skipNearDuplicates === true
    ? []
    : indexedNearDuplicates(
      analysableDocuments(observation, repositoryId, representativeByPath),
      threshold,
    );

  const workSignals: CorpusWorkSignal[] = packet.payload.assertions
    .filter(isWorkSignal)
    .map((assertion) => ({
      assertion_id: assertion.assertion_id,
      artifact_id: assertion.subject_id,
      predicate: assertion.predicate,
      object: assertion.object,
      source_path: assertion.source_path,
      source_range: assertion.source_range,
      extractor_id: assertion.extractor_id,
      evidence_class: assertion.evidence_class,
      confidence: assertion.confidence,
    }))
    .sort((a, b) =>
      compareCodePoints(a.source_path, b.source_path)
      || a.source_range.start_line - b.source_range.start_line
      || compareCodePoints(a.predicate, b.predicate)
      || compareCodePoints(a.object, b.object)
      || compareCodePoints(a.assertion_id, b.assertion_id));

  const assertionsByArtifact = new Map<string, string[]>();
  const signalsByArtifact = new Map<string, Record<string, number>>();
  for (const assertion of packet.payload.assertions) {
    const list = assertionsByArtifact.get(assertion.subject_id) ?? [];
    list.push(assertion.assertion_id);
    assertionsByArtifact.set(assertion.subject_id, list);
  }
  for (const signal of workSignals) {
    const summary = signalsByArtifact.get(signal.artifact_id) ?? {};
    summary[signal.predicate] = (summary[signal.predicate] ?? 0) + 1;
    signalsByArtifact.set(signal.artifact_id, summary);
  }

  const candidatesByArtifact = new Map<string, string[]>();
  for (const candidate of candidates) {
    for (const artifactId of [candidate.artifact_a_id, candidate.artifact_b_id]) {
      const list = candidatesByArtifact.get(artifactId) ?? [];
      list.push(candidate.candidate_id);
      candidatesByArtifact.set(artifactId, list);
    }
  }

  const memberPaths = new Set(observation.virtualArtifacts.map((member) => member.virtualSourcePath));
  const artifacts: CorpusArtifactEntry[] = packet.payload.artifacts
    .map((artifact) => ({
      artifact_id: artifact.artifact_id,
      source_path: artifact.source_path,
      artifact_type: artifact.artifact_type,
      content_hash: artifact.content_hash === "Unknown" ? null : artifact.content_hash,
      size_bytes: sizeOf(observation, artifact.source_path),
      is_archive_member: memberPaths.has(artifact.source_path),
      assertion_ids: [...(assertionsByArtifact.get(artifact.artifact_id) ?? [])].sort(compareCodePoints),
      work_signal_summary: sortedSummary(signalsByArtifact.get(artifact.artifact_id) ?? {}),
      exact_duplicate_cluster_id: clusterByPath.get(artifact.source_path) ?? null,
      near_duplicate_candidate_ids:
        [...(candidatesByArtifact.get(artifact.artifact_id) ?? [])].sort(compareCodePoints),
    }))
    .sort((a, b) => compareCodePoints(a.source_path, b.source_path));

  const summary: CorpusIndexSummary = {
    artifact_count: artifacts.length,
    archive_count: observation.archives.length,
    archive_member_count: observation.virtualArtifacts.length,
    interpreted_artifact_count: new Set(packet.payload.assertions.map((a) => a.source_path)).size,
    assertion_count: packet.payload.assertions.length,
    artifacts_with_work_signals: new Set(workSignals.map((signal) => signal.artifact_id)).size,
    exact_duplicate_cluster_count: clusters.length,
    exact_duplicate_artifact_count: duplicatePaths.size,
    recoverable_duplicate_bytes: clusters.reduce((total, c) => total + c.recoverable_bytes, 0),
    near_duplicate_candidate_count: candidates.length,
    open_task_count: countMatching(workSignals, "work.task.open"),
    completed_task_count: countMatching(workSignals, "work.task.completed"),
    milestone_count: countMatching(workSignals, "work.milestone"),
    wip_count: countArtifacts(workSignals, "work.status", "wip"),
    draft_count: countArtifacts(workSignals, "work.status", "draft"),
    blocked_count: countArtifacts(workSignals, "work.status", "blocked"),
    roadmap_count: countArtifacts(workSignals, "work.kind", "roadmap"),
    plan_count: countArtifacts(workSignals, "work.kind", "plan"),
  };

  return {
    schema: CORPUS_INDEX_SCHEMA,
    source: {
      source_name: observation.sourceName,
      source_revision: observation.sourceRevision,
      physical_snapshot_hash: observation.physicalSnapshotHash,
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
      near_duplicate_method: NEAR_DUPLICATE_METHOD,
      near_duplicate_version: NEAR_DUPLICATE_VERSION,
      near_duplicate_threshold: threshold,
      near_duplicate_analysed: input.skipNearDuplicates !== true,
    },
    summary,
    artifacts,
    work_signals: workSignals,
    exact_duplicate_clusters: clusters,
    relations,
    near_duplicate_candidates: candidates,
    diagnostics: [...observation.diagnostics]
      .map((diagnostic) => ({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        ...(diagnostic.sourcePath !== undefined ? { source_path: diagnostic.sourcePath } : {}),
      }))
      .sort((a, b) =>
        compareCodePoints(a.code, b.code)
        || compareCodePoints(a.source_path ?? "", b.source_path ?? "")
        || compareCodePoints(a.message, b.message)),
  };
}

function sizeOf(observation: LocalSourceObservation, sourcePath: string): number | null {
  const record = observation.inventory.records.find((item) => item.relative_path === sourcePath);
  return record?.size_bytes ?? null;
}

function sortedSummary(summary: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(summary).sort(compareCodePoints)) out[key] = summary[key];
  return out;
}

/**
 * The analysis identity a corpus index was produced under.
 *
 * The threshold is part of it: the same corpus analysed at 0.85 and at 0.6 is the
 * same evidence under two different questions, and the answers should not be
 * confused for one another.
 */
export function corpusAnalysisIdentity(threshold: number): string {
  return corpusSemanticHash({
    corpus_profile_id: CORPUS_PROFILE_ID,
    corpus_profile_version: CORPUS_PROFILE_VERSION,
    near_duplicate_method: NEAR_DUPLICATE_METHOD,
    near_duplicate_version: NEAR_DUPLICATE_VERSION,
    near_duplicate_threshold: threshold,
    shingle_size: NEAR_DUPLICATE_SHINGLE_SIZE,
    minimum_tokens: NEAR_DUPLICATE_MIN_TOKENS,
  });
}

/**
 * Canonical JSON for a corpus index.
 *
 * The packet canonicalizer is deliberately integer-only: the Repository Model
 * wire contract forbids floats so two runtimes can never disagree about a
 * decimal's representation. A similarity score is genuinely fractional, so the
 * corpus index cannot use that serializer and needs its own rule instead of
 * loosening the wire one.
 *
 * Determinism here comes from two things: keys are ordered by code point, and
 * every score is rounded to a fixed precision before it is stored, so the
 * shortest round-trip representation JavaScript emits is stable rather than
 * accidental.
 */
export function canonicalCorpusJson(value: unknown): string {
  const render = (item: unknown): string => {
    if (item === null) return "null";
    if (Array.isArray(item)) return `[${item.map(render).join(",")}]`;
    if (typeof item === "object") {
      const source = item as Record<string, unknown>;
      const keys = Object.keys(source).filter((key) => source[key] !== undefined).sort(compareCodePoints);
      return `{${keys.map((key) => `${JSON.stringify(key)}:${render(source[key])}`).join(",")}}`;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) {
        throw new Error(`corpus-analysis: a non-finite number cannot be serialized, got ${String(item)}`);
      }
      return JSON.stringify(item);
    }
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    throw new Error(`corpus-analysis: unsupported value of type ${typeof item}`);
  };
  return render(value);
}

/**
 * Content identity for corpus values, over the corpus canonical form.
 *
 * Separate from the packet's `semanticHash` for the same reason
 * `canonicalCorpusJson` is separate from `canonicalJson`: corpus identity has to
 * cover a fractional threshold, and the packet's hash refuses floats on purpose.
 */
export function corpusSemanticHash(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(canonicalCorpusJson(value), "utf8").digest("hex")}`;
}

export function corpusStableId(prefix: string, value: unknown): string {
  return `${prefix}:${corpusSemanticHash(value).slice("sha256:".length)}`;
}

export type { AnalysableDocument };
