// corpus_semantic_run.ts — the semantic pass, assembled into its emitted documents.
//
// The five modules below it each do one thing: build feature views, score pairs,
// fuse pairs into candidates, route candidates to future reasoning, and pack the
// evidence a reasoner would need. This file runs them in order and turns the
// result into the six documents an operator gets, plus the summary that goes into
// the corpus index.
//
// It is deliberately thin. Every decision lives in the module that owns it, so
// that reading this file tells you the *shape* of the pass and nothing about its
// policy — and so that changing a policy never means editing the orchestrator.
//
// One boundary is enforced here rather than delegated: the Repository Model
// Packet is not an input and not an output. Enabling or disabling this entire
// pass, embeddings included, cannot change a packet id or a semantic hash,
// because nothing in this file writes to one.
import { canonicalCorpusJson } from "./corpus_analysis";
import { compareCodePoints } from "./ordering";
import {
  CONSOLIDATION_CANDIDATE_SCHEMA,
  PROJECT_CANDIDATE_SCHEMA,
  SEMANTIC_RELATIONS_SCHEMA,
  TOPIC_CANDIDATE_SCHEMA,
  buildConsolidationCandidates,
  buildProjectCandidates,
  buildTopicCandidates,
  classifyPair,
  fusionProfileHash,
  FUSION_PROFILE_ID,
  FUSION_PROFILE_VERSION,
} from "./corpus_fusion";
import type {
  ConsolidationCandidate,
  FusionOptions,
  PairClassification,
  ProjectCandidate,
  TopicCandidate,
} from "./corpus_fusion";
import {
  PAIR_SIGNAL_PROFILE_ID,
  PAIR_SIGNAL_PROFILE_VERSION,
  buildSemanticPairs,
  pairSignalProfileHash,
} from "./corpus_pairs";
import type { EmbeddingPairScore, PairGenerationDiagnostic, SemanticPair } from "./corpus_pairs";
import {
  KEYPHRASE_PROFILE_ID,
  KEYPHRASE_PROFILE_VERSION,
  buildFeatureViews,
  keyphraseProfileHash,
} from "./corpus_semantics";
import type { ArtifactFeatureView, SemanticArtifactInput } from "./corpus_semantics";
import {
  REASONING_ROUTING_PROFILE_ID,
  REASONING_ROUTING_PROFILE_VERSION,
  buildReasoningEvidencePacks,
  reasoningEligible,
  reasoningRoutingProfileHash,
  renderJsonl,
  routeReasoningCandidates,
} from "./corpus_reasoning";
import type {
  PackAssertion,
  ReasoningCandidate,
  ReasoningEvidencePack,
  ReasoningPackBudget,
} from "./corpus_reasoning";
import { disabledEmbeddingReport } from "./corpus_embeddings";
import type { EmbeddingRunReport } from "./corpus_embeddings";

export const SEMANTIC_ANALYSIS_PROFILE_ID = "corpus-semantic-analysis/v1";
export const SEMANTIC_ANALYSIS_PROFILE_VERSION = "1.0.0";

/** Every profile that decides what this pass emits, recorded in one place. */
export interface SemanticAnalysisProfile {
  semantic_analysis_profile_id: string;
  semantic_analysis_profile_version: string;
  keyphrase_profile: string;
  keyphrase_profile_hash: string;
  pair_signal_profile: string;
  pair_signal_profile_hash: string;
  semantic_fusion_profile: string;
  semantic_fusion_profile_hash: string;
  reasoning_routing_profile: string;
  reasoning_routing_profile_hash: string;
  embedding_enabled: boolean;
  embedding_provider_when_enabled: string | null;
  embedding_model_when_enabled: string | null;
  embedding_model_revision_when_available: string | null;
}

export interface SemanticRelationsDocument {
  schema: string;
  corpus_source_snapshot_id: string;
  corpus_analysis_id: string;
  analysis_profile: SemanticAnalysisProfile;
  generation: {
    artifact_count: number;
    generated_pair_count: number;
    scored_pair_count: number;
    exhaustive_pair_count: number;
    skipped_high_frequency_terms: number;
    posting_ceiling: number;
  };
  pairs: SemanticPair[];
  classifications: PairClassification[];
  diagnostics: PairGenerationDiagnostic[];
  /** Restated so a consumer reading only this file sees the epistemic classes. */
  relation_statement: string;
}

export const RELATION_STATEMENT =
  "Every relation in this document is a candidate signal about a pair of artifacts. Exact "
  + "duplication is a fact about bytes. Lexical overlap, declared-identifier matches, explicit "
  + "references and embedding similarity are evidence, not conclusions: none of them establishes "
  + "that two artifacts share a topic, a project, an author's intent, or a fate.";

export interface TopicCandidatesDocument {
  schema: string;
  corpus_source_snapshot_id: string;
  corpus_analysis_id: string;
  analysis_profile: SemanticAnalysisProfile;
  candidates: TopicCandidate[];
  candidate_statement: string;
}

