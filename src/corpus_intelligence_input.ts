// corpus_intelligence_input.ts — translate a corpus run into the packet's input.
//
// `corpus_intelligence.ts` owns the contract: what an `l9.corpus-intelligence`
// packet is, how its identity is computed, and what makes one referentially
// unsound. This module owns the other half — turning the run that just happened
// into that contract's input — and it exists separately because the two answer
// different questions and change for different reasons. The contract changes
// when the consumer's expectations change; this changes when the producer's
// internal documents do.
//
// The translation was, until now, on the consumer's side of the boundary:
// `l9-constellation-topology` reads a generation directory through an adapter it
// owns and maps it into the packet itself. That adapter is the specification
// this module is written against, deliberately — a consumer that already
// compiles real generations is a better statement of the target than anything
// derived from the types alone.
//
// Three places where this does *not* reproduce the adapter, each because the
// producer can answer a question the adapter could only guess at:
//
// **Analysis profile.** The adapter reads `fusion_profile_id`,
// `fusion_profile_version` and `fusion_profile_hash` from the candidate
// documents. Those field names do not exist: the producer's semantic profile
// calls them `semantic_analysis_profile_id`, `semantic_analysis_profile_version`
// and `semantic_fusion_profile_hash`, so every candidate the adapter has ever
// produced carries `profile_version: "unknown"` and a `profile_id` invented from
// the candidate type. Emitted here from the profile the run actually used.
//
// **Locators.** The adapter translates the producer's coordinate naming into the
// consumer's; here the producer emits the consumer's naming directly, from the
// typed `BlockLocator` union, so a coordinate system added to a decoder is a
// type error in this file rather than an unknown kind at the far end.
//
// **Identity translation.** The adapter reconstructs the corpus-id-to-packet-id
// mapping by joining the snapshot against loaded bundles. The same join happens
// here, against the packets this run holds in memory, which is the same answer
// arrived at without re-reading anything.
//
// Nothing else is reinterpreted. Where the adapter carries a value through
// unchanged, so does this; where it sorts or de-duplicates, so does this; and
// where the run does not carry something the packet wants, this refuses rather
// than defaulting.

import type { BlockLocator } from "./documents/decoder";
import type {
  BuildCorpusIntelligenceInput,
  CandidateCluster,
  CorpusAnalysisProfileRef,
  CorpusCandidateType,
  CorpusConfidenceClass,
  CorpusCoverage,
  CorpusIntelligencePayload,
  CorpusIntelligenceRootInput,
  CorpusRootIdentityClass,
  DocumentWorkSignal,
  ExactDuplicateRelation,
  PairMethodScore,
  ReadinessEvidence,
  ReasoningCandidateRequest,
  SemanticPairRelation,
  UpstreamReasoningType,
} from "./corpus_intelligence";
import { CorpusIntelligenceError } from "./corpus_intelligence";
import { canonicalFloat } from "./repository_model";
import type { CorpusScanResult } from "./corpus_scan";
import type { BodyOfWorkMetrics } from "./corpus_readiness";
import type { DocumentWorkSignalRecord } from "./corpus_work_signal_export";
import { compareCodePoints } from "./ordering";

/**
 * Formats whose decoded text has lines an operator can open the file and find.
 *
 * Mirrors the consumer's set. A line coordinate on anything else is a
 * coordinate into a derived string, and nothing in the source document.
 */
const LINE_BEARING_FORMATS: ReadonlySet<string> = new Set([
  "text",
  "markdown",
  "csv",
  "html",
  "ipynb",
]);

/** Reasoning vocabularies the consumer routes to. */
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

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareCodePoints);
}

function confidenceClass(value: unknown): CorpusConfidenceClass {
  return typeof value === "string" && CONFIDENCE_CLASSES.has(value)
    ? (value as CorpusConfidenceClass)
    : "weak";
}

// ───────────────────────────── identity translation ─────────────────────────────

