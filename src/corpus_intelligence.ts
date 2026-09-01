// corpus_intelligence.ts — emit the canonical `l9.corpus-intelligence` packet.
//
// A corpus run already produces everything this packet carries. What it did not
// produce was the packet: the analysis was written as a family of separately
// versioned documents in a generation directory, and the consumer read that
// directory through a compatibility adapter it owned. That put the boundary in
// the wrong repository. A directory layout is not a contract — it has no
// version, so a rename here surfaced downstream as adapter breakage rather than
// as a version mismatch, and the only fixtures proving the seam were synthetic
// ones the consumer wrote for itself.
//
// This module closes that. The packet is built from the generation the producer
// has just computed, in memory, and emitted beside it as a hash-bound bundle.
//
// Three rules follow from "the producer owns this boundary":
//
// **Nothing is re-observed.** Every value comes from documents this run already
// wrote. Re-reading a disk here would make the packet a second observation of
// the corpus, and two observations that disagree is the failure a packet
// boundary exists to prevent.
//
// **Nothing is invented.** Where the generation does not carry something the
// packet requires, emission fails. A default would wear the producer's
// authority while being a guess.
//
// **The analysis is not redone.** Duplicate detection, pair scoring, candidate
// grouping, readiness counting and reasoning routing all happened upstream.
// This module translates their output into one contract; it does not compute a
// second opinion about any of them.

import * as fs from "node:fs";
import * as path from "node:path";

import { compareCodePoints } from "./ordering";
import {
  type CanonicalValue,
  CanonicalFloat,
  canonicalJson,
  semanticHash,
  sha256TextPrefixed,
} from "./repository_model";

export const CORPUS_INTELLIGENCE_PACKET_TYPE = "l9.corpus-intelligence";
export const CORPUS_INTELLIGENCE_PACKET_VERSION = "1.0.0";
export const CORPUS_INTELLIGENCE_PRODUCER_NAME = "l9-meta-injector.corpus-intelligence";
export const CORPUS_INTELLIGENCE_MANIFEST_VERSION = "1.0.0";

/**
 * Where the bundle lives inside a published corpus generation.
 *
 * Named here rather than in the CLI because it is the one part of the
 * generation's layout that is contract rather than projection: a consumer
 * looking for the canonical packet looks here, and moving it is a breaking
 * change to be versioned, not a directory rename.
 */
export const CORPUS_INTELLIGENCE_DIRECTORY = "corpus-intelligence";

const JSON_MEDIA_TYPE = "application/json";
const PACKET_RELATIVE_PATH = "packet.json";
const MANIFEST_RELATIVE_PATH = "manifest.json";

/**
 * Payload domains, in the order a reader meets them.
 *
 * Every one is serialized to its own file and its own hash. An empty array
 * means the producer found nothing of that kind, which is a different statement
 * from a domain that was never run — so every domain is always written, even
 * empty.
 */
export const CORPUS_PAYLOAD_FIELDS = [
  "document_work_signals",
  "exact_duplicate_relations",
  "semantic_pair_relations",
  "topic_candidates",
  "project_candidates",
  "consolidation_candidates",
  "readiness_evidence",
  "reasoning_candidates",
  "reasoning_evidence_pack_refs",
] as const;

export type CorpusPayloadField = (typeof CORPUS_PAYLOAD_FIELDS)[number];

export function corpusPayloadPath(field: CorpusPayloadField): string {
  return `payload/${field.replace(/_/g, "-")}.json`;
}

export type CorpusConfidenceClass = "weak" | "moderate" | "strong";
export type CorpusCandidateType =
  | "TOPIC_CANDIDATE"
  | "PROJECT_CANDIDATE"
  | "CONSOLIDATION_CANDIDATE";
