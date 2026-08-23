"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCAL_SOURCE_MANIFEST_SCHEMA = void 0;
exports.toRepositoryModelLocalSource = toRepositoryModelLocalSource;
exports.canonicalBlockReason = canonicalBlockReason;
exports.observeLocalSourceModel = observeLocalSourceModel;
exports.withLocalSourceModel = withLocalSourceModel;
exports.buildLocalSourceCorpus = buildLocalSourceCorpus;
exports.buildLocalSourceManifest = buildLocalSourceManifest;
exports.writeLocalSourceManifest = writeLocalSourceManifest;
exports.writeLocalSourceCorpus = writeLocalSourceCorpus;
// local_source_model.ts — Repository Model Packet egress for a local source.
//
// Joins the two halves: `acquireLocalSource` produces a read-only observation of
// a file, folder or archive, and `buildRepositoryModelPacket` turns observations
// into the packet the bound topology consumer accepts. Nothing new is invented
// between them — this module supplies the archive provenance overlay and makes
// sure the staged member bytes stay alive exactly as long as interpretation needs
// them.
//
// Two refusals live here, and both are deliberate:
//
//   - An unstable observation never becomes a packet. A packet declares a
//     deterministic snapshot identity, and a snapshot assembled while the source
//     was being written is not one.
//   - A missing required content hash blocks the canonical packet for the same
//     reason: a snapshot whose bytes were never fully read cannot claim to
//     identify them.
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const interpretation_1 = require("./interpretation");
const extractors_1 = require("./extractors");
const local_source_1 = require("./local_source");
const corpus_analysis_1 = require("./corpus_analysis");
const corpus_semantic_run_1 = require("./corpus_semantic_run");
const corpus_report_1 = require("./corpus_report");
const repository_model_1 = require("./repository_model");
/** Schema of the acquisition manifest written beside a bundle. */
exports.LOCAL_SOURCE_MANIFEST_SCHEMA = "l9.local-source-manifest/v1";
/** Map an acquisition into the packet builder's provenance overlay. */
function toRepositoryModelLocalSource(observation) {
    return {
        sourceKind: observation.sourceKind,
        archivePolicyVersion: observation.archivePolicy.version,
        archives: observation.archives.map((archive) => ({
            sourcePath: archive.sourcePath,
            contentHash: archive.contentHash,
            sizeBytes: archive.sizeBytes,
            nestedDepth: archive.nestedDepth,
            parentArchivePath: archive.parentArchivePath,
            parentArchiveHash: archive.parentArchiveHash,
            expanded: archive.expanded,
            memberCount: archive.memberCount,
            omittedMemberCount: archive.omittedMemberCount,
            holdCodes: archive.holds.map((hold) => hold.code),
        })),
        members: observation.virtualArtifacts.map((member) => ({
            virtualSourcePath: member.virtualSourcePath,
            memberPath: member.memberPath,
            contentHash: member.contentHash,
            sizeBytes: member.sizeBytes,
            parentArchivePath: member.parentArchivePath,
            parentArchiveHash: member.parentArchiveHash,
            nestedDepth: member.nestedDepth,
        })),
        diagnostics: observation.diagnostics.map((diagnostic) => ({
            code: diagnostic.code,
            severity: diagnostic.severity,
            message: diagnostic.message,
            ...(diagnostic.sourcePath !== undefined ? { sourcePath: diagnostic.sourcePath } : {}),
        })),
    };
}
/** Reason the observation cannot become a canonical packet, or null when it can. */
function canonicalBlockReason(observation) {
    if (!observation.stable) {
        return "SOURCE_CHANGED_DURING_OBSERVATION: the source changed while it was being observed, "
            + "so no deterministic snapshot exists to emit";
    }
    const missing = observation.inventory.records.filter((record) => record.content_hash === null
        && record.artifact_type !== "folder"
        && record.unknowns.some((unknown) => unknown.startsWith("content_hash_skipped:")));
    if (missing.length > 0) {
        return `a required content hash is missing for ${missing.length} file(s); `
            + "raise the hash budget rather than emitting a snapshot that cannot identify its bytes";
    }
    return null;
}
/**
 * Observe a local source and build its Repository Model Packet.
 *
 * The caller owns the returned observation and must call `observation.dispose()`
 * once it is done with it; the staged member bytes are still on disk until then.
 * Use `withLocalSourceModel` when the packet is all that is needed.
 */
