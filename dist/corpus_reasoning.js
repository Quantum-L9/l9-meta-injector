"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PACK_SELECTION_PRIORITY = exports.DEFAULT_REASONING_PACK_BUDGET = exports.REASONING_GROUNDING_REFS = exports.REASONING_TYPES = exports.REASONING_EVIDENCE_PACK_SCHEMA = exports.REASONING_CANDIDATE_SCHEMA = exports.REASONING_ROUTING_PROFILE_VERSION = exports.REASONING_ROUTING_PROFILE_ID = void 0;
exports.reasoningRoutingProfileHash = reasoningRoutingProfileHash;
exports.routeReasoningCandidates = routeReasoningCandidates;
exports.reasoningEligible = reasoningEligible;
exports.buildReasoningEvidencePacks = buildReasoningEvidencePacks;
exports.renderJsonl = renderJsonl;
// corpus_reasoning.ts — which candidates would repay an LLM's attention, and with what.
//
// This module routes future reasoning. It does not reason, and it never calls a
// model. Its whole job is to answer, deterministically, a question that is
// otherwise answered by spending money: *given this candidate, is there anything
// here a language model could settle that the evidence has not already settled?*
//
// The negative answers matter more than the positive ones, because they are where
// a reasoning budget is actually saved:
//
//   - Exact duplicates are already decided. Two byte-identical files need no
//     adjudication; somebody copied a file. Sending that to a model buys nothing.
//   - A weak single-signal candidate has nothing to adjudicate *between*. One
//     lexical metric is not a disagreement, it is a coincidence waiting to be
//     checked, and the check is cheaper than the model.
//   - An embedding-only candidate is a model's opinion already. Asking a second
//     model to rule on the first model's opinion adds a step, not evidence.
//
// The positive answers are all shapes of *ambiguity in the source material*: two
// documents that declare conflicting statuses, a supersession that points both
// ways, several versions of one thing across two archives. Those are questions
// about what a person meant, which is the one thing the deterministic layer
// genuinely cannot settle.
//
// "Reasoning eligible" is therefore not a compliment. It does not mean a candidate
// is important, correct, or worth building. It means the evidence is ambiguous in
// a way that reading might resolve.
const ordering_1 = require("./ordering");
const repository_model_1 = require("./repository_model");
const corpus_analysis_1 = require("./corpus_analysis");
const corpus_fusion_1 = require("./corpus_fusion");
exports.REASONING_ROUTING_PROFILE_ID = "reasoning-routing/v1";
exports.REASONING_ROUTING_PROFILE_VERSION = "1.0.0";
exports.REASONING_CANDIDATE_SCHEMA = "l9.reasoning-candidate/v1";
exports.REASONING_EVIDENCE_PACK_SCHEMA = "l9.reasoning-evidence-pack/v1";
exports.REASONING_TYPES = [
    "NONE",
    "SAME_BODY_OF_WORK_ADJUDICATION",
    "PROJECT_IDENTITY_ADJUDICATION",
    "VERSION_EVOLUTION_ANALYSIS",
    "CONSOLIDATION_ANALYSIS",
    "SUPERSESSION_ANALYSIS",
    "CONFLICT_RESOLUTION_ANALYSIS",
];
/**
 * Precedence when a candidate matches several triggers.
 *
 * Ordered by how specific the question is, most specific first. A candidate whose
 * members disagree about their own status is asking a narrower question than one
 * that merely shares vocabulary, and the narrower question is the one worth
 * naming — routing it as the broader one would send a reasoner looking for the
 * wrong thing.
 */