export type CorpusRootIdentityClass = "declared" | "inferred";
export type CorpusEvidenceClass = "declared" | "observed";
export type UpstreamReasoningType =
  | "NONE"
  | "SAME_BODY_OF_WORK_ADJUDICATION"
  | "PROJECT_IDENTITY_ADJUDICATION"
  | "VERSION_EVOLUTION_ANALYSIS"
  | "CONSOLIDATION_ANALYSIS"
  | "SUPERSESSION_ANALYSIS"
  | "CONFLICT_RESOLUTION_ANALYSIS";

/** Reasoning vocabularies the consumer routes to. Anything else is refused. */
const UPSTREAM_REASONING_TYPES: ReadonlySet<string> = new Set([
  "NONE",
  "SAME_BODY_OF_WORK_ADJUDICATION",
  "PROJECT_IDENTITY_ADJUDICATION",
  "VERSION_EVOLUTION_ANALYSIS",
  "CONSOLIDATION_ANALYSIS",
  "SUPERSESSION_ANALYSIS",
  "CONFLICT_RESOLUTION_ANALYSIS",
]);

const CONFIDENCE_CLASSES: ReadonlySet<string> = new Set(["weak", "moderate", "strong"]);

/**
 * Document formats that genuinely have lines.
 *
 * A work signal decoded from anything else may not carry a line locator: the
 * coordinate would be a fabrication of the flattening step rather than a place
 * in the source document. Mirrors the consumer's own rule, enforced here so a
 * fabricated coordinate never leaves this repository.
 */
const LINE_BEARING_FORMATS: ReadonlySet<string> = new Set([
  "text",
  "markdown",
  "csv",
  "html",
  "ipynb",
]);

export class CorpusIntelligenceError extends Error {}

// ───────────────────────────── packet contract ─────────────────────────────

export interface CorpusPacketRef {
  packet_id: string;
  packet_type: string;
  packet_version: string;
  uri: string;
  semantic_hash: string;
  artifact_hash?: string;
  validation_status: "passed" | "failed" | "not_run" | "blocked";
  subject_id?: string;
  source_revision?: string;
}

export interface CorpusRootRef {
  root_id: string;
  identity_class: CorpusRootIdentityClass;
  source_revision: string;
  repository_model_packet: CorpusPacketRef;
  repository_id?: string;
}

export interface CorpusCoverage {
  root_count_requested: number;
  root_count_observed: number;
  root_count_failed: number;
  artifact_count: number;
  archive_count: number;
  archive_member_count: number;
  decoder_eligible_count: number;
  normalized_document_count: number;
  interpreted_artifact_count: number;
  unsupported_format_count: number;
  coverage_gap_count: number;
}

export interface CorpusDescriptor {
  corpus_id: string;
  corpus_source_snapshot_id: string;
  corpus_analysis_id: string;
  root_refs: CorpusRootRef[];
  coverage: CorpusCoverage;
}

export interface CorpusAnalysisProfileRef {
  profile_id: string;
  profile_version: string;
  profile_hash: string;
}

export interface DocumentWorkSignal {
  signal_id: string;
  artifact_id: string;
  subject_id: string;
  predicate: string;
  object: string;
  source_path: string;
  locator: Record<string, CanonicalValue>;
  source_content_hash: string;
  document_format: string;
  evidence_excerpt: string;
  extractor_id: string;
  decoder_id: string;
  decoder_version: string;
  evidence_class: CorpusEvidenceClass;
  authority: string;
  confidence: string;
  corpus_artifact_id: string;
  normalized_document_id: string | null;
  block_id: string;
  block_kind: string;
  extractor_profile_version: string;
}

export interface ExactDuplicateRelation {
  relation_id: string;
  duplicate_cluster_id: string;
  artifact_a_id: string;
  artifact_b_id: string;
  content_hash: string;
}

export interface PairMethodScore {
  method: string;
  /**
   * A measurement in [0,1], typed as a float rather than a number.
   *
   * The consumer's field is a float and CPython renders one as `1.0` where this
   * runtime renders `1`. A categorical signal that fired scores exactly 1, so
   * the ambiguous case is the common one; the marker removes the ambiguity at
   * the type level instead of leaving it to whoever writes the next producer.
   */
  score: CanonicalFloat;
}

