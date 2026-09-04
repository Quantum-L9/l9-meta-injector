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
exports.EXPANDABLE_ARCHIVE_EXTS = exports.EXTRACTED_DIR_SUFFIX = void 0;
exports.extractDirFor = extractDirFor;
exports.listZipMembers = listZipMembers;
exports.extractionRefusalReason = extractionRefusalReason;
exports.extractZip = extractZip;
exports.findArchives = findArchives;
exports.writeArchiveSidecar = writeArchiveSidecar;
exports.expandArchivesUnderRoot = expandArchivesUnderRoot;
// archives.ts — legacy, opt-in, MUTATING local-files archive expansion.
//
// Canonical observation lives in local_source.ts. This module owns only the
// explicitly requested sibling materialization mode. ZIP parsing and admission
// are shared with the read-only path through ArchiveExecutionContext.
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const comment_1 = require("./comment");
const yaml_serialize_1 = require("./yaml_serialize");
const ordering_1 = require("./ordering");
const local_source_1 = require("./local_source");
const archive_preflight_1 = require("./archive_preflight");
const archive_execution_1 = require("./archive_execution");
const zip_reader_1 = require("./zip_reader");
const archive_formats_1 = require("./archive_formats");
const durable_write_1 = require("./durable_write");
/** Directory-name suffix for an expanded archive (sibling of the .zip). */
exports.EXTRACTED_DIR_SUFFIX = ".l9extracted";
/** Archive extensions expanded in local-files mode (v1: zip only). Owned by `archive_formats.ts`. */
exports.EXPANDABLE_ARCHIVE_EXTS = archive_formats_1.EXPANDABLE_ARCHIVE_EXTENSIONS;
class ArchiveIntegrityError extends Error {
    constructor(message) {
        super(message);
        this.name = "ArchiveIntegrityError";
    }
}
/** Convert only expected archive/input refusals into held records. */
function expectedArchiveHoldReason(error) {
    if (error instanceof ArchiveIntegrityError)
        return `archive.integrity_failed: ${error.message}`;
    if (error instanceof archive_execution_1.ArchiveExecutionHeldError)
        return `archive.resource_refused: ${error.message}`;
    if (error instanceof zip_reader_1.ZipBudgetExceededError)
        return `archive.resource_refused: ${error.message}`;
    if (error instanceof zip_reader_1.ZipFormatError)
        return `archive.format_unreadable: ${error.message}`;
    return null;
}
function isExpandableArchive(filePath) {
    return (0, archive_formats_1.isExpandableArchivePath)(filePath);
}
function relPosix(root, abs) {
    return path.relative(root, abs).split(path.sep).join("/");
}
function isOmitted(omit, rel) {
    if (!omit)
        return false;
    return omit.shouldOmit(rel) || omit.shouldOmit(rel.endsWith("/") ? rel : `${rel}/`);
}
function sortPaths(paths) {
    return paths.sort(ordering_1.compareCodePoints);
}
/** Sibling extract directory for a zip: `Archive.zip` → `Archive.l9extracted`. */
function extractDirFor(zipPath) {
    const dir = path.dirname(zipPath);
    const base = path.basename(zipPath, path.extname(zipPath));
    return path.join(dir, base + exports.EXTRACTED_DIR_SUFFIX);
}
/** List canonical member paths inside a ZIP. */
function listZipMembers(zipPath) {
    return (0, zip_reader_1.readZipCentralDirectory)(zipPath).entries.map((entry) => {
        const canonical = (0, archive_preflight_1.canonicalMemberPath)(entry.name);
        if (canonical.startsWith("/") || canonical.split("/").includes("..")) {
            throw new Error(`refusing to extract unsafe zip member path from ${zipPath}: ${entry.name}`);
        }
        return entry.kind === "directory" ? `${canonical}/` : canonical;
    });
}
function readExtractionOwnershipV2(directory) {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(directory, local_source_1.LEGACY_EXTRACTION_OWNER_FILE), "utf8"));
        if (raw.schema !== local_source_1.LOCAL_FILES_EXTRACTION_SCHEMA || raw.owner !== local_source_1.EXTRACTION_OWNER_ID)
            return null;
        if (typeof raw.archive !== "string" || raw.archive.length === 0)
            return null;
        if (typeof raw.archive_sha256 !== "string" || !/^sha256:[0-9a-f]{64}$/.test(raw.archive_sha256))
            return null;
        if (typeof raw.reader_version !== "string" || raw.reader_version.length === 0)
            return null;
        if (typeof raw.policy_fingerprint !== "string" || !/^lap1:[0-9a-f]{64}$/.test(raw.policy_fingerprint))
            return null;
        if (typeof raw.created_at !== "string" || Number.isNaN(Date.parse(raw.created_at)))
            return null;
        return raw;
    }
    catch {
        return null;
    }
}
/**
 * Reason an existing extraction directory may not be replaced, or null when it may.
 * Destructive authority is exact provenance, never a suffix or owner-prefix guess.
 */