const TYPE_PRECEDENCE = [
    "CONFLICT_RESOLUTION_ANALYSIS",
    "SUPERSESSION_ANALYSIS",
    "VERSION_EVOLUTION_ANALYSIS",
    "PROJECT_IDENTITY_ADJUDICATION",
    "CONSOLIDATION_ANALYSIS",
    "SAME_BODY_OF_WORK_ADJUDICATION",
];
function reasoningRoutingProfileHash() {
    return (0, repository_model_1.stableId)("reasoning-routing-profile", {
        precedence: TYPE_PRECEDENCE,
        profile_id: exports.REASONING_ROUTING_PROFILE_ID,
        profile_version: exports.REASONING_ROUTING_PROFILE_VERSION,
        types: exports.REASONING_TYPES,
    });
}
/** Files a routed candidate points at for its grounded measurements. */
exports.REASONING_GROUNDING_REFS = {
    readiness_evidence_ref: "readiness-evidence.json",
    corpus_coverage_ref: "corpus-coverage.json",
    corpus_snapshot_ref: "corpus-snapshot.json",
};
function candidateId(candidate) {
    return candidate.candidate_id;
}
/** Decide the reasoning type for one topic candidate. */
function routeTopic(candidate) {
    if (candidate.confidence_class === "weak") {
        return {
            type: "NONE",
            reason: "weak topic candidate: no corroborated evidence to adjudicate",
        };
    }
    const independentFamilies = ["lexical", "declared_identity", "graph", "semantic_model"]
        .filter((family) => candidate.evidence_family_counts[family] > 0).length;
    if (candidate.confidence_class === "strong" && independentFamilies >= 2) {
        return {
            type: "SAME_BODY_OF_WORK_ADJUDICATION",
            reason: `strong topic candidate with ${independentFamilies} independent evidence families: `
                + "whether these documents describe one body of work is not decidable from overlap alone",
        };
    }
    return {
        type: "NONE",
        reason: "moderate topic candidate: shared subject matter is already the whole of the claim",
    };
}
/** Decide the reasoning type for one project candidate. */
function routeProject(candidate) {
    if (candidate.ambiguity_class.includes(corpus_fusion_1.AMBIGUITY_CONFLICTING_STATUS)) {
        return {
            type: "CONFLICT_RESOLUTION_ANALYSIS",
            reason: `members declare conflicting statuses (${candidate.work_statuses.join(", ")}); `
                + "the source says two things and does not say which is current",
        };
    }
    if (candidate.ambiguity_class.includes(corpus_fusion_1.AMBIGUITY_AMBIGUOUS_SUPERSESSION)
        && candidate.ambiguity_class.includes(corpus_fusion_1.AMBIGUITY_MIXED_VERSION_LINEAGE)) {
        return {
            type: "SUPERSESSION_ANALYSIS",
            reason: "several supersession declarations over a mixed version lineage: direction is ambiguous",
        };
    }
    if (candidate.cross_archive && candidate.duplicate_cluster_count > 0) {
        return {
            type: "VERSION_EVOLUTION_ANALYSIS",
            reason: "the same body of work appears in more than one archive with duplicate clusters: "
                + "which copy is the later one is not decidable from content alone",
        };
    }
    if (candidate.ambiguity_class.includes(corpus_fusion_1.AMBIGUITY_MULTIPLE_PROJECT_NAMES)) {
        return {
            type: "PROJECT_IDENTITY_ADJUDICATION",
            reason: `members declare ${candidate.declared_identifiers.length} different project identifiers: `
                + "whether that is one project renamed or two projects is a question about intent",
        };
    }
    if (candidate.confidence_class === "weak") {
        return { type: "NONE", reason: "weak project candidate: nothing corroborated to adjudicate" };
    }
    return {
        type: "NONE",
        reason: "project candidate carries declared identity or an explicit graph edge; nothing is ambiguous",
    };
}
/** Decide the reasoning type for one consolidation candidate. */
function routeConsolidation(candidate) {
    if (candidate.unique_content_variant_count <= 1) {
        return {
            type: "NONE",
            reason: "every member is byte-identical: exact duplicate cleanup needs no semantic adjudication",
        };
    }
    if (candidate.ambiguity_flags.includes(corpus_fusion_1.AMBIGUITY_CONFLICTING_STATUS)) {
        return {
            type: "CONFLICT_RESOLUTION_ANALYSIS",
            reason: "members carry several content variants and declare conflicting statuses",
        };
    }
    if (candidate.supersession_assertion_ids.length > 0) {
        return {
            type: "SUPERSESSION_ANALYSIS",
            reason: `${candidate.supersession_assertion_ids.length} supersession declaration(s) across `
                + `${candidate.unique_content_variant_count} content variants`,
        };
    }
    return {
        type: "CONSOLIDATION_ANALYSIS",
        reason: `${candidate.unique_content_variant_count} unique content variants: what each copy holds `
            + "that the others do not is not decidable from hashes",
    };
}
/**
 * Route every candidate, including the ones that go nowhere.
 *
 * `NONE` rows are emitted rather than dropped. A queue that silently omitted them
 * could not be checked for the property that matters most — that exact duplicates
 * and embedding-only candidates never reach a reasoner.
 */