export interface SemanticPairRelation {
  relation_id: string;
  source_artifact_id: string;
  target_artifact_id: string;
  methods: string[];
  method_scores: PairMethodScore[];
  evidence_refs: string[];
  confidence_class: CorpusConfidenceClass;
  analysis_profile: CorpusAnalysisProfileRef;
  upstream_candidate_id: string | null;
}

export interface CandidateCluster {
  candidate_id: string;
  candidate_type: CorpusCandidateType;
  member_artifact_ids: string[];
  supporting_relation_ids: string[];
  evidence_refs: string[];
  confidence_class: CorpusConfidenceClass;
  ambiguity_flags: string[];
  cross_root: boolean;
  cross_archive: boolean;
  analysis_profile: CorpusAnalysisProfileRef;
  upstream_candidate_id: string | null;
}

export interface ReadinessEvidence {
  readiness_id: string;
  subject_id: string;
  profile_id: string;
  profile_version: string;
  source_artifact_count: number;
  test_artifact_count: number;
  build_manifest_count: number;
  ci_definition_count: number;
  deployment_definition_count: number;
  specification_count: number;
  documentation_count: number;
  plan_count: number;
  roadmap_count: number;
  wip_count: number;
  draft_count: number;
  blocked_count: number;
  open_task_count: number;
  completed_task_count: number;
  milestone_count: number;
  exact_duplicate_count: number;
  near_duplicate_count: number;
  consolidation_candidate_count: number;
  coverage_gap_count: number;
  evidence_refs: string[];
}

export interface ReasoningCandidateRequest {
  reasoning_candidate_id: string;
  candidate_id: string;
  recommended_reasoning_type: UpstreamReasoningType;
  reason: string;
  member_artifact_ids: string[];
  evidence_pack_ref: string | null;
}

export interface CorpusIntelligencePayload {
  document_work_signals: DocumentWorkSignal[];
  exact_duplicate_relations: ExactDuplicateRelation[];
  semantic_pair_relations: SemanticPairRelation[];
  topic_candidates: CandidateCluster[];
  project_candidates: CandidateCluster[];
  consolidation_candidates: CandidateCluster[];
  readiness_evidence: ReadinessEvidence[];
  reasoning_candidates: ReasoningCandidateRequest[];
  reasoning_evidence_pack_refs: string[];
}

export interface CorpusIntelligenceInputs {
  repository_model_packets: CorpusPacketRef[];
}

export interface CorpusIntelligencePacket {
  packet_type: string;
  packet_version: string;
  packet_id: string;
  producer: { name: string; version: string };
  profile: { id: string; version: string; hash: string };
  inputs: CorpusIntelligenceInputs;
  corpus: CorpusDescriptor;
  validation: { status: "passed" | "failed" | "not_run" | "blocked"; receipt_ref?: string };
  schema_hash: string;
  semantic_hash: string;
  artifact_hash?: string;
  payload_refs: Record<string, string>;
  payload_hashes: Record<string, string>;
  lineage: {
    parent_packet_ids: string[];
    root_packet_id: string | null;
    generation: number;
  };
  created_at: string;
}

/**
 * Identity of the contract this build implements.
 *
 * Hashed over the declared domains and the packet's own field names rather than
 * a hand-written version string, so a domain added or renamed here moves the
 * identity whether or not anyone remembered to bump something.
 */
const SCHEMA_HASH = semanticHash({
  packet_type: CORPUS_INTELLIGENCE_PACKET_TYPE,
  packet_version: CORPUS_INTELLIGENCE_PACKET_VERSION,
  payload_fields: [...CORPUS_PAYLOAD_FIELDS],
});

// ───────────────────────────── serialization ─────────────────────────────

