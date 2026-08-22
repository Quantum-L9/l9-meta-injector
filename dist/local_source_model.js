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
exports.buildLocalSourceManifest = buildLocalSourceManifest;
exports.writeLocalSourceManifest = writeLocalSourceManifest;
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
 * Write the acquisition manifest to a tool-owned output location.
 *
 * Refuses to write inside the observed source tree: an adjacent manifest would
 * mutate the source and would be re-observed by the next run.
 */
function writeLocalSourceManifest(manifest, targetPath, sourceRoot) {
    const absoluteTarget = path.resolve(targetPath);
    const absoluteSource = path.resolve(sourceRoot);
    const sourceDirectory = fs.statSync(absoluteSource).isDirectory()
        ? absoluteSource
        : path.dirname(absoluteSource);
    if (absoluteTarget === sourceDirectory || absoluteTarget.startsWith(sourceDirectory + path.sep)) {
        throw new Error(`local-source: refusing to write the acquisition manifest inside the observed source tree: ${absoluteTarget}`);
    }
    fs.mkdirSync(path.dirname(absoluteTarget), { recursive: true });
    fs.writeFileSync(absoluteTarget, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return absoluteTarget;
}
//# sourceMappingURL=local_source_model.js.map