function routeReasoningCandidates(input) {
    const profileHash = reasoningRoutingProfileHash();
    const routingProfile = {
        reasoning_routing_profile_id: exports.REASONING_ROUTING_PROFILE_ID,
        reasoning_routing_profile_version: exports.REASONING_ROUTING_PROFILE_VERSION,
        reasoning_routing_profile_hash: profileHash,
    };
    const rows = [];
    const push = (candidate, routed) => {
        rows.push({
            schema: exports.REASONING_CANDIDATE_SCHEMA,
            reasoning_candidate_id: (0, repository_model_1.stableId)("l9.reasoning-candidate/v1", {
                candidate_id: candidateId(candidate),
                reasoning_type: routed.type,
                routing_profile: profileHash,
            }),
            candidate_id: candidateId(candidate),
            candidate_type: candidate.candidate_type,
            reasoning_type: routed.type,
            reason: routed.reason,
            member_artifact_ids: [...candidate.member_artifact_ids].sort(ordering_1.compareCodePoints),
            grounding_refs: { ...exports.REASONING_GROUNDING_REFS },
            routing_profile: routingProfile,
        });
    };
    for (const candidate of input.topicCandidates)
        push(candidate, routeTopic(candidate));
    for (const candidate of input.projectCandidates)
        push(candidate, routeProject(candidate));
    for (const candidate of input.consolidationCandidates)
        push(candidate, routeConsolidation(candidate));
    return rows.sort((a, b) => (0, ordering_1.compareCodePoints)(a.candidate_type, b.candidate_type)
        || (0, ordering_1.compareCodePoints)(a.candidate_id, b.candidate_id));
}
/** Candidates worth a reasoner's attention: everything not routed to NONE. */
function reasoningEligible(rows) {
    return rows.filter((row) => row.reasoning_type !== "NONE");
}
exports.DEFAULT_REASONING_PACK_BUDGET = {
    maxArtifactsPerPack: 12,
    maxExcerptsPerArtifact: 6,
    maxExcerptCharacters: 240,
    maxTotalPackCharacters: 24000,
};
exports.PACK_SELECTION_PRIORITY = [
    "explicit_conflicting_assertions",
    "explicit_supersession_or_reference_evidence",
    "titles_and_headings",
    "strongest_similarity_evidence",
    "representative_work_signals",
];
const CONFLICT_PREDICATES = new Set(["work.status", "work.blocked_by"]);
const SUPERSESSION_PREDICATES = new Set(["work.supersedes", "work.superseded_by"]);
const REFERENCE_PREDICATES = new Set(["work.references", "work.depends_on"]);
const TITLE_PREDICATES = new Set(["document.title", "document.heading"]);
/**
 * Rank one artifact's assertions by the pack's selection priority.
 *
 * Deterministic and total: priority band first, then predicate, then assertion
 * id. Two runs over one corpus select the same excerpts, which is what makes a
 * truncated pack reproducible rather than merely small.
 */