/**
 * Serialize one document exactly as it will exist on disk, and hash those bytes.
 *
 * One helper, because the packet's `payload_hashes` and the bundle manifest's
 * per-file `content_hash` must be the *same* number: the consumer reads a
 * payload file, hashes its exact bytes, and compares against the hash the packet
 * declared. Computing the declared hash any other way — over the parsed value,
 * over canonical JSON without the trailing newline, or through `semanticHash`,
 * which strips volatile keys before hashing — produces a packet whose payload
 * can never be read back, and the failure surfaces downstream as a corrupted
 * bundle rather than as the producer defect it is.
 */
function canonicalDocument(value: unknown): {
  contents: string;
  entry: Omit<CorpusBundleFile, "path">;
} {
  // The consumer reads canonical JSON with a single trailing newline.
  const contents = `${canonicalJson(value)}\n`;
  return {
    contents,
    entry: {
      media_type: JSON_MEDIA_TYPE,
      content_hash: sha256TextPrefixed(contents),
      size_bytes: Buffer.byteLength(contents, "utf8"),
    },
  };
}

// ───────────────────────────── build input ─────────────────────────────

/** One observed root, with the Repository Model Packet it produced. */
export interface CorpusIntelligenceRootInput {
  rootId: string;
  identityClass: CorpusRootIdentityClass;
  sourceRevision: string;
  repositoryId?: string;
  /** The exact packet this root produced, as emitted. */
  packet: {
    packet_id: string;
    packet_type: string;
    packet_version: string;
    semantic_hash: string;
    artifact_hash?: string;
    validation: { status: "passed" | "failed" | "not_run" | "blocked" };
    subject: { repository_id: string };
    source_snapshot: { revision: string };
    payload: { artifacts: { artifact_id: string; source_path: string; content_hash: string }[] };
  };
}

export interface BuildCorpusIntelligenceInput {
  corpusId: string;
  /** Identity of what the disks held. Excludes every analysis profile. */
  corpusSourceSnapshotId: string;
  /** Identity of what was concluded, and under which rules. */
  corpusAnalysisId: string;
  roots: readonly CorpusIntelligenceRootInput[];
  coverage: CorpusCoverage;
  payload: CorpusIntelligencePayload;
  producerVersion: string;
  profile: { id: string; version: string; hash: string };
  createdAt: string;
}

// ───────────────────────────── helpers ─────────────────────────────

function requireText(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CorpusIntelligenceError(`${context}: expected a non-empty string`);
  }
  return value;
}

function packetRef(root: CorpusIntelligenceRootInput): CorpusPacketRef {
  const packet = root.packet;
  const reference: CorpusPacketRef = {
    packet_id: packet.packet_id,
    packet_type: packet.packet_type,
    packet_version: packet.packet_version,
    uri: `packet://${packet.packet_id}`,
    semantic_hash: packet.semantic_hash,
    validation_status: packet.validation.status,
    subject_id: packet.subject.repository_id,
    source_revision: packet.source_snapshot.revision,
  };
  if (packet.artifact_hash !== undefined) reference.artifact_hash = packet.artifact_hash;
  return reference;
}

/**
 * Every artifact identity the input packets carry, plus their repositories.
 *
 * A work signal's *subject* is often the repository rather than the file: the
 * file is where the signal was read, the repository is what it is about.
 */
function artifactIdentities(roots: readonly CorpusIntelligenceRootInput[]): ReadonlySet<string> {
  const identities = new Set<string>();
  for (const root of roots) {
    identities.add(root.packet.subject.repository_id);
    for (const artifact of root.packet.payload.artifacts) identities.add(artifact.artifact_id);
  }
  return identities;
}

// ───────────────────────────── validation ─────────────────────────────

/**
 * Refuse a packet that is not referentially sound.
 *
 * The consumer runs the same checks and refuses the whole packet rather than
 * compiling the resolvable part, so failing here is not redundant: it turns a
 * producer defect into a producer error, at the point where the run that caused
 * it is still in hand.
 */