export interface ProjectCandidatesDocument {
  schema: string;
  corpus_source_snapshot_id: string;
  corpus_analysis_id: string;
  analysis_profile: SemanticAnalysisProfile;
  candidates: ProjectCandidate[];
  candidate_statement: string;
}

export interface ConsolidationCandidatesDocument {
  schema: string;
  corpus_source_snapshot_id: string;
  corpus_analysis_id: string;
  analysis_profile: SemanticAnalysisProfile;
  candidates: ConsolidationCandidate[];
  candidate_statement: string;
}

export const TOPIC_STATEMENT =
  "A topic candidate means the members show evidence of discussing related subject matter. It "
  + "does not mean they belong to the same project, that any of them is current, or that any of "
  + "them should be changed.";

export const PROJECT_STATEMENT =
  "A project candidate means there is evidence these artifacts may belong to one body of work. "
  + "The evidence is named per candidate. No name is synthesized for the body of work, and no "
  + "member is identified as canonical, current, or superseded except where a source said so.";

export const CONSOLIDATION_STATEMENT =
  "A consolidation candidate means these artifacts are worth inspecting together. It is not an "
  + "instruction to merge, delete, move, or keep any of them, and this document deliberately "
  + "contains no field that could be read as one.";

export interface SemanticAnalysisSummary {
  semantic_pair_count: number;
  topic_candidate_count: number;
  project_candidate_count: number;
  consolidation_candidate_count: number;
  reasoning_eligible_count: number;
  embedding_eligible_artifact_count: number;
  embedded_artifact_count: number;
}

export interface SemanticAnalysisResult {
  profile: SemanticAnalysisProfile;
  views: ArtifactFeatureView[];
  relations: SemanticRelationsDocument;
  topics: TopicCandidatesDocument;
  projects: ProjectCandidatesDocument;
  consolidations: ConsolidationCandidatesDocument;
  reasoningCandidates: ReasoningCandidate[];
  evidencePacks: ReasoningEvidencePack[];
  summary: SemanticAnalysisSummary;
  embeddingReport: EmbeddingRunReport;
  /** Per-artifact candidate ids, for the corpus index. */
  candidateIdsByArtifact: Map<string, {
    topic_candidate_ids: string[];
    project_candidate_ids: string[];
    consolidation_candidate_ids: string[];
    reasoning_candidate_ids: string[];
  }>;
}

export interface SemanticAnalysisInput {
  corpusSourceSnapshotId: string;
  corpusAnalysisId: string;
  artifacts: readonly SemanticArtifactInput[];
  nearDuplicatePairs?: readonly { artifact_a_id: string; artifact_b_id: string; score: number }[];
  embeddingPairs?: readonly EmbeddingPairScore[];
  embeddingReport?: EmbeddingRunReport;
  assertionsByArtifact?: ReadonlyMap<string, readonly PackAssertion[]>;
  packBudget?: Partial<ReasoningPackBudget>;
  fusion?: FusionOptions;
}

function profileOf(input: SemanticAnalysisInput, embedding: EmbeddingRunReport): SemanticAnalysisProfile {
  return {
    semantic_analysis_profile_id: SEMANTIC_ANALYSIS_PROFILE_ID,
    semantic_analysis_profile_version: SEMANTIC_ANALYSIS_PROFILE_VERSION,
    keyphrase_profile: `${KEYPHRASE_PROFILE_ID}@${KEYPHRASE_PROFILE_VERSION}`,
    keyphrase_profile_hash: keyphraseProfileHash(),
    pair_signal_profile: `${PAIR_SIGNAL_PROFILE_ID}@${PAIR_SIGNAL_PROFILE_VERSION}`,
    pair_signal_profile_hash: pairSignalProfileHash(),
    semantic_fusion_profile: `${FUSION_PROFILE_ID}@${FUSION_PROFILE_VERSION}`,
    semantic_fusion_profile_hash: fusionProfileHash(input.fusion ?? {}),
    reasoning_routing_profile:
      `${REASONING_ROUTING_PROFILE_ID}@${REASONING_ROUTING_PROFILE_VERSION}`,
    reasoning_routing_profile_hash: reasoningRoutingProfileHash(),
    embedding_enabled: embedding.enabled,
    embedding_provider_when_enabled: embedding.provider,
    embedding_model_when_enabled: embedding.model_id,
    embedding_model_revision_when_available: embedding.model_revision,
  };
}

/**
 * Run the whole semantic pass.
 *
 * Order is fixed and each stage reads only what the one before it produced, so a
 * reader can follow one artifact from bytes to reasoning queue without leaving
 * this call.
 */