function extractionRefusalReason(extractDir, zipPath) {
    if (!fs.existsSync(extractDir))
        return null;
    let stat;
    try {
        stat = fs.lstatSync(extractDir);
    }
    catch (error) {
        return `extraction target cannot be inspected: ${error.message}`;
    }
    if (stat.isSymbolicLink())
        return `extraction target is a symbolic link: ${extractDir}`;
    if (!stat.isDirectory())
        return `extraction target exists and is not a directory: ${extractDir}`;
    const marker = readExtractionOwnershipV2(extractDir);
    if (marker !== null) {
        if (zipPath !== undefined && marker.archive !== path.basename(zipPath)) {
            return (`extraction target ownership belongs to ${marker.archive}, not ${path.basename(zipPath)}; ` +
                `it is never replaced: ${extractDir}`);
        }
        return null;
    }
    if (fs.readdirSync(extractDir).length === 0) {
        return (`extraction target exists, is empty, and carries no valid v2 ownership marker, ` +
            `so it is treated as user data and never replaced: ${extractDir}`);
    }
    if ((0, local_source_1.hasLegacyExtractionOwnership)(extractDir)) {
        return (`extraction target carries a legacy ownership marker without the complete v2 provenance, ` +
            `so it is never replaced; remove it manually to re-extract: ${extractDir}`);
    }
    return (`extraction target already exists and carries no valid ${local_source_1.LEGACY_EXTRACTION_OWNER_FILE} ownership marker, ` +
        `so it is treated as user data and never removed: ${extractDir}`);
}
/** Stamp exact provenance only after every member has verified. */
function writeExtractionOwnership(extractDir, context) {
    fs.writeFileSync(path.join(extractDir, local_source_1.LEGACY_EXTRACTION_OWNER_FILE), JSON.stringify({
        schema: local_source_1.LOCAL_FILES_EXTRACTION_SCHEMA,
        owner: local_source_1.EXTRACTION_OWNER_ID,
        archive: path.basename(context.zipPath),
        archive_sha256: context.archiveSha256,
        reader_version: context.readerVersion,
        policy_fingerprint: context.policyFingerprint,
        created_at: new Date().toISOString(),
    }, null, 2), "utf8");
}
/**
 * Standalone materialization convenience. Multi-archive runs use one shared
 * resolution and one context per archive through expandArchivesUnderRoot.
 */