export function validateCorpusIntelligencePacket(
  packet: CorpusIntelligencePacket,
  payload: CorpusIntelligencePayload,
  roots: readonly CorpusIntelligenceRootInput[],
): string[] {
  const errors: string[] = [];
  const identities = artifactIdentities(roots);
  const declared = new Set(packet.inputs.repository_model_packets.map((ref) => ref.packet_id));

  for (const reference of packet.inputs.repository_model_packets) {
    if (reference.packet_type !== "l9.repository-model") {
      errors.push(
        `input ${reference.packet_id} is a ${reference.packet_type}, not an l9.repository-model packet`,
      );
    }
  }
  for (const root of packet.corpus.root_refs) {
    if (!declared.has(root.repository_model_packet.packet_id)) {
      errors.push(
        `root ${root.root_id} references packet ${root.repository_model_packet.packet_id}, which is not a declared input`,
      );
    }
  }
  const rootIds = packet.corpus.root_refs.map((root) => root.root_id);
  if (new Set(rootIds).size !== rootIds.length) {
    errors.push("corpus roots must have unique identities");
  }

  const resolve = (identity: string, context: string): void => {
    if (!identities.has(identity)) {
      errors.push(`${context} names ${identity}, which no input packet carries`);
    }
  };

  for (const signal of payload.document_work_signals) {
    resolve(signal.artifact_id, `work signal ${signal.signal_id}`);
    resolve(signal.subject_id, `work signal ${signal.signal_id} subject`);
    const kind = typeof signal.locator.kind === "string" ? signal.locator.kind : "";
    if (kind === "line" && !LINE_BEARING_FORMATS.has(signal.document_format)) {
      errors.push(
        `work signal ${signal.signal_id} claims a line locator for format ` +
          `'${signal.document_format}', which has no lines`,
      );
    }
  }
  for (const relation of payload.exact_duplicate_relations) {
    if (relation.artifact_a_id === relation.artifact_b_id) {
      errors.push(`duplicate relation ${relation.relation_id} names one artifact twice`);
    }
    resolve(relation.artifact_a_id, `duplicate relation ${relation.relation_id}`);
    resolve(relation.artifact_b_id, `duplicate relation ${relation.relation_id}`);
  }
  for (const relation of payload.semantic_pair_relations) {
    if (relation.source_artifact_id === relation.target_artifact_id) {
      errors.push(`pair relation ${relation.relation_id} names one artifact twice`);
    }
    resolve(relation.source_artifact_id, `pair relation ${relation.relation_id}`);
    resolve(relation.target_artifact_id, `pair relation ${relation.relation_id}`);
    if (!CONFIDENCE_CLASSES.has(relation.confidence_class)) {
      errors.push(
        `pair relation ${relation.relation_id} declares confidence class '${relation.confidence_class}'`,
      );
    }
  }

  const candidateDomains: [CorpusPayloadField, CorpusCandidateType][] = [
    ["topic_candidates", "TOPIC_CANDIDATE"],
    ["project_candidates", "PROJECT_CANDIDATE"],
    ["consolidation_candidates", "CONSOLIDATION_CANDIDATE"],
  ];
  const knownCandidates = new Set<string>();
  for (const [field, expected] of candidateDomains) {
    for (const cluster of payload[field] as CandidateCluster[]) {
      knownCandidates.add(cluster.candidate_id);
      if (cluster.candidate_type !== expected) {
        errors.push(
          `${field} carries ${cluster.candidate_id} declared as ` +
            `'${cluster.candidate_type}', expected '${expected}'`,
        );
      }
      if (cluster.member_artifact_ids.length === 0) {
        errors.push(`candidate ${cluster.candidate_id} names no members`);
      }
      for (const member of cluster.member_artifact_ids) {
        resolve(member, `candidate ${cluster.candidate_id}`);
      }
    }
  }
  for (const request of payload.reasoning_candidates) {
    if (!knownCandidates.has(request.candidate_id)) {
      errors.push(
        `reasoning candidate ${request.reasoning_candidate_id} names candidate ` +
          `${request.candidate_id}, which this packet does not carry`,
      );
    }
    if (!UPSTREAM_REASONING_TYPES.has(request.recommended_reasoning_type)) {
      errors.push(
        `reasoning candidate ${request.reasoning_candidate_id} recommends ` +
          `'${request.recommended_reasoning_type}', which is not a routable type`,
      );
    }
  }
  for (const record of payload.readiness_evidence) {
    if (!knownCandidates.has(record.subject_id) && !identities.has(record.subject_id)) {
      errors.push(
        `readiness ${record.readiness_id} is about ${record.subject_id}, which is ` +
          "neither a candidate nor a resolvable entity",
      );
    }
  }
  return errors;
}