/**
 * Map each corpus artifact identity onto the Repository Model Packet's.
 *
 * The producer works in two identity domains: the corpus addresses an artifact
 * inside this corpus, and a root's packet addresses the same file inside its own
 * bundle. The duplicate, pair and candidate documents name only the first, and
 * every consumer of this packet works in the second.
 *
 * The join is the snapshot's `(root_id, root_relative_path)` against each
 * packet's artifact `source_path`. An id whose path no packet carries is left
 * untranslated rather than bound to a guess: the packet's own validator then
 * refuses it, which is the correct outcome — an unresolvable identity is a
 * producer defect, and defaulting it here would hide one.
 */
function identityTranslation(result: CorpusScanResult): ReadonlyMap<string, string> {
  const byRoot = new Map<string, Map<string, string>>();
  for (const root of result.rootPackets) {
    const paths = new Map<string, string>();
    for (const artifact of root.packet.payload.artifacts) {
      paths.set(artifact.source_path, artifact.artifact_id);
    }
    byRoot.set(root.root_id, paths);
  }
  const translated = new Map<string, string>();
  for (const artifact of result.snapshot.artifacts) {
    const resolved = byRoot.get(artifact.root_id)?.get(artifact.root_relative_path);
    if (resolved !== undefined) translated.set(artifact.virtual_source_id, resolved);
  }
  return translated;
}

function translate(identity: string, mapping: ReadonlyMap<string, string>): string {
  return mapping.get(identity) ?? identity;
}

// ───────────────────────────── locators ─────────────────────────────

/**
 * Restate one block coordinate in the consumer's field naming.
 *
 * Exhaustive over `BlockLocator` by construction: the `never` fallthrough makes
 * a coordinate system added to a decoder a compile error here, rather than an
 * unknown kind refused at the far end of the pipeline by someone who cannot fix
 * it.
 */
function lowerLocator(
  locator: BlockLocator,
  documentFormat: string,
  blockKind: string,
  context: string,
): Record<string, string | number> {
  switch (locator.kind) {
    case "line_span": {
      if (!LINE_BEARING_FORMATS.has(documentFormat)) {
        throw new CorpusIntelligenceError(
          `${context}: a ${documentFormat} document carries a line locator; that format ` +
            "has no lines, so the coordinate names nothing openable",
        );
      }
      return { kind: "line", start_line: locator.line_start, end_line: locator.line_end };
    }
    case "notebook_cell": {
      const located: Record<string, string | number> = {
        kind: "notebook",
        cell_index: locator.cell_index,
        cell_type: locator.cell_type,
      };
      // A cell does have lines, so a span within one is a real coordinate.
      if (locator.line_start !== undefined) located.start_line = locator.line_start;
      if (locator.line_end !== undefined) located.end_line = locator.line_end;
      return located;
    }
    case "pdf_page_block":
      return { kind: "pdf", page_number: locator.page_number, block_index: locator.block_index };
    case "docx_block":
      // The block's kind lives on the record rather than in the locator; both
      // describe the same block.
      return {
        kind: "docx",
        block_index: locator.block_index,
        block_kind: blockKind,
        part: locator.part,
      };
    case "pptx_shape":
      return {
        kind: "pptx",
        slide_number: locator.slide_number,
        shape_index: locator.shape_index,
        part: locator.part,
      };
    case "spreadsheet_cell":
      return { kind: "spreadsheet", sheet: locator.sheet, cell_or_range: locator.cell_or_range };
    case "csv_row": {
      const located: Record<string, string | number> = { kind: "csv", row: locator.row_number };
      if (locator.column !== undefined && locator.column !== "") located.column = locator.column;
      return located;
    }
    case "html_node":
      return {
        kind: "html",
        stable_node_index: locator.node_index,
        node_path: locator.node_path,
      };
    default: {
      const unreachable: never = locator;
      throw new CorpusIntelligenceError(
        `${context}: unknown locator kind ${JSON.stringify(unreachable)}`,
      );
    }
  }
}