function observeLocalSourceModel(input) {
    const observation = (0, local_source_1.acquireLocalSource)(input);
    try {
        const blocked = canonicalBlockReason(observation);
        if (blocked !== null)
            throw new Error(`local-source: ${blocked}`);
        const subjectId = `repo:${observation.sourceName}`;
        const interpretation = input.interpret === false
            ? undefined
            : (0, interpretation_1.interpretRepository)({
                root: path.resolve(input.path),
                subjectId,
                inventory: observation.inventory,
                extractors: (0, extractors_1.defaultExtractors)(),
            });
        const packet = (0, repository_model_1.buildRepositoryModelPacket)({
            inventory: observation.inventory,
            repositoryName: observation.sourceName,
            sourceRevision: observation.sourceRevision,
            producerVersion: input.producerVersion,
            localSource: toRepositoryModelLocalSource(observation),
            ...(interpretation ? { interpretation } : {}),
            ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
        });
        return { packet, observation, ...(interpretation ? { interpretation } : {}) };
    }
    catch (error) {
        observation.dispose();
        throw error;
    }
}
/** Run `body` against a fresh observation and always dispose the staging root. */
function withLocalSourceModel(input, body) {
    const result = observeLocalSourceModel(input);
    try {
        return body(result);
    }
    finally {
        result.observation.dispose();
    }
}
/**
 * Derive the corpus index and its human report from an already-built model.
 *
 * Everything here is a projection of the observation, the packet and the two
 * duplicate analyses. The staged archive-member bytes must still be on disk,
 * because the similarity pass reads member text the same way it reads a physical
 * file — so call this before `observation.dispose()`.
 */
function buildLocalSourceCorpus(result, options = {}) {
    const base = (0, corpus_analysis_1.buildCorpusIndex)({
        acquisition: result.observation,
        packet: result.packet,
        ...(result.interpretation ? { interpretation: result.interpretation } : {}),
        ...(options.nearDuplicates ? { nearDuplicates: options.nearDuplicates } : {}),
    });
    // The semantic pass runs over the index's own artifacts, which already carry
    // their duplicate cluster and near-duplicate edges, plus the assertions the
    // interpretation produced. It is built here rather than inside
    // `buildCorpusIndex` so that `corpus_analysis` keeps no dependency on the
    // analysis that fills it — the semantic modules import it, not the reverse.
    //
    // What this path does not have is the lexical cache's term counts, so
    // keyphrases here are drawn from titles, headings and declared identifiers
    // rather than from document bodies. Corpus mode, which does have them, sees
    // more. That is a real difference in recall and is documented as one.
    const index = options.semanticAnalysis === false
        ? base
        : (0, corpus_analysis_1.withSemanticProjection)(base, semanticProjectionFor(result, base));
    return { index, indexJson: (0, corpus_analysis_1.renderCorpusIndex)(index), report: (0, corpus_report_1.renderCorpusReport)(index) };
}
/** Run the semantic pass over an index and reduce it to the index's projection. */
function semanticProjectionFor(result, index) {
    const assertions = [
        ...(result.interpretation?.assertions ?? result.packet.payload.assertions),
    ];
    const bySubject = new Map();
    for (const assertion of assertions) {
        const existing = bySubject.get(assertion.subject_id) ?? [];
        existing.push(assertion);
        bySubject.set(assertion.subject_id, existing);
    }
    const analysis = (0, corpus_semantic_run_1.runSemanticAnalysis)({
        corpusSnapshotId: index.source.physical_snapshot_hash,
        artifacts: index.artifacts.map((artifact) => ({
            artifact_id: artifact.artifact_id,
            root_id: index.source.source_name,
            corpus_path: artifact.source_path,
            root_relative_path: artifact.source_path,
            content_hash: artifact.content_hash,
            normalized_document_id: null,
            is_archive_member: artifact.is_archive_member,
            archive_ancestry: archiveAncestryOf(artifact.source_path),
            assertions: (bySubject.get(artifact.artifact_id) ?? []).map((assertion) => ({
                assertion_id: assertion.assertion_id,
                predicate: assertion.predicate,
                object: assertion.object,
            })),
            declared_identifiers: [],
            exact_duplicate_cluster_id: artifact.exact_duplicate_cluster_id,
            near_duplicate_candidate_ids: artifact.near_duplicate_candidate_ids,
        })),
        nearDuplicatePairs: index.near_duplicate_candidates.map((candidate) => ({
            artifact_a_id: candidate.artifact_a_id,
            artifact_b_id: candidate.artifact_b_id,
            score: candidate.score,
        })),
        assertionsByArtifact: new Map([...bySubject.entries()].map(([subject, list]) => [
            subject,
            list.map((assertion) => ({
                assertion_id: assertion.assertion_id,
                predicate: assertion.predicate,
                object: assertion.object,
                source_path: assertion.source_path,
                evidence_excerpt: assertion.evidence_excerpt,
                source_content_hash: assertion.source_content_hash,
            })),
        ])),
    });
    return {
        semantic_analysis_profile_id: analysis.profile.semantic_analysis_profile_id,
        semantic_analysis_profile_version: analysis.profile.semantic_analysis_profile_version,
        keyphrase_profile: analysis.profile.keyphrase_profile,
        semantic_fusion_profile: analysis.profile.semantic_fusion_profile,
        reasoning_routing_profile: analysis.profile.reasoning_routing_profile,
        embedding_enabled: analysis.profile.embedding_enabled,
        embedding_provider_when_enabled: analysis.profile.embedding_provider_when_enabled,
        embedding_model_when_enabled: analysis.profile.embedding_model_when_enabled,
        embedding_model_revision_when_available: analysis.profile.embedding_model_revision_when_available,
        semantic_pair_count: analysis.summary.semantic_pair_count,
        topic_candidate_count: analysis.summary.topic_candidate_count,
        project_candidate_count: analysis.summary.project_candidate_count,
        consolidation_candidate_count: analysis.summary.consolidation_candidate_count,
        reasoning_eligible_count: analysis.summary.reasoning_eligible_count,
        embedding_eligible_artifact_count: analysis.summary.embedding_eligible_artifact_count,
        embedded_artifact_count: analysis.summary.embedded_artifact_count,
        candidate_ids_by_artifact: Object.fromEntries(analysis.candidateIdsByArtifact),
        candidate_statement: analysis.topics.candidate_statement,
    };
}
/** Enclosing archives of a virtual member locator, outermost first. */
function archiveAncestryOf(sourcePath) {
    const parts = sourcePath.split("!/");
    if (parts.length < 2)
        return [];
    const ancestry = [];
    for (let i = 0; i < parts.length - 1; i += 1)
        ancestry.push(parts.slice(0, i + 1).join("!/"));
    return ancestry;
}
/**
 * Replace any manifest value that resembles a credential.
 *
 * The manifest carries paths, digests and counts, never file content, so this
 * should never fire. It exists because "should never" is not a guarantee, and a
 * pathological filename is a cheaper thing to lose than a leaked secret.
 */
