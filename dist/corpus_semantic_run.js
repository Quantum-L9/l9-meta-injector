"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONSOLIDATION_STATEMENT = exports.PROJECT_STATEMENT = exports.TOPIC_STATEMENT = exports.RELATION_STATEMENT = exports.SEMANTIC_ANALYSIS_PROFILE_VERSION = exports.SEMANTIC_ANALYSIS_PROFILE_ID = void 0;
exports.runSemanticAnalysis = runSemanticAnalysis;
exports.renderSemanticRelations = renderSemanticRelations;
exports.renderTopicCandidates = renderTopicCandidates;
exports.renderProjectCandidates = renderProjectCandidates;
exports.renderConsolidationCandidates = renderConsolidationCandidates;
exports.renderReasoningCandidates = renderReasoningCandidates;
exports.renderReasoningEvidencePacks = renderReasoningEvidencePacks;
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
const corpus_analysis_1 = require("./corpus_analysis");
const ordering_1 = require("./ordering");
const corpus_fusion_1 = require("./corpus_fusion");
const corpus_pairs_1 = require("./corpus_pairs");
const corpus_semantics_1 = require("./corpus_semantics");
const corpus_reasoning_1 = require("./corpus_reasoning");
const corpus_embeddings_1 = require("./corpus_embeddings");
exports.SEMANTIC_ANALYSIS_PROFILE_ID = "corpus-semantic-analysis/v1";
exports.SEMANTIC_ANALYSIS_PROFILE_VERSION = "1.0.0";
exports.RELATION_STATEMENT = "Every relation in this document is a candidate signal about a pair of artifacts. Exact "
    + "duplication is a fact about bytes. Lexical overlap, declared-identifier matches, explicit "
    + "references and embedding similarity are evidence, not conclusions: none of them establishes "
    + "that two artifacts share a topic, a project, an author's intent, or a fate.";
exports.TOPIC_STATEMENT = "A topic candidate means the members show evidence of discussing related subject matter. It "
    + "does not mean they belong to the same project, that any of them is current, or that any of "
    + "them should be changed.";
exports.PROJECT_STATEMENT = "A project candidate means there is evidence these artifacts may belong to one body of work. "
    + "The evidence is named per candidate. No name is synthesized for the body of work, and no "
    + "member is identified as canonical, current, or superseded except where a source said so.";
exports.CONSOLIDATION_STATEMENT = "A consolidation candidate means these artifacts are worth inspecting together. It is not an "
    + "instruction to merge, delete, move, or keep any of them, and this document deliberately "
    + "contains no field that could be read as one.";