// ───────────────────────────── packet construction ─────────────────────────────

/** Build the canonical packet from one corpus run's own analysis output. */
export function buildCorpusIntelligencePacket(
  input: BuildCorpusIntelligenceInput,
): { packet: CorpusIntelligencePacket; payload: CorpusIntelligencePayload } {
  requireText(input.corpusId, "corpus_id");
  requireText(input.corpusSourceSnapshotId, "corpus_source_snapshot_id");
  requireText(input.corpusAnalysisId, "corpus_analysis_id");
  if (input.roots.length === 0) {
    throw new CorpusIntelligenceError(
      "a corpus intelligence packet is an analysis over repository model packets; " +
        "emitting one over no roots would be an analysis of nothing",
    );
  }

  const payload = input.payload;
  const inputs: CorpusIntelligenceInputs = {
    repository_model_packets: input.roots
      .map(packetRef)
      .sort((a, b) => compareCodePoints(a.packet_id, b.packet_id)),
  };
  const rootRefs: CorpusRootRef[] = input.roots
    .map((root) => {
      const reference: CorpusRootRef = {
        root_id: root.rootId,
        identity_class: root.identityClass,
        source_revision: root.sourceRevision,
        repository_model_packet: packetRef(root),
      };
      if (root.repositoryId !== undefined) reference.repository_id = root.repositoryId;
      return reference;
    })
    .sort((a, b) => compareCodePoints(a.root_id, b.root_id));

  const corpus: CorpusDescriptor = {
    corpus_id: input.corpusId,
    corpus_source_snapshot_id: input.corpusSourceSnapshotId,
    corpus_analysis_id: input.corpusAnalysisId,
    root_refs: rootRefs,
    coverage: input.coverage,
  };

  const payload_refs: Record<string, string> = {};
  const payload_hashes: Record<string, string> = {};
  for (const field of CORPUS_PAYLOAD_FIELDS) {
    payload_refs[field] = corpusPayloadPath(field);
    payload_hashes[field] = canonicalDocument(payload[field]).entry.content_hash;
  }

  const shell: CorpusIntelligencePacket = {
    packet_type: CORPUS_INTELLIGENCE_PACKET_TYPE,
    packet_version: CORPUS_INTELLIGENCE_PACKET_VERSION,
    packet_id: "",
    producer: { name: CORPUS_INTELLIGENCE_PRODUCER_NAME, version: input.producerVersion },
    profile: input.profile,
    inputs,
    corpus,
    validation: { status: "passed" },
    schema_hash: SCHEMA_HASH,
    semantic_hash: "",
    payload_refs,
    payload_hashes,
    lineage: {
      parent_packet_ids: inputs.repository_model_packets.map((ref) => ref.packet_id),
      root_packet_id: null,
      generation: 1,
    },
    created_at: input.createdAt,
  };

  // Exactly the consumer's semantic view: the payload is hashed through
  // payload_hashes rather than serialized twice into two identities that could
  // drift, and packet_id, semantic_hash, artifact_hash and created_at are
  // stripped as volatile before hashing.
  const semantic = semanticHash({
    packet_type: shell.packet_type,
    packet_version: shell.packet_version,
    producer: shell.producer,
    profile: shell.profile,
    inputs: shell.inputs,
    corpus: shell.corpus,
    schema_hash: shell.schema_hash,
    payload_refs: shell.payload_refs,
    payload_hashes: shell.payload_hashes,
    lineage: shell.lineage,
  });
  const packet: CorpusIntelligencePacket = {
    ...shell,
    packet_id: `packet:${semantic.slice("sha256:".length)}`,
    semantic_hash: semantic,
  };

  const errors = validateCorpusIntelligencePacket(packet, payload, input.roots);
  if (errors.length > 0) {
    throw new CorpusIntelligenceError(
      `corpus-intelligence: refusing to emit a packet that is not referentially sound:\n  - ${errors.join("\n  - ")}`,
    );
  }
  return { packet, payload };
}