function extractZip(zipPath, extractDir, allowedMembers, options) {
    const resolution = options?.resolution ?? (0, archive_execution_1.resolveArchiveExecution)(options?.policy);
    const context = new archive_execution_1.ArchiveExecutionContext({
        zipPath,
        extractDir,
        depth: options?.depth ?? 0,
        resolution,
    });
    try {
        return materializeArchiveContext(context, allowedMembers).memberCount;
    }
    finally {
        context.dispose();
    }
}
function materializeArchiveContext(context, allowedMembers) {
    const refusal = extractionRefusalReason(context.extractDir, context.zipPath);
    if (refusal !== null)
        throw new Error(`local-files: ${refusal}`);
    if (!context.preflight.accepted) {
        throw new archive_execution_1.ArchiveExecutionHeldError(`refusing to extract ${path.basename(context.zipPath)}: ${context.holdReasons()}`);
    }
    const sessionRefusal = context.sessionRefusalReason();
    if (sessionRefusal !== null)
        throw new archive_execution_1.ArchiveExecutionHeldError(sessionRefusal);
    const selected = context.planMembers(allowedMembers);
    const candidate = `${context.extractDir}.candidate-${crypto.randomUUID().slice(0, 8)}`;
    let candidateCreated = false;
    let expandedBytes = 0;
    try {
        fs.mkdirSync(candidate, { recursive: false });
        candidateCreated = true;
        for (const member of selected) {
            expandedBytes += writeMember(context, candidate, member, expandedBytes);
        }
        writeExtractionOwnership(candidate, context);
        swapCandidateIntoPlace(candidate, context.extractDir, context.zipPath);
        candidateCreated = false;
    }
    catch (error) {
        if (candidateCreated)
            fs.rmSync(candidate, { recursive: true, force: true });
        throw error;
    }
    context.recordSuccess(expandedBytes);
    return { memberCount: selected.length, expandedBytes };
}
/** Replace `extractDir` with a complete candidate and restore on swap failure. */
function swapCandidateIntoPlace(candidate, extractDir, zipPath) {
    const hadPrevious = fs.existsSync(extractDir);
    const backup = hadPrevious ? `${extractDir}.previous-${crypto.randomUUID().slice(0, 8)}` : null;
    if (backup !== null) {
        const refusal = extractionRefusalReason(extractDir, zipPath);
        if (refusal !== null)
            throw new Error(`local-files: ${refusal}`);
        fs.renameSync(extractDir, backup);
    }
    try {
        fs.renameSync(candidate, extractDir);
    }
    catch (error) {
        if (backup !== null) {
            try {
                fs.renameSync(backup, extractDir);
            }
            catch { }
        }
        throw error;
    }
    if (backup !== null)
        fs.rmSync(backup, { recursive: true, force: true });
}
/**
 * Stream one staged member through byte ceilings, deadline and CRC verification.
 * The sink is optional so dry-run can exercise the exact runtime integrity path
 * without materializing anything in the source tree.
 */