function workSignal(record: DocumentWorkSignalRecord): DocumentWorkSignal {
  const context = `work signal ${record.signal_id}`;
  return {
    signal_id: record.signal_id,
    artifact_id: record.rmp_artifact_id,
    // The signal is artifact-scoped. Naming the artifact as the subject is a
    // schema translation, not an inference about what the claim is about.
    subject_id: record.rmp_artifact_id,
    predicate: record.predicate,
    object: record.object,
    source_path: record.source_path,
    locator: lowerLocator(
      record.structured_locator as BlockLocator,
      record.format,
      record.block_kind,
      context,
    ),
    source_content_hash: record.raw_content_hash ?? "",
    document_format: record.format,
    evidence_excerpt: record.bounded_excerpt,
    extractor_id: record.extractor_id,
    decoder_id: record.decoder_id,
    decoder_version: record.decoder_version,
    evidence_class: record.evidence_class === "declared" ? "declared" : "observed",
    authority: record.authority,
    confidence: record.confidence,
    corpus_artifact_id: record.artifact_id,
    normalized_document_id: record.normalized_document_id,
    block_id: record.block_id,
    block_kind: record.block_kind,
    extractor_profile_version: record.extractor_profile_version,
  };
}

// ───────────────────────────── payload domains ─────────────────────────────

function duplicateRelations(
  result: CorpusScanResult,
  identities: ReadonlyMap<string, string>,
): ExactDuplicateRelation[] {
  return result.candidates.relations
    .filter((relation) => relation.type === "DUPLICATE_OF")
    .map((relation) => ({
      relation_id: relation.relation_id,
      duplicate_cluster_id: relation.duplicate_cluster_id,
      artifact_a_id: translate(relation.source_artifact_id, identities),
      artifact_b_id: translate(relation.target_artifact_id, identities),
      content_hash: relation.content_hash,
    }))
    .sort((a, b) => compareCodePoints(a.relation_id, b.relation_id));
}

function pairRelations(
  result: CorpusScanResult,
  identities: ReadonlyMap<string, string>,
  profile: CorpusAnalysisProfileRef,
): SemanticPairRelation[] {
  const semantic = result.semantic;
  if (semantic === null) return [];
  const classification = new Map(
    semantic.relations.classifications.map((entry) => [entry.pair_id, entry]),
  );
  return semantic.relations.pairs
    .map((pair): SemanticPairRelation => {
      const scores: PairMethodScore[] = pair.signals
        .map((signal) => ({
          method: signal.method,
          score: canonicalFloat(Math.max(0, Math.min(1, signal.score))),
        }))
        .sort((a, b) => compareCodePoints(a.method, b.method));
      return {
        relation_id: pair.pair_id,
        source_artifact_id: translate(pair.artifact_a_id, identities),
        target_artifact_id: translate(pair.artifact_b_id, identities),
        methods: sortedUnique(pair.signals.map((signal) => signal.method)),
        method_scores: scores,
        evidence_refs: sortedUnique(pair.evidence_refs),
        confidence_class: confidenceClass(classification.get(pair.pair_id)?.confidence_class),
        analysis_profile: profile,
        upstream_candidate_id: pair.pair_id,
      };
    })
    .sort((a, b) => compareCodePoints(a.relation_id, b.relation_id));
}

/** The candidate fields this translation reads, across all three candidate kinds. */
interface CandidateSource {
  candidate_id: string;
  member_artifact_ids: string[];
  supporting_pair_ids?: string[];
  exact_duplicate_cluster_ids?: string[];
  near_duplicate_candidate_ids?: string[];
  evidence_refs?: string[];
  confidence_class?: string;
  ambiguity_class?: string[];
  ambiguity_flags?: string[];
  cross_root?: boolean;
  cross_archive?: boolean;
}