function profileOf(input, embedding) {
    return {
        semantic_analysis_profile_id: exports.SEMANTIC_ANALYSIS_PROFILE_ID,
        semantic_analysis_profile_version: exports.SEMANTIC_ANALYSIS_PROFILE_VERSION,
        keyphrase_profile: `${corpus_semantics_1.KEYPHRASE_PROFILE_ID}@${corpus_semantics_1.KEYPHRASE_PROFILE_VERSION}`,
        keyphrase_profile_hash: (0, corpus_semantics_1.keyphraseProfileHash)(),
        pair_signal_profile: `${corpus_pairs_1.PAIR_SIGNAL_PROFILE_ID}@${corpus_pairs_1.PAIR_SIGNAL_PROFILE_VERSION}`,
        pair_signal_profile_hash: (0, corpus_pairs_1.pairSignalProfileHash)(),
        semantic_fusion_profile: `${corpus_fusion_1.FUSION_PROFILE_ID}@${corpus_fusion_1.FUSION_PROFILE_VERSION}`,
        semantic_fusion_profile_hash: (0, corpus_fusion_1.fusionProfileHash)(input.fusion ?? {}),
        reasoning_routing_profile: `${corpus_reasoning_1.REASONING_ROUTING_PROFILE_ID}@${corpus_reasoning_1.REASONING_ROUTING_PROFILE_VERSION}`,
        reasoning_routing_profile_hash: (0, corpus_reasoning_1.reasoningRoutingProfileHash)(),
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
function runSemanticAnalysis(input) {
    const embeddingReport = input.embeddingReport ?? (0, corpus_embeddings_1.disabledEmbeddingReport)();
    const profile = profileOf(input, embeddingReport);
    const views = (0, corpus_semantics_1.buildFeatureViews)(input.artifacts);
    const pairResult = (0, corpus_pairs_1.buildSemanticPairs)({
        views,
        ...(input.nearDuplicatePairs !== undefined ? { nearDuplicatePairs: input.nearDuplicatePairs } : {}),
        ...(input.embeddingPairs !== undefined ? { embeddingPairs: input.embeddingPairs } : {}),
    });
    const fusionOptions = input.fusion ?? {};
    const candidateInput = { views, pairs: pairResult.pairs, options: fusionOptions };
    const topics = (0, corpus_fusion_1.buildTopicCandidates)(candidateInput);
    const projects = (0, corpus_fusion_1.buildProjectCandidates)(candidateInput);
    const consolidations = (0, corpus_fusion_1.buildConsolidationCandidates)({
        ...candidateInput,
        projectCandidates: projects,
    });
    const reasoningCandidates = (0, corpus_reasoning_1.routeReasoningCandidates)({
        topicCandidates: topics,
        projectCandidates: projects,
        consolidationCandidates: consolidations,
    });
    const evidencePacks = (0, corpus_reasoning_1.buildReasoningEvidencePacks)({
        reasoningCandidates,
        views,
        pairs: pairResult.pairs,
        assertionsByArtifact: input.assertionsByArtifact ?? new Map(),
        ...(input.packBudget !== undefined ? { budget: input.packBudget } : {}),
    });
    const candidateIdsByArtifact = new Map();
    const slot = (artifactId) => {
        const existing = candidateIdsByArtifact.get(artifactId) ?? {
            topic_candidate_ids: [], project_candidate_ids: [],
            consolidation_candidate_ids: [], reasoning_candidate_ids: [],
        };
        candidateIdsByArtifact.set(artifactId, existing);
        return existing;
    };
    for (const view of views)
        slot(view.artifact_id);
    for (const candidate of topics) {
        for (const id of candidate.member_artifact_ids)
            slot(id).topic_candidate_ids.push(candidate.candidate_id);
    }
    for (const candidate of projects) {
        for (const id of candidate.member_artifact_ids)
            slot(id).project_candidate_ids.push(candidate.candidate_id);
    }
    for (const candidate of consolidations) {
        for (const id of candidate.member_artifact_ids)
            slot(id).consolidation_candidate_ids.push(candidate.candidate_id);
    }
    for (const row of reasoningCandidates) {
        if (row.reasoning_type === "NONE")
            continue;
        for (const id of row.member_artifact_ids)
            slot(id).reasoning_candidate_ids.push(row.reasoning_candidate_id);
    }
    for (const entry of candidateIdsByArtifact.values()) {
        entry.topic_candidate_ids.sort(ordering_1.compareCodePoints);
        entry.project_candidate_ids.sort(ordering_1.compareCodePoints);
        entry.consolidation_candidate_ids.sort(ordering_1.compareCodePoints);
        entry.reasoning_candidate_ids.sort(ordering_1.compareCodePoints);
    }
    const header = { corpus_source_snapshot_id: input.corpusSourceSnapshotId,
        corpus_analysis_id: input.corpusAnalysisId, analysis_profile: profile };
    return {
        profile,
        views,
        relations: {
            schema: corpus_fusion_1.SEMANTIC_RELATIONS_SCHEMA,
            ...header,
            generation: pairResult.generation,
            pairs: pairResult.pairs,
            classifications: pairResult.pairs.map((pair) => (0, corpus_fusion_1.classifyPair)(pair, fusionOptions)),
            diagnostics: pairResult.diagnostics,
            relation_statement: exports.RELATION_STATEMENT,
        },
        topics: {
            schema: corpus_fusion_1.TOPIC_CANDIDATE_SCHEMA, ...header,
            candidates: topics, candidate_statement: exports.TOPIC_STATEMENT,
        },
        projects: {
            schema: corpus_fusion_1.PROJECT_CANDIDATE_SCHEMA, ...header,
            candidates: projects, candidate_statement: exports.PROJECT_STATEMENT,
        },
        consolidations: {
            schema: corpus_fusion_1.CONSOLIDATION_CANDIDATE_SCHEMA, ...header,
            candidates: consolidations, candidate_statement: exports.CONSOLIDATION_STATEMENT,
        },
        reasoningCandidates,
        evidencePacks,
        summary: {
            semantic_pair_count: pairResult.pairs.length,
            topic_candidate_count: topics.length,
            project_candidate_count: projects.length,
            consolidation_candidate_count: consolidations.length,
            reasoning_eligible_count: (0, corpus_reasoning_1.reasoningEligible)(reasoningCandidates).length,
            embedding_eligible_artifact_count: embeddingReport.eligible_artifact_count,
            embedded_artifact_count: embeddingReport.embedded_artifact_count,
        },
        embeddingReport,
        candidateIdsByArtifact,
    };
}
/** Canonical bytes of each emitted document. */
function renderSemanticRelations(document) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(document)}\n`;
}
function renderTopicCandidates(document) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(document)}\n`;
}
function renderProjectCandidates(document) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(document)}\n`;
}
function renderConsolidationCandidates(document) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(document)}\n`;
}
function renderReasoningCandidates(rows) {
    return (0, corpus_reasoning_1.renderJsonl)(rows);
}
function renderReasoningEvidencePacks(packs) {
    return (0, corpus_reasoning_1.renderJsonl)(packs);
}
//# sourceMappingURL=corpus_semantic_run.js.map