function assertionPriority(predicate) {
    if (CONFLICT_PREDICATES.has(predicate))
        return 0;
    if (SUPERSESSION_PREDICATES.has(predicate))
        return 1;
    if (REFERENCE_PREDICATES.has(predicate))
        return 1;
    if (TITLE_PREDICATES.has(predicate))
        return 2;
    return 4;
}
function truncate(text, limit) {
    if (text.length <= limit)
        return { text, omitted: 0 };
    return { text: text.slice(0, limit), omitted: text.length - limit };
}
/**
 * Build one bounded pack per reasoning-eligible candidate.
 *
 * `NONE` rows get no pack: the queue exists to spend attention where it can help,
 * and a pack for a candidate nobody will read is the corpus dump this module is
 * written to avoid.
 */
function buildReasoningEvidencePacks(input) {
    const budget = { ...exports.DEFAULT_REASONING_PACK_BUDGET, ...input.budget };
    const byId = new Map(input.views.map((view) => [view.artifact_id, view]));
    const packs = [];
    for (const row of input.reasoningCandidates) {
        if (row.reasoning_type === "NONE")
            continue;
        const members = [...row.member_artifact_ids].sort(ordering_1.compareCodePoints);
        const selected = members.slice(0, budget.maxArtifactsPerPack);
        const artifactsOmitted = members.length - selected.length;
        let usedCharacters = 0;
        let excerptsOmitted = 0;
        let charactersOmitted = 0;
        const coverageGaps = [];
        const artifacts = [];
        for (const artifactId of selected) {
            const view = byId.get(artifactId);
            if (view === undefined) {
                coverageGaps.push(`no feature view for ${artifactId}`);
                continue;
            }
            const all = [...(input.assertionsByArtifact.get(artifactId) ?? [])].sort((a, b) => assertionPriority(a.predicate) - assertionPriority(b.predicate)
                || (0, ordering_1.compareCodePoints)(a.predicate, b.predicate)
                || (0, ordering_1.compareCodePoints)(a.assertion_id, b.assertion_id));
            const kept = [];
            for (const assertion of all) {
                if (kept.length >= budget.maxExcerptsPerArtifact) {
                    excerptsOmitted += 1;
                    continue;
                }
                const excerpt = truncate(assertion.evidence_excerpt, budget.maxExcerptCharacters);
                if (usedCharacters + excerpt.text.length > budget.maxTotalPackCharacters) {
                    excerptsOmitted += 1;
                    charactersOmitted += excerpt.text.length;
                    continue;
                }
                usedCharacters += excerpt.text.length;
                charactersOmitted += excerpt.omitted;
                kept.push({ ...assertion, evidence_excerpt: excerpt.text });
            }
            if (all.length === 0)
                coverageGaps.push(`no assertions recorded for ${artifactId}`);
            const titles = view.normalized_title_tokens;
            artifacts.push({
                artifact_id: view.artifact_id,
                source_path: view.corpus_path,
                content_hash: view.content_hash,
                archive_ancestry: view.archive_ancestry,
                normalized_document_id: view.normalized_document_id,
                titles,
                selected_headings: view.normalized_heading_tokens.slice(0, 12),
                statuses: view.statuses,
                work_kinds: view.kinds,
                tasks_summary: { open_terms: view.task_terms.slice(0, 12) },
                milestones: view.milestone_terms.slice(0, 12),
                explicit_dependencies: view.declared_dependencies,
                explicit_references: view.normalized_reference_targets,
                supersession_assertions: view.supersession_declarations.map((declaration) => `${declaration.predicate} ${declaration.object}`),
                excerpts: kept,
            });
        }
        const memberSet = new Set(members);
        const relevantPairs = input.pairs.filter((pair) => memberSet.has(pair.artifact_a_id) && memberSet.has(pair.artifact_b_id));
        const exactRelations = [];
        const nearScores = [];
        const lexicalSignals = [];
        const embeddingScores = [];
        for (const pair of relevantPairs) {
            for (const signal of pair.signals) {
                if (signal.kind === "exact_duplicate")
                    exactRelations.push(...signal.detail);
                else if (signal.kind === "near_duplicate")
                    nearScores.push({ pair_id: pair.pair_id, score: signal.score });
                else if (signal.kind === "embedding_similarity")
                    embeddingScores.push({ pair_id: pair.pair_id, score: signal.score });
                else if (signal.kind === "title_overlap" || signal.kind === "heading_overlap" || signal.kind === "keyphrase_overlap") {
                    lexicalSignals.push({ pair_id: pair.pair_id, kind: signal.kind, score: signal.score });
                }
            }
        }
        const conflictFlags = [];
        const statuses = new Set();
        for (const artifactId of members) {
            for (const status of byId.get(artifactId)?.statuses ?? [])
                statuses.add(status);
        }
        if (statuses.size > 1)
            conflictFlags.push(`declared statuses differ: ${[...statuses].sort(ordering_1.compareCodePoints).join(", ")}`);
        nearScores.sort((a, b) => (0, ordering_1.compareCodePoints)(a.pair_id, b.pair_id));
        lexicalSignals.sort((a, b) => (0, ordering_1.compareCodePoints)(a.pair_id, b.pair_id) || (0, ordering_1.compareCodePoints)(a.kind, b.kind));
        embeddingScores.sort((a, b) => (0, ordering_1.compareCodePoints)(a.pair_id, b.pair_id));
        coverageGaps.sort(ordering_1.compareCodePoints);
        const truncated = artifactsOmitted > 0 || excerptsOmitted > 0 || charactersOmitted > 0;
        const packId = (0, repository_model_1.stableId)("l9.reasoning-evidence-pack/v1", {
            pack_profile: { budget, selection_priority: exports.PACK_SELECTION_PRIORITY },
            reasoning_candidate_id: row.reasoning_candidate_id,
            selected_evidence_refs: artifacts.flatMap((artifact) => artifact.excerpts.map((excerpt) => excerpt.assertion_id)),
        });
        packs.push({
            schema: exports.REASONING_EVIDENCE_PACK_SCHEMA,
            evidence_pack_id: packId,
            reasoning_candidate_id: row.reasoning_candidate_id,
            candidate_id: row.candidate_id,
            reasoning_type: row.reasoning_type,
            member_artifact_ids: members,
            artifacts,
            relationship_context: {
                exact_duplicate_relations: [...new Set(exactRelations)].sort(ordering_1.compareCodePoints),
                near_duplicate_scores: nearScores,
                lexical_pair_signals: lexicalSignals,
                embedding_scores: embeddingScores,
                candidate_membership: [row.candidate_id],
            },
            ambiguity: {
                conflict_flags: conflictFlags,
                unsupported_evidence: [],
                coverage_gaps: coverageGaps,
            },
            truncation: {
                truncated,
                artifacts_omitted: artifactsOmitted,
                excerpts_omitted: excerptsOmitted,
                characters_omitted: charactersOmitted,
                selection_policy: exports.PACK_SELECTION_PRIORITY.join(" > "),
            },
            pack_profile: { budget, selection_priority: exports.PACK_SELECTION_PRIORITY },
        });
    }
    return packs.sort((a, b) => (0, ordering_1.compareCodePoints)(a.evidence_pack_id, b.evidence_pack_id));
}
/** Canonical JSONL: one record per line, in the order given. */
function renderJsonl(records) {
    return records.map((record) => (0, corpus_analysis_1.canonicalCorpusJson)(record, 0)).join("\n") + (records.length > 0 ? "\n" : "");
}
//# sourceMappingURL=corpus_reasoning.js.map