function candidateClusters(
  entries: readonly CandidateSource[],
  candidateType: CorpusCandidateType,
  identities: ReadonlyMap<string, string>,
  profile: CorpusAnalysisProfileRef,
): CandidateCluster[] {
  return entries
    .map((entry): CandidateCluster => ({
      candidate_id: entry.candidate_id,
      candidate_type: candidateType,
      member_artifact_ids: sortedUnique(
        entry.member_artifact_ids.map((member) => translate(member, identities)),
      ),
      supporting_relation_ids: sortedUnique([
        ...(entry.supporting_pair_ids ?? []),
        ...(entry.exact_duplicate_cluster_ids ?? []),
        ...(entry.near_duplicate_candidate_ids ?? []),
      ]),
      evidence_refs: sortedUnique(entry.evidence_refs ?? []),
      confidence_class: confidenceClass(entry.confidence_class),
      ambiguity_flags: sortedUnique([
        ...(entry.ambiguity_flags ?? []),
        ...(entry.ambiguity_class ?? []),
      ]),
      cross_root: entry.cross_root === true,
      cross_archive: entry.cross_archive === true,
      analysis_profile: profile,
      upstream_candidate_id: entry.candidate_id,
    }))
    .sort((a, b) => compareCodePoints(a.candidate_id, b.candidate_id));
}

/**
 * The deterministic project candidates, as clusters.
 *
 * A run produces two families of project candidate. The *lexical* family groups
 * artifacts by a declared manifest identifier or a container name; the
 * *semantic* family is the fusion pass's. Only the second reached the packet,
 * and readiness is computed over the first — so every readiness record named a
 * subject the packet did not carry, and the consumer's own validator rejects
 * exactly that.
 *
 * Both families are published, each with its own `analysis_profile` so a reader
 * can tell which pass produced a cluster. Nothing here is computed: the lexical
 * candidates are already written to `corpus-candidates.json` and are simply
 * carried across the boundary rather than left behind it.
 */
function lexicalProjectClusters(
  result: CorpusScanResult,
  identities: ReadonlyMap<string, string>,
): CandidateCluster[] {
  const analysis = result.candidates.analysis_profile;
  const profile: CorpusAnalysisProfileRef = {
    profile_id: analysis.project_candidate_method,
    profile_version: analysis.project_candidate_version,
    profile_hash: analysis.candidate_profile_hash,
  };
  return result.candidates.project_candidates
    .map((candidate): CandidateCluster => ({
      candidate_id: candidate.candidate_id,
      candidate_type: "PROJECT_CANDIDATE",
      member_artifact_ids: sortedUnique(
        candidate.member_ids.map((member) => translate(member, identities)),
      ),
      supporting_relation_ids: [],
      evidence_refs: [],
      // Container grouping is deterministic and states no similarity, so it
      // carries no graded confidence. `weak` is the vocabulary's floor, not a
      // judgement that the grouping is doubtful.
      confidence_class: "weak",
      // A key taken from a directory name was not declared by anything, and a
      // reader has to be able to see that.
      ambiguity_flags: candidate.identifier_is_declared ? [] : ["identifier_inferred_from_container"],
      cross_root: candidate.spans_roots,
      cross_archive: false,
      analysis_profile: profile,
      upstream_candidate_id: candidate.candidate_id,
    }))
    .sort((a, b) => compareCodePoints(a.candidate_id, b.candidate_id));
}

/**
 * How the producer's grouped metrics map onto the canonical readiness fields.
 *
 * A table rather than twenty hand-written lookups: the producer groups its
 * counts by the question each answers, the canonical record is flat, and the
 * whole of that translation is worth reading in one place. Flattening loses the
 * grouping and nothing else — the names and the numbers are the same.
 */
type ReadinessCountField = Exclude<
  keyof ReadinessEvidence,
  "readiness_id" | "subject_id" | "profile_id" | "profile_version" | "evidence_refs"