function streamVerifiedMember(context, member, expandedBytes, sink) {
    const ceiling = Math.min(context.policy.maxSingleMemberUncompressedBytes, Math.max(0, context.policy.maxTotalUncompressedBytesPerArchive - expandedBytes), Math.max(0, context.budget.remainingBytes() - expandedBytes));
    const result = (0, zip_reader_1.streamZipMember)(context.stagedZipPath, member.entry, { maxUncompressedBytes: ceiling }, (chunk) => {
        context.assertProcessingWithinBudget();
        sink?.(chunk);
    });
    if (result.crc32 !== member.entry.crc32) {
        throw new ArchiveIntegrityError(`extracted bytes for ${member.canonicalPath} do not match the CRC in the central directory`);
    }
    return result.bytesWritten;
}
/** Write one preflight-approved member from the immutable staged ZIP. */
function writeMember(context, extractDir, member, expandedBytes) {
    const target = path.join(extractDir, member.canonicalPath);
    const resolvedRoot = path.resolve(extractDir);
    if (path.resolve(target) !== resolvedRoot && !path.resolve(target).startsWith(resolvedRoot + path.sep)) {
        throw new Error(`local-files: refusing to write outside the extraction directory: ${member.canonicalPath}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const handle = fs.openSync(target, "w");
    try {
        return streamVerifiedMember(context, member, expandedBytes, (chunk) => { fs.writeSync(handle, chunk); });
    }
    finally {
        fs.closeSync(handle);
    }
}
function verifyMembersWithoutMaterializing(context, selected) {
    let expandedBytes = 0;
    for (const member of selected) {
        expandedBytes += streamVerifiedMember(context, member, expandedBytes);
    }
    return expandedBytes;
}
/**
 * Files under an extraction, in code-point order.
 *
 * The order decides which nested archive is opened first, and the run-scoped
 * session budget is consumed in that order: with `readdir` order, which nested
 * archive was held under an exhausted budget depended on the host filesystem.
 */
function walkFiles(dir, out) {
    if (!fs.existsSync(dir))
        return;
    const entries = fs.readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => (0, ordering_1.compareCodePoints)(a.name, b.name));
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith(".") || entry.name === "node_modules")
                continue;
            walkFiles(full, out);
        }
        else if (entry.isFile()) {
            out.push(full);
        }
    }
}
function shouldSkipArchiveDir(name, omit, rel, absolute) {
    if (name.startsWith(".") || name === "node_modules")
        return true;
    if (name.endsWith(exports.EXTRACTED_DIR_SUFFIX) && (0, local_source_1.hasLegacyExtractionOwnership)(absolute))
        return true;
    return isOmitted(omit, rel);
}
/** Discover expandable archives under root. */
function findArchives(root, omit) {
    const absRoot = path.resolve(root);
    const archives = [];
    const omitted = [];
    function walk(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            const rel = relPosix(absRoot, full);
            if (entry.isDirectory()) {
                if (shouldSkipArchiveDir(entry.name, omit, rel, full))
                    continue;
                walk(full);
                continue;
            }
            if (!entry.isFile() || !isExpandableArchive(full))
                continue;
            if (isOmitted(omit, rel))
                omitted.push(rel);
            else
                archives.push(full);
        }
    }
    if (fs.existsSync(absRoot))
        walk(absRoot);
    return { archives: sortPaths(archives), omitted: sortPaths(omitted) };
}
function contentHashFile(filePath) {
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(filePath));
    return `sha256:${hash.digest("hex")}`;
}
/** Write `<zip>.l9meta.yaml` describing the archive and its extract location. */
function writeArchiveSidecar(zipPath, extractDir, memberCount, extras = {}) {
    const sidecar = (0, comment_1.sidecarPathFor)(zipPath);
    // A caller that already admitted an immutable snapshot supplies its hash and
    // size in `extras`. Prefer those values without touching the live ZIP again;
    // otherwise a source swap after extraction could make the sidecar describe
    // different bytes or fail after the transactional tree had already committed.
    const suppliedHash = extras.content_hash;
    const suppliedSize = extras.size_bytes;
    const contentHash = typeof suppliedHash === "string" ? suppliedHash : contentHashFile(zipPath);
    const sizeBytes = typeof suppliedSize === "number" && Number.isFinite(suppliedSize)
        ? suppliedSize
        : fs.statSync(zipPath).size;
    const obj = {
        schema: "l9.archive-sidecar/v1",
        artifact_type: "archive",
        source_path: zipPath,
        file_name: path.basename(zipPath),
        content_hash: contentHash,
        size_bytes: sizeBytes,
        extracted_to: extractDir,
        member_count: memberCount,
        injectable: false,
        expanded_by: "l9-meta-injector.local-files",
        ...extras,
    };
    // Staged beside the archive and renamed in, so a crash never leaves a
    // truncated sidecar that the next run would read as this archive's record.
    (0, durable_write_1.replaceFileAtomically)(sidecar, (0, yaml_serialize_1.serializeYamlObject)(obj, { fences: true, trailingNewline: true }));
    return sidecar;
}
function filterAllowedMembers(absRoot, extractDir, members, omit) {
    if (!omit)
        return members;
    return members.filter((m) => !isOmitted(omit, relPosix(absRoot, path.join(extractDir, m))));
}
function enqueueNestedZips(absRoot, extractDir, depth, maxDepth, omit, queue, omittedArchives) {
    if (depth >= maxDepth)
        return;
    const nested = [];
    walkFiles(extractDir, nested);
    for (const f of nested) {
        if (!isExpandableArchive(f))
            continue;
        const nestedRel = relPosix(absRoot, f);
        if (isOmitted(omit, nestedRel)) {
            omittedArchives.push(nestedRel);
            continue;
        }
        queue.push({ zipPath: f, depth: depth + 1 });
    }
}
function expandOneArchive(absRoot, zipPath, depth, opts, omit, resolution) {
    const extractDir = extractDirFor(zipPath);
    let context;
    try {
        context = new archive_execution_1.ArchiveExecutionContext({ zipPath, extractDir, depth, resolution });
    }
    catch (error) {
        const heldReason = expectedArchiveHoldReason(error);
        if (heldReason === null)
            throw error;
        return { zipPath, extractDir, memberCount: 0, nestedDepth: depth, heldReason };
    }
    try {
        const refusal = extractionRefusalReason(extractDir, zipPath);
        if (refusal !== null) {
            return { zipPath, extractDir, memberCount: 0, nestedDepth: depth, heldReason: refusal };
        }
        if (!context.preflight.accepted) {
            return {
                zipPath,
                extractDir,
                memberCount: 0,
                nestedDepth: depth,
                heldReason: `refusing to extract ${path.basename(zipPath)}: ${context.holdReasons()}`,
            };
        }
        const sessionRefusal = context.sessionRefusalReason();
        if (sessionRefusal !== null) {
            return { zipPath, extractDir, memberCount: 0, nestedDepth: depth, heldReason: sessionRefusal };
        }
        const members = context.preflight.members.map((member) => member.canonicalPath);
        const allowed = filterAllowedMembers(absRoot, extractDir, members, omit);
        const selected = context.planMembers(omit ? allowed : undefined);
        if (opts.dryRun) {
            try {
                const verifiedBytes = verifyMembersWithoutMaterializing(context, selected);
                context.recordSuccess(verifiedBytes);
            }
            catch (error) {
                const heldReason = expectedArchiveHoldReason(error);
                if (heldReason === null)
                    throw error;
                return { zipPath, extractDir, memberCount: 0, nestedDepth: depth, heldReason };
            }
            if (opts.verbose) {
                process.stderr.write(`[l9-meta-injector] local-files: dry-run would extract ${zipPath} → ${extractDir} ` +
                    `(depth=${depth}, members=${selected.length}/${members.length})\n`);
            }
            return {
                zipPath,
                extractDir,
                memberCount: 0,
                nestedDepth: depth,
                heldReason: `dry-run: ${selected.length} member(s) would be extracted to ${extractDir}`,
            };
        }
        if (opts.verbose) {
            process.stderr.write(`[l9-meta-injector] local-files: extracting ${zipPath} → ${extractDir} ` +
                `(depth=${depth}, members=${selected.length}/${members.length})\n`);
        }
        let materialized;
        try {
            materialized = materializeArchiveContext(context, omit ? allowed : undefined);
        }
        catch (error) {
            const heldReason = expectedArchiveHoldReason(error);
            if (heldReason === null)
                throw error;
            return { zipPath, extractDir, memberCount: 0, nestedDepth: depth, heldReason };
        }
        const sidecarPath = writeArchiveSidecar(zipPath, extractDir, materialized.memberCount, {
            content_hash: context.archiveSha256,
            size_bytes: context.archiveCompressedBytes,
            nested_depth: depth,
            expanded_at: new Date().toISOString(),
            members_omitted: members.length - allowed.length,
            archive_reader_version: context.readerVersion,
            archive_policy_fingerprint: context.policyFingerprint,
        });
        return {
            zipPath,
            extractDir,
            memberCount: materialized.memberCount,
            sidecarPath,
            nestedDepth: depth,
        };
    }
    finally {
        context.dispose();
    }
}
/** Expand all ZIPs under root with one acquisition-wide policy and budget. */
function expandArchivesUnderRoot(root, opts) {
    const absRoot = path.resolve(root);
    const resolution = (0, archive_execution_1.resolveArchiveExecution)(opts.archivePolicy);
    const maxDepth = Math.min(opts.maxDepth ?? resolution.policy.maxNestedDepth, resolution.policy.maxNestedDepth);
    const archives = [];
    const extractedRoots = [];
    const omittedArchives = [];
    const omit = opts.omit;
    const found = findArchives(absRoot, omit);
    omittedArchives.push(...found.omitted);
    const queue = found.archives.map((zipPath) => ({
        zipPath,
        depth: 0,
    }));
    const seen = new Set();
    while (queue.length) {
        const { zipPath, depth } = queue.shift();
        const key = path.resolve(zipPath);
        if (seen.has(key))
            continue;
        seen.add(key);
        const zipRel = relPosix(absRoot, zipPath);
        if (isOmitted(omit, zipRel)) {
            omittedArchives.push(zipRel);
            if (opts.verbose)
                process.stderr.write(`[l9-meta-injector] local-files: omit archive ${zipRel}\n`);
            continue;
        }
        const record = expandOneArchive(absRoot, zipPath, depth, opts, omit, resolution);
        archives.push(record);
        if (record.heldReason !== undefined)
            continue;
        extractedRoots.push(record.extractDir);
        enqueueNestedZips(absRoot, record.extractDir, depth, maxDepth, omit, queue, omittedArchives);
    }
    if (opts.verbose || archives.length > 0 || omittedArchives.length > 0) {
        process.stderr.write(`[l9-meta-injector] local-files: expanded ${archives.length} archive(s)` +
            (omittedArchives.length ? `, omitted ${omittedArchives.length}` : "") +
            ` under ${absRoot}\n`);
    }
    return { archives, extractedRoots, omittedArchives };
}
//# sourceMappingURL=archives.js.map