function scrubSecretValues(manifest) {
    let redactions = 0;
    const scrub = (value) => {
        if (typeof value === "string") {
            if ((0, interpretation_1.looksSecret)(value)) {
                redactions++;
                return "[redacted]";
            }
            return value;
        }
        if (Array.isArray(value))
            return value.map(scrub);
        if (value !== null && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
        }
        return value;
    };
    return { manifest: scrub(manifest), redactions };
}
/** Build the acquisition manifest. Never written inside the observed source tree. */
function buildLocalSourceManifest(observation, options) {
    const manifest = {
        schema: exports.LOCAL_SOURCE_MANIFEST_SCHEMA,
        source_kind: observation.sourceKind,
        source_name: observation.sourceName,
        source_revision: observation.sourceRevision,
        physical_snapshot_hash: observation.physicalSnapshotHash,
        observed_at: options.observedAt,
        source_mutated: false,
        archive_policy: observation.archivePolicy,
        archives: observation.archives.map((archive) => ({
            source_path: archive.sourcePath,
            archive_hash: archive.contentHash,
            size_bytes: archive.sizeBytes,
            nested_depth: archive.nestedDepth,
            expanded: archive.expanded,
            member_count: archive.memberCount,
            omitted_member_count: archive.omittedMemberCount,
            hold_codes: archive.holds.map((hold) => hold.code),
        })),
        members: observation.virtualArtifacts.map((member) => ({
            virtual_source_path: member.virtualSourcePath,
            member_hash: member.contentHash,
            size_bytes: member.sizeBytes,
            parent_archive_hash: member.parentArchiveHash,
            nested_depth: member.nestedDepth,
        })),
        diagnostics: observation.diagnostics.map((diagnostic) => ({
            code: diagnostic.code,
            severity: diagnostic.severity,
            message: diagnostic.message,
            ...(diagnostic.sourcePath !== undefined ? { source_path: diagnostic.sourcePath } : {}),
        })),
        omitted_paths: observation.inventory.omittedPaths,
    };
    return scrubSecretValues(manifest).manifest;
}
/**
 * Resolve an output path, refusing anything inside the observed source tree.
 *
 * An output written beside the source would mutate what was just observed, and
 * the next run would then observe this run's output as if it were user content.
 */
function resolveOutsideSource(targetPath, sourceRoot, what) {
    const absoluteTarget = path.resolve(targetPath);
    const absoluteSource = path.resolve(sourceRoot);
    const sourceDirectory = fs.statSync(absoluteSource).isDirectory()
        ? absoluteSource
        : path.dirname(absoluteSource);
    if (absoluteTarget === sourceDirectory || absoluteTarget.startsWith(sourceDirectory + path.sep)) {
        throw new Error(`local-source: refusing to write ${what} inside the observed source tree: ${absoluteTarget}`);
    }
    return absoluteTarget;
}
/** Write the acquisition manifest to a tool-owned output location. */
function writeLocalSourceManifest(manifest, targetPath, sourceRoot) {
    const absoluteTarget = resolveOutsideSource(targetPath, sourceRoot, "the acquisition manifest");
    fs.mkdirSync(path.dirname(absoluteTarget), { recursive: true });
    fs.writeFileSync(absoluteTarget, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return absoluteTarget;
}
/** Write `corpus-index.json` and `corpus-report.md` outside the observed source. */
function writeLocalSourceCorpus(outputs, targets, sourceRoot) {
    const indexPath = resolveOutsideSource(targets.indexPath, sourceRoot, "the corpus index");
    const reportPath = resolveOutsideSource(targets.reportPath, sourceRoot, "the corpus report");
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, outputs.indexJson, "utf8");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, outputs.report, "utf8");
    return { indexPath, reportPath };
}
//# sourceMappingURL=local_source_model.js.map