>;

const READINESS_FIELDS: readonly (readonly [
  keyof BodyOfWorkMetrics,
  string,
  ReadinessCountField,
])[] = [
  ["implementation", "source_artifact_count", "source_artifact_count"],
  ["implementation", "manifest_count", "build_manifest_count"],
  ["validation", "structural_test_artifact_count", "test_artifact_count"],
  ["validation", "ci_definition_count", "ci_definition_count"],
  ["delivery", "deployment_definition_count", "deployment_definition_count"],
  ["knowledge", "specification_count", "specification_count"],
  ["knowledge", "documentation_count", "documentation_count"],
  ["knowledge", "plan_count", "plan_count"],
  ["knowledge", "roadmap_count", "roadmap_count"],
  ["work_state", "wip_count", "wip_count"],
  ["work_state", "draft_count", "draft_count"],
  ["work_state", "blocked_count", "blocked_count"],
  ["work_state", "open_task_count", "open_task_count"],
  ["work_state", "completed_task_count", "completed_task_count"],
  ["work_state", "milestone_count", "milestone_count"],
  ["reuse_and_duplication", "exact_duplicate_artifact_count", "exact_duplicate_count"],
  ["reuse_and_duplication", "near_duplicate_candidate_count", "near_duplicate_count"],
  ["reuse_and_duplication", "consolidation_candidate_count", "consolidation_candidate_count"],
  ["uncertainty", "coverage_gap_count", "coverage_gap_count"],
] as const;

function readinessEvidence(
  result: CorpusScanResult,
  subjectByProjectKey: ReadonlyMap<string, string>,
): ReadinessEvidence[] {
  const profile = result.readiness.profile;
  const subject = (projectKey: string, bodyId: string): string => {
    const resolved = subjectByProjectKey.get(projectKey);
    if (resolved === undefined) {
      throw new CorpusIntelligenceError(
        `readiness body ${bodyId} is about project key ${projectKey}, which this run ` +
          "produced no project candidate for; the subject would resolve against nothing",
      );
    }
    return resolved;
  };
  return result.readiness.bodies_of_work
    .map((body): ReadinessEvidence => {
      // A missing group or key means the producer observed nothing of that
      // kind, which is zero rather than unknown: every one of these counts
      // things seen, and seeing none is a real answer.
      const counts = Object.fromEntries(
        READINESS_FIELDS.map(([group, sourceKey, field]) => {
          const value = (body.metrics[group] as Record<string, unknown> | undefined)?.[sourceKey];
          const count =
            typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
          return [field, count];
        }),
      ) as Record<ReadinessCountField, number>;
      return {
        readiness_id: body.body_id,
        // The body is derived from a project candidate, so the readiness
        // subject is that candidate's id — what the counts are about, and what
        // a topology candidate record can attach them to.
        //
        // `origin_ref` is the candidate's *project key*, a declared identifier
        // or container name, and naming that as the subject is what made every
        // readiness record unresolvable: the consumer requires a subject that is
        // a candidate in the packet or an entity an input packet observed, and a
        // project key is neither.
        subject_id: subject(body.origin_ref, body.body_id),
        profile_id: profile.profile_id,
        profile_version: profile.profile_version,
        // Members are artifacts, not evidence records. The producer has no
        // evidence-reference domain for a body of work, and naming its members
        // here would file artifact ids under a field that means something else.
        evidence_refs: [],
        ...counts,
      };
    })
    .sort((a, b) => compareCodePoints(a.readiness_id, b.readiness_id));
}