// ───────────────────────────── bundle emission ─────────────────────────────

export interface CorpusBundleFile {
  path: string;
  media_type: string;
  content_hash: string;
  size_bytes: number;
}

export interface CorpusIntelligenceBundle {
  /** Files relative to the bundle root, in code-point order. */
  files: { path: string; contents: string }[];
  manifest: {
    manifest_version: string;
    packet_id: string;
    packet_type: string;
    packet_version: string;
    semantic_hash: string;
    artifact_hash: string;
    files: CorpusBundleFile[];
    created_at: string;
  };
}

/**
 * Render the packet and its payload as an integrity-bound bundle.
 *
 * Returned rather than written, so a caller can publish it atomically with the
 * generation it describes instead of leaving a window where one exists without
 * the other.
 */
export function buildCorpusIntelligenceBundle(
  packet: CorpusIntelligencePacket,
  payload: CorpusIntelligencePayload,
  options: { createdAt: string },
): CorpusIntelligenceBundle {
  const files: { path: string; contents: string }[] = [];
  const entries: CorpusBundleFile[] = [];

  const record = (relative: string, value: unknown): void => {
    const { contents, entry } = canonicalDocument(value);
    files.push({ path: relative, contents });
    entries.push({ path: relative, ...entry });
  };

  record(PACKET_RELATIVE_PATH, packet);
  for (const field of CORPUS_PAYLOAD_FIELDS) {
    record(corpusPayloadPath(field), payload[field]);
  }
  entries.sort((a, b) => compareCodePoints(a.path, b.path));

  const manifest = {
    manifest_version: CORPUS_INTELLIGENCE_MANIFEST_VERSION,
    packet_id: packet.packet_id,
    packet_type: packet.packet_type,
    packet_version: packet.packet_version,
    semantic_hash: packet.semantic_hash,
    // Recomputed by the consumer over the file entries alone.
    artifact_hash: semanticHash(entries),
    files: entries,
    created_at: options.createdAt,
  };
  const { contents } = canonicalDocument(manifest);
  files.push({ path: MANIFEST_RELATIVE_PATH, contents });
  files.sort((a, b) => compareCodePoints(a.path, b.path));
  return { files, manifest };
}

/** Write a bundle to disk. Refuses to write into a non-empty directory. */
export function writeCorpusIntelligenceBundle(
  bundle: CorpusIntelligenceBundle,
  outDir: string,
): string {
  const bundleRoot = path.resolve(outDir);
  if (fs.existsSync(bundleRoot) && fs.readdirSync(bundleRoot).length > 0) {
    throw new CorpusIntelligenceError(
      `corpus-intelligence: packet bundles are immutable; refusing to write into a non-empty directory: ${bundleRoot}`,
    );
  }
  for (const file of bundle.files) {
    const absolute = path.join(bundleRoot, file.path);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, Buffer.from(file.contents, "utf8"));
  }
  return bundleRoot;
}