export function runSemanticAnalysis(input: SemanticAnalysisInput): SemanticAnalysisResult {
  const embeddingReport = input.embeddingReport ?? disabledEmbeddingReport();
  const profile = profileOf(input, embeddingReport);

  const views = buildFeatureViews(input.artifacts);
  const pairResult = buildSemanticPairs({
    views,
    ...(input.nearDuplicatePairs !== undefined ? { nearDuplicatePairs: input.nearDuplicatePairs } : {}),
    ...(input.embeddingPairs !== undefined ? { embeddingPairs: input.embeddingPairs } : {}),
  });
  const fusionOptions = input.fusion ?? {};
  const candidateInput = { views, pairs: pairResult.pairs, options: fusionOptions };

  const topics = buildTopicCandidates(candidateInput);
  const projects = buildProjectCandidates(candidateInput);
  const consolidations = buildConsolidationCandidates({
    ...candidateInput,
    projectCandidates: projects,
  });

  const reasoningCandidates = routeReasoningCandidates({
    topicCandidates: topics,
    projectCandidates: projects,
    consolidationCandidates: consolidations,
  });
  const evidencePacks = buildReasoningEvidencePacks({
    reasoningCandidates,
    views,
    pairs: pairResult.pairs,
    assertionsByArtifact: input.assertionsByArtifact ?? new Map(),
    ...(input.packBudget !== undefined ? { budget: input.packBudget } : {}),
  });

  const candidateIdsByArtifact = new Map<string, {
    topic_candidate_ids: string[];
    project_candidate_ids: string[];
    consolidation_candidate_ids: string[];
    reasoning_candidate_ids: string[];
  }>();
  const slot = (artifactId: string) => {
    const existing = candidateIdsByArtifact.get(artifactId) ?? {
      topic_candidate_ids: [], project_candidate_ids: [],
      consolidation_candidate_ids: [], reasoning_candidate_ids: [],
    };
    candidateIdsByArtifact.set(artifactId, existing);
    return existing;
  };
  for (const view of views) slot(view.artifact_id);
  for (const candidate of topics) {
    for (const id of candidate.member_artifact_ids) slot(id).topic_candidate_ids.push(candidate.candidate_id);
  }
  for (const candidate of projects) {
    for (const id of candidate.member_artifact_ids) slot(id).project_candidate_ids.push(candidate.candidate_id);
  }
  for (const candidate of consolidations) {
    for (const id of candidate.member_artifact_ids) slot(id).consolidation_candidate_ids.push(candidate.candidate_id);
  }
  for (const row of reasoningCandidates) {
    if (row.reasoning_type === "NONE") continue;
    for (const id of row.member_artifact_ids) slot(id).reasoning_candidate_ids.push(row.reasoning_candidate_id);
  }
  for (const entry of candidateIdsByArtifact.values()) {
    entry.topic_candidate_ids.sort(compareCodePoints);
    entry.project_candidate_ids.sort(compareCodePoints);
    entry.consolidation_candidate_ids.sort(compareCodePoints);
    entry.reasoning_candidate_ids.sort(compareCodePoints);
  }

  const header = { corpus_source_snapshot_id: input.corpusSourceSnapshotId,
    corpus_analysis_id: input.corpusAnalysisId, analysis_profile: profile };

  return {
    profile,
    views,
    relations: {
      schema: SEMANTIC_RELATIONS_SCHEMA,
      ...header,
      generation: pairResult.generation,
      pairs: pairResult.pairs,
      classifications: pairResult.pairs.map((pair) => classifyPair(pair, fusionOptions)),
      diagnostics: pairResult.diagnostics,
      relation_statement: RELATION_STATEMENT,
    },
    topics: {
      schema: TOPIC_CANDIDATE_SCHEMA, ...header,
      candidates: topics, candidate_statement: TOPIC_STATEMENT,
    },
    projects: {
      schema: PROJECT_CANDIDATE_SCHEMA, ...header,
      candidates: projects, candidate_statement: PROJECT_STATEMENT,
    },
    consolidations: {
      schema: CONSOLIDATION_CANDIDATE_SCHEMA, ...header,
      candidates: consolidations, candidate_statement: CONSOLIDATION_STATEMENT,
    },
    reasoningCandidates,
    evidencePacks,
    summary: {
      semantic_pair_count: pairResult.pairs.length,
      topic_candidate_count: topics.length,
      project_candidate_count: projects.length,
      consolidation_candidate_count: consolidations.length,
      reasoning_eligible_count: reasoningEligible(reasoningCandidates).length,
      embedding_eligible_artifact_count: embeddingReport.eligible_artifact_count,
      embedded_artifact_count: embeddingReport.embedded_artifact_count,
    },
    embeddingReport,
    candidateIdsByArtifact,
  };
}

/** Canonical bytes of each emitted document. */
export function renderSemanticRelations(document: SemanticRelationsDocument): string {
  return `${canonicalCorpusJson(document)}\n`;
}
export function renderTopicCandidates(document: TopicCandidatesDocument): string {
  return `${canonicalCorpusJson(document)}\n`;
}
export function renderProjectCandidates(document: ProjectCandidatesDocument): string {
  return `${canonicalCorpusJson(document)}\n`;
}
export function renderConsolidationCandidates(document: ConsolidationCandidatesDocument): string {
  return `${canonicalCorpusJson(document)}\n`;
}
export function renderReasoningCandidates(rows: readonly ReasoningCandidate[]): string {
  return renderJsonl(rows);
}
export function renderReasoningEvidencePacks(packs: readonly ReasoningEvidencePack[]): string {
  return renderJsonl(packs);
}