function reasoningRequests(
  result: CorpusScanResult,
  identities: ReadonlyMap<string, string>,
): { requests: ReasoningCandidateRequest[]; packRefs: string[] } {
  const semantic = result.semantic;
  if (semantic === null) return { requests: [], packRefs: [] };
  const packByCandidate = new Map(
    semantic.evidencePacks.map((pack) => [pack.reasoning_candidate_id, pack.evidence_pack_id]),
  );
  const requests = semantic.reasoningCandidates
    .map((row): ReasoningCandidateRequest => {
      if (!UPSTREAM_REASONING_TYPES.has(row.reasoning_type)) {
        throw new CorpusIntelligenceError(
          `reasoning candidate ${row.reasoning_candidate_id} requests ` +
            `${row.reasoning_type}, which is not a reasoning type the consumer routes to`,
        );
      }
      return {
        reasoning_candidate_id: row.reasoning_candidate_id,
        candidate_id: row.candidate_id,
        recommended_reasoning_type: row.reasoning_type as UpstreamReasoningType,
        reason: row.reason,
        member_artifact_ids: sortedUnique(
          row.member_artifact_ids.map((member) => translate(member, identities)),
        ),
        evidence_pack_ref: packByCandidate.get(row.reasoning_candidate_id) ?? null,
      };
    })
    .sort((a, b) => compareCodePoints(a.reasoning_candidate_id, b.reasoning_candidate_id));
  return { requests, packRefs: sortedUnique(packByCandidate.values()) };
}

// ───────────────────────────── coverage and roots ─────────────────────────────

function coverage(result: CorpusScanResult): CorpusCoverage {
  const scope = result.coverage.corpus;
  const documents = result.coverage.documents;
  const semantics = result.coverage.semantics;
  return {
    root_count_requested: scope.root_count_requested,
    root_count_observed: scope.root_count_observed,
    root_count_failed: scope.root_count_failed,
    artifact_count: result.snapshot.counts.artifact_count,
    archive_count: scope.archive_count,
    archive_member_count: scope.archive_member_count,
    decoder_eligible_count: documents.decoder_eligible_count,
    normalized_document_count: documents.normalized_document_count,
    interpreted_artifact_count: semantics.interpreted_artifact_count,
    unsupported_format_count: documents.unsupported_format_count,
    // What was observed but never hashed. The one uncertainty axis the flat
    // contract carries, and the only honest source for it.
    coverage_gap_count: result.coverage.hashing.unhashed_count,
  };
}

function roots(result: CorpusScanResult): CorpusIntelligenceRootInput[] {
  const packets = new Map(result.rootPackets.map((root) => [root.root_id, root]));
  const observed: CorpusIntelligenceRootInput[] = [];
  for (const root of result.snapshot.roots) {
    // A root that failed or was missing produced no packet. Recording it as a
    // corpus root would bind a reference with nothing behind it.
    if (root.observation_status !== "observed") continue;
    const carried = packets.get(root.root_id);
    if (carried === undefined) {
      throw new CorpusIntelligenceError(
        `root ${root.root_id} observed successfully but produced no repository model packet`,
      );
    }
    const packet = carried.packet;
    if (root.rmp_packet_id && root.rmp_packet_id !== packet.packet_id) {
      throw new CorpusIntelligenceError(
        `root ${root.root_id} snapshot names packet ${root.rmp_packet_id}, ` +
          `but its bundle carries ${packet.packet_id}`,
      );
    }
    if (root.rmp_semantic_hash && root.rmp_semantic_hash !== packet.semantic_hash) {
      throw new CorpusIntelligenceError(
        `root ${root.root_id} snapshot names semantic hash ${root.rmp_semantic_hash}, ` +
          `but its bundle carries ${packet.semantic_hash}`,
      );
    }
    observed.push({
      rootId: root.root_id,
      identityClass: root.root_identity_class as CorpusRootIdentityClass,
      sourceRevision: root.source_revision,
      repositoryId: packet.subject.repository_id,
      packet: {
        packet_id: packet.packet_id,
        packet_type: packet.packet_type,
        packet_version: packet.packet_version,
        semantic_hash: packet.semantic_hash,
        ...(packet.artifact_hash !== undefined ? { artifact_hash: packet.artifact_hash } : {}),
        validation: { status: packet.validation.status },
        subject: { repository_id: packet.subject.repository_id },
        source_snapshot: { revision: packet.source_snapshot.revision },
        payload: {
          artifacts: packet.payload.artifacts.map((artifact) => ({
            artifact_id: artifact.artifact_id,
            source_path: artifact.source_path,
            content_hash: artifact.content_hash,
          })),
        },
      },
    });
  }
  if (observed.length === 0) {
    throw new CorpusIntelligenceError("no root in this run observed successfully");
  }
  return observed;
}

// ───────────────────────────── entry point ─────────────────────────────

export interface CorpusIntelligenceInputOptions {
  /** Version of the producer emitting this packet. */
  producerVersion: string;
  createdAt: string;
}

/**
 * Translate one completed corpus run into the packet builder's input.
 *
 * Reads only what the run already produced. Nothing here re-opens a disk,
 * recomputes an analysis, or supplies a value the run did not carry.
 */
export function corpusIntelligenceInput(
  result: CorpusScanResult,
  options: CorpusIntelligenceInputOptions,
): BuildCorpusIntelligenceInput {
  const identities = identityTranslation(result);
  const semantic = result.semantic;
  // The profile the analysis actually ran under. The candidate documents all
  // carry the same one, because one run has one semantic profile.
  const profile: CorpusAnalysisProfileRef =
    semantic === null
      ? {
          profile_id: result.candidates.analysis_profile.corpus_profile_id,
          profile_version: result.candidates.analysis_profile.corpus_profile_version,
          profile_hash: result.candidates.analysis_profile.candidate_profile_hash,
        }
      : {
          profile_id: semantic.profile.semantic_analysis_profile_id,
          profile_version: semantic.profile.semantic_analysis_profile_version,
          profile_hash: semantic.profile.semantic_fusion_profile_hash,
        };

  // A readiness body names the project *key* it was derived from; the packet
  // resolves subjects by candidate id.
  const subjectByProjectKey = new Map(
    result.candidates.project_candidates.map((candidate) => [
      candidate.project_key,
      candidate.candidate_id,
    ]),
  );
  const reasoning = reasoningRequests(result, identities);
  const payload: CorpusIntelligencePayload = {
    document_work_signals: result.documentWorkSignals.records
      .map(workSignal)
      .sort((a, b) => compareCodePoints(a.signal_id, b.signal_id)),
    exact_duplicate_relations: duplicateRelations(result, identities),
    semantic_pair_relations: pairRelations(result, identities, profile),
    topic_candidates:
      semantic === null
        ? []
        : candidateClusters(semantic.topics.candidates, "TOPIC_CANDIDATE", identities, profile),
    project_candidates: [
      ...lexicalProjectClusters(result, identities),
      ...(semantic === null
        ? []
        : candidateClusters(semantic.projects.candidates, "PROJECT_CANDIDATE", identities, profile)),
    ].sort((a, b) => compareCodePoints(a.candidate_id, b.candidate_id)),
    consolidation_candidates:
      semantic === null
        ? []
        : candidateClusters(
            semantic.consolidations.candidates,
            "CONSOLIDATION_CANDIDATE",
            identities,
            profile,
          ),
    readiness_evidence: readinessEvidence(result, subjectByProjectKey),
    reasoning_candidates: reasoning.requests,
    reasoning_evidence_pack_refs: reasoning.packRefs,
  };

  return {
    corpusId: result.snapshot.corpus_id,
    corpusSourceSnapshotId: result.snapshot.corpus_source_snapshot_id,
    corpusAnalysisId: result.snapshot.analysis.corpus_analysis_id,
    roots: roots(result),
    coverage: coverage(result),
    payload,
    producerVersion: options.producerVersion,
    profile: {
      id: profile.profile_id,
      version: profile.profile_version,
      hash: profile.profile_hash,
    },
    createdAt: options.createdAt,
  };
}
