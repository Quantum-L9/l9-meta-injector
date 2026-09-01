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
exports.ARCHIVE_READER_VERSION = exports.EXTRACTION_OWNER_ID = exports.LOCAL_FILES_EXTRACTION_SCHEMA = exports.LEGACY_EXTRACTION_SUFFIX = exports.LEGACY_EXTRACTION_OWNER_FILE = exports.GENERATED_ARTIFACT_OMIT_PATTERNS = exports.SCRATCH_OWNER_ID = exports.SCRATCH_OWNER_FILE = exports.ARCHIVE_MEMBER_SEPARATOR = void 0;
exports.removeOwnedScratch = removeOwnedScratch;
exports.hasLegacyExtractionOwnership = hasLegacyExtractionOwnership;
exports.hasExtractionOwnershipV2 = hasExtractionOwnershipV2;
exports.isLegacyGeneratedExtraction = isLegacyGeneratedExtraction;
exports.hashFileStreaming = hashFileStreaming;
exports.physicalManifestDigest = physicalManifestDigest;
exports.acquireLocalSource = acquireLocalSource;
// local_source.ts — read-only acquisition of an arbitrary local filesystem source.
//
// A source here is a file, an ordinary folder, an external-drive tree, a synced
// folder, or a ZIP archive. None of them has to be a Git repository, and none of
// them is modified: acquisition observes, it never annotates, extracts beside, or
// materializes into the source tree.
//
// The behavior this module replaces expanded `Foo.zip` into a sibling
// `Foo.l9extracted/`, removing whatever already lived at that path first. That
// made observation destructive and made a machine-specific extraction directory
// part of an artifact's identity. Here an archive is staged into tool-owned
// scratch, its members become virtual artifacts named `Foo.zip!/member`, and the
// scratch location never reaches a packet.
//
// Three properties this module is responsible for:
//
//   - Source immutability. Nothing under the observed root is written, renamed,
//     removed, or chmod-ed, on the success path or on any failure path.
//   - Snapshot honesty. A directory can change while it is being read. Entries are
//     enumerated, then hashed, then re-enumerated; if anything moved, the
//     observation is marked unstable and a canonical packet is refused rather
//     than assembled from a torn read.
//   - Machine independence. Identity is derived from bytes and repository-relative
//     POSIX paths. Absolute paths, scratch paths, inode numbers, timestamps,
//     usernames and hostnames never participate.
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const inventory_1 = require("./inventory");
const ordering_1 = require("./ordering");
const encoding_1 = require("./encoding");
const omit_1 = require("./omit");
const archive_preflight_1 = require("./archive_preflight");
const archive_execution_1 = require("./archive_execution");
const local_archive_policy_1 = require("./local_archive_policy");
const zip_reader_1 = require("./zip_reader");
/** Separator between an archive path and a member path in a virtual locator. */
exports.ARCHIVE_MEMBER_SEPARATOR = "!/";
/** Ownership marker written at the root of every scratch directory this module creates. */
exports.SCRATCH_OWNER_FILE = ".l9-scratch-owner.json";
exports.SCRATCH_OWNER_ID = "l9-meta-injector.local-source";
/** Chunk size for streaming file hashes. Memory never scales with file size. */
const HASH_CHUNK_BYTES = 64 * 1024;
/** How many times a changed file is re-read before the observation is called unstable. */
const STABILITY_RETRY_LIMIT = 2;
/** Extensions recognized as archives. v1 expands ZIP only. */
const ZIP_EXTENSIONS = new Set([".zip"]);
const KNOWN_UNEXPANDABLE_ARCHIVE_EXTENSIONS = new Set([
    ".tar", ".tgz", ".gz", ".bz2", ".xz", ".7z", ".rar", ".jar", ".war", ".zst", ".lz4", ".cab", ".iso",
]);
/**
 * Generated artifacts this package itself produces. They are excluded from
 * canonical source observation so a second run never observes the first run's
 * output as if it were user content.
 */
exports.GENERATED_ARTIFACT_OMIT_PATTERNS = [
    "*.inject.log",
    "*.l9meta.yaml",
    ".l9/",
    ".l9inventory/",
    ".l9out/",
    ".l9skills/",
];
/** Marker a tool-owned legacy extraction directory carries. */
exports.LEGACY_EXTRACTION_OWNER_FILE = ".l9extracted-owner.json";
exports.LEGACY_EXTRACTION_SUFFIX = ".l9extracted";
/** Schema id stamped on the v2 extraction-ownership marker. */
exports.LOCAL_FILES_EXTRACTION_SCHEMA = "l9-meta-injector.local-files-extraction/v2";
/** Exact owner id the materialization path stamps and the destructive path accepts. */
exports.EXTRACTION_OWNER_ID = "l9-meta-injector.local-files";
/** Version of the ZIP reader whose output an archive manifest describes. */
exports.ARCHIVE_READER_VERSION = "1.0.0";
/**
 * Resolve a path through symlinks, falling back to the deepest ancestor that
 * exists. A scratch parent is usually about to be created, so it cannot be
 * required to exist before its location can be judged.
 */
function realPathOrNearest(target) {
    const absolute = path.resolve(target);
    const missing = [];
    let current = absolute;
    for (;;) {
        try {
            return path.join(fs.realpathSync(current), ...missing);
        }
        catch {
            const parent = path.dirname(current);
            if (parent === current)
                return absolute;
            missing.unshift(path.basename(current));
            current = parent;
        }
    }
}
/**
 * Refuse a scratch root that would be created inside the tree being observed.
 *
 * Both paths are resolved through symlinks first, so a scratch parent that only
 * points back into the source is refused on the same footing as one written
 * inside it directly. The check runs *before* any directory is made: a
 * containment violation that has already created a directory inside the source
 * has already broken the read-only guarantee it exists to keep, and reporting it
 * afterwards would be a diagnostic rather than a defence.
 *
 * A caller-selected scratch outside the source stays supported; this refuses one
 * location, not the option.
 */
function assertScratchOutsideSource(scratchParent, absoluteSource, sourceKind) {
    const realSource = realPathOrNearest(absoluteSource);
    // For a file source the protected boundary is the directory holding it: that is
    // the tree the observation promises not to write into.
    const boundary = sourceKind === "directory" ? realSource : path.dirname(realSource);
    const realParent = realPathOrNearest(scratchParent);
    if (realParent === boundary || realParent.startsWith(boundary + path.sep)) {
        throw new Error("scratch parent resolves inside the observed source and would write into a read-only tree: "
            + `${scratchParent} resolves to ${realParent}, inside ${boundary}`);
    }
}
/**
 * Create a tool-owned scratch root outside the source tree.
 *
 * The ownership token is what makes cleanup safe: a recursive delete is permitted
 * only for a path inside a root this session created and whose marker still
 * carries this session's token. Nothing is ever removed because of its name.
 */
function createScratch(parent) {
    const base = parent.length > 0 ? parent : os.tmpdir();
    fs.mkdirSync(base, { recursive: true });
    const root = fs.mkdtempSync(path.join(base, "l9-local-source-"));
    const token = crypto.randomUUID();
    fs.writeFileSync(path.join(root, exports.SCRATCH_OWNER_FILE), JSON.stringify({ owner: exports.SCRATCH_OWNER_ID, token, pid: process.pid }, null, 2), "utf8");
    let disposed = false;
    return {
        root,
        token,
        dispose() {
            if (disposed)
                return;
            disposed = true;
            removeOwnedScratch(root, token);
        },
    };
}
/**
 * Recursively remove a scratch root, but only after re-reading its ownership
 * marker. Without this check a corrupted or reassigned `scratchRoot` would make
 * `dispose()` a recursive delete of an arbitrary path.
 */
function removeOwnedScratch(root, token) {
    let marker;
    try {
        marker = JSON.parse(fs.readFileSync(path.join(root, exports.SCRATCH_OWNER_FILE), "utf8"));
    }
    catch {
        return; // No provable ownership: leave the path alone.
    }
    if (marker.owner !== exports.SCRATCH_OWNER_ID || marker.token !== token)
        return;
    fs.rmSync(root, { recursive: true, force: true });
}
/**
 * True when a directory carries evidence that this tool created it.
 *
 * A directory is not tool-owned merely because its name ends in `.l9extracted`.
 * Users name directories whatever they like, and treating a name as ownership is
 * exactly how user data gets deleted.
 */
function hasLegacyExtractionOwnership(directory) {
    try {
        const marker = JSON.parse(fs.readFileSync(path.join(directory, exports.LEGACY_EXTRACTION_OWNER_FILE), "utf8"));
        // Exact id only: a prefix match would let an attacker-chosen owner such as
        // `l9-meta-injector.evil` borrow this package's authority. This predicate
        // decides exclusion from observation, not destruction; the destructive path
        // additionally requires the v2 schema.
        return typeof marker.owner === "string" && marker.owner === exports.EXTRACTION_OWNER_ID;
    }
    catch {
        return false;
    }
}
/**
 * True when a directory carries the v2 ownership marker, exact owner and all.
 *
 * This is the predicate the destructive replace path consults: a marker without
 * the v2 schema field is a legacy or foreign file and never authorizes removal.
 */
function hasExtractionOwnershipV2(directory) {
    try {
        const marker = JSON.parse(fs.readFileSync(path.join(directory, exports.LEGACY_EXTRACTION_OWNER_FILE), "utf8"));
        return marker.schema === exports.LOCAL_FILES_EXTRACTION_SCHEMA && marker.owner === exports.EXTRACTION_OWNER_ID;
    }
    catch {
        return false;
    }
}
/**
 * True when `directory` is a legacy extraction of an archive that sits beside it.
 *
 * Both signals must agree: the ownership marker, and an adjacent archive whose
 * name the directory derives from. Either alone is an assumption.
 */
function isLegacyGeneratedExtraction(absoluteDirectory) {
    if (!absoluteDirectory.endsWith(exports.LEGACY_EXTRACTION_SUFFIX))
        return false;
    if (!hasLegacyExtractionOwnership(absoluteDirectory))
        return false;
    const stem = absoluteDirectory.slice(0, -exports.LEGACY_EXTRACTION_SUFFIX.length);
    return [...ZIP_EXTENSIONS].some((extension) => {
        try {
            return fs.lstatSync(stem + extension).isFile();
        }
        catch {
            return false;
        }
    });
}
// ───────────────────────────── hashing ─────────────────────────────
function sha256Prefixed(digestHex) {
    return `sha256:${digestHex}`;
}
/** Stream a file through SHA-256. Bounded memory regardless of file size. */
function hashFileStreaming(absolutePath) {
    const hash = crypto.createHash("sha256");
    const fd = fs.openSync(absolutePath, "r");
    try {
        const buffer = Buffer.alloc(HASH_CHUNK_BYTES);
        let position = 0;
        for (;;) {
            const count = fs.readSync(fd, buffer, 0, buffer.length, position);
            if (count === 0)
                break;
            hash.update(buffer.subarray(0, count));
            position += count;
        }
        return { hash: sha256Prefixed(hash.digest("hex")), bytes: position };
    }
    finally {
        fs.closeSync(fd);
    }
}
/**
 * Digest of the physical snapshot.
 *
 * The manifest deliberately carries only repository-relative paths, entry kinds,
 * file content hashes and literal symlink targets. Absolute paths, inode and
 * device numbers, access times, observation wall clock, scratch locations,
 * usernames and hostnames are excluded, so the same tree observed from a
 * different mount point on a different machine yields the same digest.
 */
function physicalManifestDigest(entries) {
    const ordered = [...entries].sort((a, b) => (0, ordering_1.compareCodePoints)(a.path, b.path));
    const rendered = ordered
        .map((entry) => JSON.stringify([entry.path, entry.kind, entry.contentHash ?? null, entry.linkTarget ?? null]))
        .join("\n");
    return sha256Prefixed(crypto.createHash("sha256").update(rendered, "utf8").digest("hex"));
}
function entryKindFromStats(stats) {
    if (stats.isSymbolicLink())
        return "symlink";
    if (stats.isDirectory())
        return "directory";
    if (stats.isFile())
        return "file";
    return "special";
}
function toPosix(value) {
    return value.split(path.sep).join("/");
}
/**
 * Enumerate a directory tree without following symlinks.
 *
 * `lstat` is used throughout: a symlink is observed as a symlink, and the tree it
 * points at — which may be outside the root, or a cycle — is never walked.
 */
/** Observe one filesystem entry with lstat, never following what it points at. */
function observeEntry(absolutePath, relativePath, diagnostics) {
    let stats;
    try {
        stats = fs.lstatSync(absolutePath);
    }
    catch (error) {
        diagnostics.push({
            code: "local-source.entry_unreadable",
            severity: "warning",
            message: `filesystem entry could not be inspected: ${error.message}`,
            sourcePath: relativePath,
        });
        return null;
    }
    const kind = entryKindFromStats(stats);
    let linkTarget = null;
    if (kind === "symlink") {
        // The link's own text, never the resolved target: resolving it would read
        // outside the observed root.
        try {
            linkTarget = toPosix(fs.readlinkSync(absolutePath));
        }
        catch {
            linkTarget = null;
        }
    }
    return {
        absolutePath,
        relativePath,
        kind,
        sizeBytes: kind === "file" ? stats.size : null,
        mtimeMs: kind === "directory" ? null : stats.mtimeMs,
        mtimeNs: kind === "directory" ? null : highResolutionMtime(absolutePath),
        linkTarget,
    };
}
/**
 * Enumerate a directory tree without following symlinks.
 *
 * `lstat` is used throughout: a symlink is observed as a symlink, and the tree it
 * points at — which may be outside the root, or a cycle — is never walked.
 */
function enumerateDirectory(root, omit, diagnostics, omittedPaths, skippedDirs) {
    const out = [];
    const visit = (directory) => {
        let names;
        try {
            names = fs.readdirSync(directory);
        }
        catch (error) {
            skippedDirs.push(`${toPosix(path.relative(root, directory)) || "."}: ${error.message}`);
            return;
        }
        for (const name of [...names].sort(ordering_1.compareCodePoints)) {
            const absolutePath = path.join(directory, name);
            const relativePath = toPosix(path.relative(root, absolutePath));
            if (omit.shouldOmit(relativePath)) {
                omittedPaths.push(relativePath);
                continue;
            }
            const entry = observeEntry(absolutePath, relativePath, diagnostics);
            if (entry === null)
                continue;
            if (entry.kind === "directory" && isLegacyGeneratedExtraction(absolutePath)) {
                omittedPaths.push(relativePath);
                diagnostics.push({
                    code: "local-source.legacy_extraction_excluded",
                    severity: "info",
                    message: "directory carries this tool's extraction-ownership marker beside its archive " +
                        "and is excluded as generated output",
                    sourcePath: relativePath,
                });
                continue;
            }
            out.push(entry);
            if (entry.kind === "directory")
                visit(absolutePath);
        }
    };
    visit(root);
    return out;
}
/**
 * Whether two observations of one file describe the same bytes still in place.
 *
 * Size first, then the finest mtime both sides actually recorded. When each
 * carries a nanosecond value that is the comparison, because a filesystem whose
 * millisecond tick is coarser than a write can hide an entire rewrite inside one
 * equal `mtimeMs`. Falling back to milliseconds only when either side lacks the
 * finer value keeps platforms that report no nanosecond mtime behaving exactly
 * as before.
 *
 * Every phase that asks "did this file hold still" asks it here. The question was
 * previously answered in three places against `mtimeMs` alone, so the entry-set
 * check, the during-hash recheck and the final stability sweep could each reach a
 * different verdict about the same file.
 */
function observedFileStateMatches(before, after) {
    if (before.sizeBytes !== after.sizeBytes)
        return false;
    if (before.mtimeNs !== null && after.mtimeNs !== null)
        return before.mtimeNs === after.mtimeNs;
    return before.mtimeMs === after.mtimeMs;
}
/** Compare two enumerations for the entry-set and per-entry stability checks. */
function enumerationDiffers(before, after) {
    if (before.length !== after.length) {
        return `entry count changed from ${before.length} to ${after.length}`;
    }
    const byPath = new Map(after.map((entry) => [entry.relativePath, entry]));
    for (const entry of before) {
        const later = byPath.get(entry.relativePath);
        if (later === undefined)
            return `entry disappeared during observation: ${entry.relativePath}`;
        if (later.kind !== entry.kind)
            return `entry kind changed during observation: ${entry.relativePath}`;
        if (later.sizeBytes !== entry.sizeBytes)
            return `file size changed during observation: ${entry.relativePath}`;
        if (!observedFileStateMatches(entry, later))
            return `file mtime changed during observation: ${entry.relativePath}`;
    }
    return null;
}
// ───────────────────────────── record construction ─────────────────────────────
function inventoryIdFor(relativePath) {
    return "inv-" + crypto.createHash("sha256").update(relativePath, "utf8").digest("hex").slice(0, 16);
}
function buildLocalRecord(draft) {
    const relative = draft.relativePath;
    const fileName = relative.includes("/") ? relative.slice(relative.lastIndexOf("/") + 1) : relative;
    const isDir = draft.kind === "directory";
    const extension = isDir ? "" : path.extname(fileName);
    const classified = (0, inventory_1.classifyInventory)(relative, fileName, extension, isDir);
    const parent = relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "";
    return {
        artifact_id: inventoryIdFor(relative),
        source_system: "local",
        // Absolute paths are carried for readers that must open the bytes; they are
        // never part of identity and never reach a packet.
        absolute_path: draft.absolutePath,
        relative_path: relative,
        file_name: fileName,
        extension: extension || null,
        artifact_type: draft.artifactTypeOverride ?? classified.type,
        mime_type: isDir ? "inode/directory" : null,
        size_bytes: draft.sizeBytes,
        // Modification time is deliberately absent: it is machine state, not evidence.
        modified_at: null,
        content_hash: draft.contentHash,
        parent_folder: parent === "" ? null : parent,
        depth: relative === "." ? 0 : relative.split("/").length,
        classification_confidence: draft.confidenceOverride ?? classified.confidence,
        evidence_excerpt: draft.evidenceOverride ?? classified.evidence,
        unknowns: draft.unknowns,
        created_at: null,
    };
}
function holdArchive(context, task, contentHash, sizeBytes, holds) {
    context.archives.push({
        sourcePath: task.sourcePath,
        contentHash,
        sizeBytes,
        nestedDepth: task.depth,
        parentArchiveHash: task.parentArchiveHash,
        parentArchivePath: task.parentArchivePath,
        expanded: false,
        memberCount: 0,
        omittedMemberCount: 0,
        holds,
    });
    for (const hold of holds) {
        context.diagnostics.push({
            code: hold.code,
            severity: "warning",
            message: hold.message,
            sourcePath: hold.memberPath
                ? `${task.sourcePath}${exports.ARCHIVE_MEMBER_SEPARATOR}${(0, archive_preflight_1.canonicalMemberPath)(hold.memberPath)}`
                : task.sourcePath,
        });
    }
    context.diagnostics.push({
        code: "local-source.archive_held",
        severity: "warning",
        message: `archive was observed and hashed but not expanded; ${holds.length} preflight or budget ` +
            "violation(s) were recorded and no member is claimed as observed",
        sourcePath: task.sourcePath,
    });
}
/**
 * Directory under scratch where one archive's members are staged.
 *
 * Keyed by the archive's position in this run as well as its digest. Two archives
 * in the same source can hold identical bytes, and a digest-only key would alias
 * their staging: discarding one held archive's partial staging would then delete
 * the other's already-extracted members, leaving records pointing at files that
 * no longer exist.
 */
function memberStagingRoot(scratchRoot, archiveHash, occurrence) {
    return path.join(scratchRoot, "members", `${occurrence}-${archiveHash.replace("sha256:", "")}`);
}
function extractMembers(context, task, archiveHash, occurrence, preflight) {
    const stagingRoot = memberStagingRoot(context.scratch.root, archiveHash, occurrence);
    const members = [];
    let expandedBytes = 0;
    const remainingSessionBytes = context.budget.remainingBytes();
    for (const member of preflight.members) {
        const virtualPath = `${task.sourcePath}${exports.ARCHIVE_MEMBER_SEPARATOR}${member.canonicalPath}`;
        if (context.omit.shouldOmit(virtualPath) || context.omit.shouldOmit(member.canonicalPath)) {
            context.omittedPaths.push(virtualPath);
            continue;
        }
        const stagedPath = path.join(stagingRoot, ...member.canonicalPath.split("/"));
        fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
        const hash = crypto.createHash("sha256");
        // The ceiling handed to the extractor is the smallest of every applicable
        // budget, so a member that lies about its declared size still cannot exceed
        // the per-member, per-archive, or session allowance.
        const ceiling = Math.min(context.policy.maxSingleMemberUncompressedBytes, Math.max(0, context.policy.maxTotalUncompressedBytesPerArchive - expandedBytes), Math.max(0, remainingSessionBytes - expandedBytes));
        let handle = null;
        try {
            handle = fs.openSync(stagedPath, "w");
            const fd = handle;
            const result = (0, zip_reader_1.streamZipMember)(task.physicalPath, member.entry, { maxUncompressedBytes: ceiling }, (chunk) => {
                hash.update(chunk);
                fs.writeSync(fd, chunk);
            });
            if (result.crc32 !== member.entry.crc32) {
                return {
                    members,
                    expandedBytes,
                    failure: {
                        code: "archive.member_integrity_failed",
                        memberPath: member.canonicalPath,
                        message: "extracted member bytes do not match the CRC recorded in the central directory",
                    },
                };
            }
            expandedBytes += result.bytesWritten;
            members.push({
                virtualSourcePath: virtualPath,
                memberPath: member.canonicalPath,
                contentHash: sha256Prefixed(hash.digest("hex")),
                sizeBytes: result.bytesWritten,
                parentArchiveHash: archiveHash,
                parentArchivePath: task.sourcePath,
                nestedDepth: task.depth,
                compressionMethod: member.entry.compressionMethod,
                crc32: result.crc32,
                stagedPath,
            });
        }
        catch (error) {
            const budgetFailure = error instanceof zip_reader_1.ZipBudgetExceededError;
            return {
                members,
                expandedBytes,
                failure: {
                    code: budgetFailure ? "archive.extracted_bytes_exceeded" : "archive.format_unreadable",
                    memberPath: member.canonicalPath,
                    message: error instanceof Error ? error.message : String(error),
                },
            };
        }
        finally {
            if (handle !== null)
                fs.closeSync(handle);
        }
    }
    return { members, expandedBytes, failure: null };
}
/** Discard a held archive's partial staging so no member is left behind. */
function discardStaging(context, archiveHash, occurrence) {
    const stagingRoot = memberStagingRoot(context.scratch.root, archiveHash, occurrence);
    // Contained by construction: `stagingRoot` is always built from the scratch root
    // this session created, never from a path derived from the source.
    if (!stagingRoot.startsWith(context.scratch.root + path.sep))
        return;
    fs.rmSync(stagingRoot, { recursive: true, force: true });
}
function isZipPath(value) {
    return ZIP_EXTENSIONS.has(path.extname(value).toLowerCase());
}
/**
 * Copy an archive into scratch and hash it in one streaming pass.
 *
 * One pass means the digest describes exactly the bytes preflight and extraction
 * will read, closing the window in which a source file replaced between hashing
 * and parsing would be reported under a digest that no longer matches it.
 */
function stageArchive(context, task, occurrence) {
    const stagedArchiveDir = path.join(context.scratch.root, "archives");
    fs.mkdirSync(stagedArchiveDir, { recursive: true });
    const stagingTarget = path.join(stagedArchiveDir, `pending-${occurrence}.zip`);
    const hash = crypto.createHash("sha256");
    const source = fs.openSync(task.physicalPath, "r");
    const target = fs.openSync(stagingTarget, "w");
    let sizeBytes;
    try {
        const buffer = Buffer.alloc(HASH_CHUNK_BYTES);
        let position = 0;
        for (;;) {
            const count = fs.readSync(source, buffer, 0, buffer.length, position);
            if (count === 0)
                break;
            if (position + count > context.policy.maxArchiveCompressedBytes) {
                throw new zip_reader_1.ZipBudgetExceededError(`archive exceeds the ${context.policy.maxArchiveCompressedBytes}-byte staging limit`);
            }
            hash.update(buffer.subarray(0, count));
            fs.writeSync(target, buffer.subarray(0, count));
            position += count;
        }
        sizeBytes = position;
    }
    catch (error) {
        fs.rmSync(stagingTarget, { force: true });
        throw error;
    }
    finally {
        fs.closeSync(source);
        fs.closeSync(target);
    }
    const archiveHash = sha256Prefixed(hash.digest("hex"));
    const stagedPath = path.join(stagedArchiveDir, `${archiveHash.replace("sha256:", "")}.zip`);
    if (fs.existsSync(stagedPath))
        fs.rmSync(stagingTarget, { force: true });
    else
        fs.renameSync(stagingTarget, stagedPath);
    return { stagedPath, archiveHash, sizeBytes };
}
/** Record an archive that could not even be staged or hashed. */
function recordUnstageableArchive(context, task, error) {
    const message = error instanceof Error ? error.message : String(error);
    context.archives.push({
        sourcePath: task.sourcePath,
        contentHash: "Unknown",
        sizeBytes: 0,
        nestedDepth: task.depth,
        parentArchiveHash: task.parentArchiveHash,
        parentArchivePath: task.parentArchivePath,
        expanded: false,
        memberCount: 0,
        omittedMemberCount: 0,
        holds: [{ code: "archive.format_unreadable", message }],
    });
    context.diagnostics.push({
        code: "archive.format_unreadable",
        severity: "warning",
        message: `archive could not be staged: ${message}`,
        sourcePath: task.sourcePath,
    });
}
/** Queue nested archives found among a freshly expanded archive's members. */
function enqueueNestedArchives(context, task, archiveHash, members, queue) {
    for (const member of members) {
        if (isZipPath(member.memberPath)) {
            if (task.depth + 1 > context.policy.maxNestedDepth) {
                context.diagnostics.push({
                    code: "archive.nesting_depth_exceeded",
                    severity: "warning",
                    message: `nested archive is deeper than the limit of ${context.policy.maxNestedDepth} and was not expanded`,
                    sourcePath: member.virtualSourcePath,
                });
                continue;
            }
            queue.push({
                physicalPath: member.stagedPath,
                sourcePath: member.virtualSourcePath,
                depth: task.depth + 1,
                parentArchiveHash: archiveHash,
                parentArchivePath: task.sourcePath,
                // Produced by this run rather than observed, so there is no prior digest
                // to hold it to.
                expectedArchiveHash: null,
            });
            continue;
        }
        const extension = path.extname(member.memberPath).toLowerCase();
        if (KNOWN_UNEXPANDABLE_ARCHIVE_EXTENSIONS.has(extension)) {
            context.diagnostics.push({
                code: "archive.format_not_expanded",
                severity: "info",
                message: `${extension} is classified as an archive but v1 expands ZIP only; it is hashed and not opened`,
                sourcePath: member.virtualSourcePath,
            });
        }
    }
}
/** Read the staged archive's central directory and judge it, or hold it. */
function preflightStaged(context, task, staged) {
    // Depth is part of what preflight decides on, and it is not part of the key:
    // the same archive nested one level deeper is a different question. Only a
    // top-level archive is served from the store, where depth is fixed at 0.
    const cacheKey = task.depth === 0
        ? {
            archiveContentHash: staged.archiveHash,
            readerVersion: exports.ARCHIVE_READER_VERSION,
            policyFingerprint: (0, local_archive_policy_1.localArchivePolicyFingerprint)(context.policy),
        }
        : null;
    const cached = cacheKey === null ? undefined : context.manifests?.get(cacheKey);
    if (cached !== undefined) {
        if (!cached.accepted) {
            holdArchive(context, task, staged.archiveHash, staged.sizeBytes, cached.holds);
            return null;
        }
        const refusal = context.budget.refuseReason(cached.declaredUncompressedBytes);
        if (refusal !== null) {
            holdArchive(context, task, staged.archiveHash, staged.sizeBytes, [{
                    code: "archive.session_budget_exceeded",
                    message: refusal,
                }]);
            return null;
        }
        return cached;
    }
    let preflight;
    try {
        preflight = (0, archive_preflight_1.preflightArchive)({
            directory: (0, zip_reader_1.readZipCentralDirectory)(staged.stagedPath),
            policy: context.policy,
            depth: task.depth,
            archiveCompressedBytes: staged.sizeBytes,
        });
    }
    catch (error) {
        holdArchive(context, task, staged.archiveHash, staged.sizeBytes, [{
                code: "archive.format_unreadable",
                message: `central directory could not be read: ${error instanceof Error ? error.message : String(error)}`,
            }]);
        return null;
    }
    // Stored before the session budget is consulted: the verdict is a fact about
    // the archive, while the budget is a fact about this run, and mixing them would
    // cache one run's exhaustion as another run's refusal.
    if (cacheKey !== null)
        context.manifests?.put(cacheKey, preflight);
    if (!preflight.accepted) {
        holdArchive(context, task, staged.archiveHash, staged.sizeBytes, preflight.holds);
        return null;
    }
    const sessionRefusal = context.budget.refuseReason(preflight.declaredUncompressedBytes);
    if (sessionRefusal !== null) {
        holdArchive(context, task, staged.archiveHash, staged.sizeBytes, [{
                code: "archive.session_budget_exceeded",
                message: sessionRefusal,
            }]);
        return null;
    }
    return preflight;
}
/**
 * Stage, preflight and expand one archive, queueing any nested archive it holds.
 *
 * The archive is read from a staged immutable copy rather than from the live
 * source file, so the digest, the preflight verdict and the extracted bytes all
 * describe the same content.
 */
function acquireArchive(context, task, queue) {
    // Position of this archive in the run. Distinguishes two archives that hold
    // identical bytes, which share a digest but must not share staging.
    const occurrence = context.archives.length;
    let staged;
    try {
        staged = stageArchive(context, task, occurrence);
    }
    catch (error) {
        recordUnstageableArchive(context, task, error);
        return;
    }
    // The snapshot hashed this path and staging read it again. If the two reads
    // disagree the file was replaced between them, and everything downstream --
    // the preflight verdict, the member digests, the cache entry keyed on these
    // bytes -- would describe an archive that is no longer there. Hold it, claim
    // no member, and make the whole observation unstable: there is no single
    // snapshot left to describe.
    if (task.expectedArchiveHash !== null && task.expectedArchiveHash !== staged.archiveHash) {
        context.sourceChanged.push(`${task.sourcePath}: archive bytes changed between hashing and staging`);
        context.diagnostics.push({
            code: "local-source.source_changed_during_observation",
            severity: "error",
            message: "SOURCE_CHANGED_DURING_OBSERVATION: "
                + `${task.sourcePath}: archive bytes changed between hashing and staging `
                + `(snapshot ${task.expectedArchiveHash}, staged ${staged.archiveHash})`,
        });
        holdArchive(context, task, staged.archiveHash, staged.sizeBytes, [{
                // The archive's bytes did not match the digest recorded for them, which is
                // precisely an integrity failure. archive_preflight owns this vocabulary and
                // is consume-only, so no new code is minted for the same meaning.
                code: "archive.member_integrity_failed",
                message: "archive bytes changed between hashing and staging; no member is claimed",
            }]);
        return;
    }
    const preflight = preflightStaged(context, task, staged);
    if (preflight === null)
        return;
    const extraction = extractMembers(context, task, staged.archiveHash, occurrence, preflight);
    if (extraction.failure !== null) {
        // A partial expansion is never claimed: everything staged for this archive is
        // discarded so no member can be reported from a run that did not complete.
        discardStaging(context, staged.archiveHash, occurrence);
        holdArchive(context, task, staged.archiveHash, staged.sizeBytes, [extraction.failure]);
        return;
    }
    context.budget.recordArchive(extraction.expandedBytes);
    context.archives.push({
        sourcePath: task.sourcePath,
        contentHash: staged.archiveHash,
        sizeBytes: staged.sizeBytes,
        nestedDepth: task.depth,
        parentArchiveHash: task.parentArchiveHash,
        parentArchivePath: task.parentArchivePath,
        expanded: true,
        memberCount: extraction.members.length,
        omittedMemberCount: preflight.members.length - extraction.members.length,
        holds: [],
    });
    context.members.push(...extraction.members);
    enqueueNestedArchives(context, task, staged.archiveHash, extraction.members, queue);
}
// ───────────────────────────── acquisition ─────────────────────────────
function resolveSourceKind(absolutePath, requested) {
    const stats = fs.lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
        throw new Error(`local-source: the source path is a symbolic link and is never followed: ${absolutePath}`);
    }
    const nonDirectoryKind = isZipPath(absolutePath) ? "archive" : "file";
    const actual = stats.isDirectory() ? "directory" : nonDirectoryKind;
    if (requested === "auto" || requested === undefined)
        return actual;
    if (requested === "directory" && !stats.isDirectory()) {
        throw new Error(`local-source: --source-kind directory was requested but the path is not a directory`);
    }
    if (requested !== "directory" && stats.isDirectory()) {
        throw new Error(`local-source: --source-kind ${requested} was requested but the path is a directory`);
    }
    return requested;
}
function buildAcquisitionOmit(input, omitRoot) {
    if (input.omit)
        return input.omit;
    return (0, omit_1.buildOmitMatcher)({
        root: omitRoot,
        patterns: [...exports.GENERATED_ARTIFACT_OMIT_PATTERNS, ...(input.omitPatterns ?? [])],
        ...(input.omitFile !== undefined ? { omitFile: input.omitFile } : {}),
        // SKILL.md is protected from mutation, not from observation. Acquisition never
        // mutates anything, and hiding a skill entrypoint would make the observation
        // silently incomplete.
        protectSkillMd: false,
        ignoreDirNames: [".git", "node_modules"],
    });
}
/**
 * The finest mtime the platform will give for this file, as a decimal string.
 *
 * Millisecond mtime is a coarse revalidation signal: on a filesystem with a 1 ms
 * or worse timestamp granularity, a rewrite within the same tick is invisible to
 * it. `bigint` stats expose the nanosecond field where the platform keeps one,
 * which narrows that window without closing it — which is why reuse is still
 * disclosed rather than trusted.
 */
function highResolutionMtime(absolutePath) {
    try {
        return fs.lstatSync(absolutePath, { bigint: true }).mtimeNs.toString();
    }
    catch {
        return null;
    }
}
/**
 * Hash every regular file, verifying that the file did not change underneath the
 * read. A file whose size or mtime moved across its own hash is re-read a bounded
 * number of times before the observation is declared unstable.
 */
/**
 * Hash one file, verifying it did not change underneath the read.
 *
 * Returns the digest, or the reason it could not be produced. `changed` marks the
 * case that must make the whole observation unstable rather than degrade one entry:
 * a file that moved across its own hash after a bounded retry.
 */
function hashStableFile(entry) {
    let reason = "";
    for (let attempt = 0; attempt <= STABILITY_RETRY_LIMIT; attempt++) {
        let before;
        let beforeNs;
        try {
            before = fs.lstatSync(entry.absolutePath);
            beforeNs = highResolutionMtime(entry.absolutePath);
        }
        catch (error) {
            return { digest: null, reason: error.message, changed: false };
        }
        let candidate;
        try {
            candidate = hashFileStreaming(entry.absolutePath).hash;
        }
        catch (error) {
            return { digest: null, reason: error.message, changed: false };
        }
        const after = fs.lstatSync(entry.absolutePath);
        const matches = observedFileStateMatches({ sizeBytes: before.size, mtimeMs: before.mtimeMs, mtimeNs: beforeNs }, { sizeBytes: after.size, mtimeMs: after.mtimeMs, mtimeNs: highResolutionMtime(entry.absolutePath) });
        if (matches) {
            return { digest: candidate, reason: "", changed: false };
        }
        reason = "file changed while it was being hashed";
    }
    return { digest: null, reason, changed: true };
}
/**
 * Whether a prior hash may stand in for reading this file's bytes.
 *
 * Every recorded stat field must match, and the finest one available decides: if
 * both runs recorded a nanosecond mtime, a millisecond agreement is not enough.
 * A prior record with no hash, or one that never saw this path, is not a match —
 * absence is not evidence of sameness.
 */
function priorHashStillApplies(entry, known) {
    if (known === undefined)
        return false;
    if (entry.sizeBytes === null || known.size_bytes !== entry.sizeBytes)
        return false;
    if (known.mtime_ns !== undefined && entry.mtimeNs !== null)
        return known.mtime_ns === entry.mtimeNs;
    return entry.mtimeMs !== null && known.mtime_ms === entry.mtimeMs;
}
/**
 * Record that a file is not valid UTF-8, when the probe found that.
 *
 * Called from both the freshly-hashed path and the path that carries a prior
 * run's hash forward, because the observation belongs to the file rather than to
 * how its hash was obtained. Recorded in only one of the two, an incremental scan
 * of an unchanged disk holding a single Word document produced an inventory that
 * omitted a fact the full scan of the same bytes recorded — and since the
 * inventory is part of the Repository Model Packet, the packet's semantic hash
 * and therefore the corpus source snapshot id moved for a corpus nobody had
 * touched. Reuse is only worth having if it lands on the same answer.
 */
function noteUnsupportedEncoding(entry, encoding, unknowns, diagnostics) {
    if (encoding.status !== "invalid")
        return;
    unknowns.push("unsupported_encoding");
    diagnostics.push({
        code: "local-source.unsupported_encoding",
        severity: "warning",
        message: `file is not valid UTF-8 and is observed by hash only: ${encoding.reason}`,
        sourcePath: entry.relativePath,
    });
}
/** Hash one entry and classify its encoding, or explain why neither happened. */
function hashOneEntry(entry, hashMaxBytes, diagnostics, known) {
    const unknowns = [];
    if (hashMaxBytes !== undefined && (entry.sizeBytes ?? 0) > hashMaxBytes) {
        unknowns.push("content_hash_skipped:file_exceeds_hash_budget");
        diagnostics.push({
            code: "local-source.hash_budget_exceeded",
            severity: "error",
            message: `file exceeds the ${hashMaxBytes}-byte hash budget, so its content hash is absent`,
            sourcePath: entry.relativePath,
        });
        return { hashed: { entry, contentHashHex: null, encoding: null, unknowns }, unstableReason: null };
    }
    if (priorHashStillApplies(entry, known)) {
        // The encoding probe still reads the file: it is a bounded prefix read rather
        // than a full stream, and skipping it would silently drop the "not UTF-8"
        // fact from an incremental run's inventory.
        const carried = known.content_hash;
        const encoding = (0, encoding_1.probeFileEncoding)(entry.absolutePath);
        noteUnsupportedEncoding(entry, encoding, unknowns, diagnostics);
        return {
            hashed: {
                entry,
                contentHashHex: carried.replace("sha256:", ""),
                encoding,
                unknowns,
                reused: true,
            },
            unstableReason: null,
        };
    }
    const attempt = hashStableFile(entry);
    if (attempt.digest === null) {
        if (attempt.changed) {
            return {
                hashed: { entry, contentHashHex: null, encoding: null, unknowns },
                unstableReason: `${entry.relativePath}: ${attempt.reason}`,
            };
        }
        unknowns.push(`content_hash_unavailable:${attempt.reason}`);
        diagnostics.push({
            code: "local-source.file_unreadable",
            severity: "warning",
            message: `file could not be hashed: ${attempt.reason}`,
            sourcePath: entry.relativePath,
        });
        return { hashed: { entry, contentHashHex: null, encoding: null, unknowns }, unstableReason: null };
    }
    const encoding = (0, encoding_1.probeFileEncoding)(entry.absolutePath);
    noteUnsupportedEncoding(entry, encoding, unknowns, diagnostics);
    return {
        hashed: { entry, contentHashHex: attempt.digest.replace("sha256:", ""), encoding, unknowns },
        unstableReason: null,
    };
}
/**
 * Phase 2 — hash every regular file. Non-file entries pass through unhashed; a
 * file that changed across its own hash stops the pass and makes the observation
 * unstable, because there is no single snapshot left to describe.
 */
function hashEntries(entries, hashMaxBytes, diagnostics, knownHashes) {
    const hashed = [];
    const hashing = {
        fully_rehashed_count: 0,
        cached_reuse_count: 0,
        unhashed_count: 0,
    };
    for (const entry of entries) {
        if (entry.kind !== "file") {
            hashed.push({ entry, contentHashHex: null, encoding: null, unknowns: [] });
            continue;
        }
        const result = hashOneEntry(entry, hashMaxBytes, diagnostics, knownHashes?.get(entry.relativePath));
        if (result.unstableReason !== null)
            return { hashed, unstableReason: result.unstableReason, hashing };
        if (result.hashed.contentHashHex === null)
            hashing.unhashed_count += 1;
        else if (result.hashed.reused === true)
            hashing.cached_reuse_count += 1;
        else
            hashing.fully_rehashed_count += 1;
        hashed.push(result.hashed);
    }
    return { hashed, unstableReason: null, hashing };
}
function revisionFor(sourceKind, digest) {
    const bare = digest.replace("sha256:", "");
    if (sourceKind === "file")
        return `file:sha256:${bare}`;
    if (sourceKind === "archive")
        return `archive:sha256:${bare}`;
    return `fs:sha256:${bare}`;
}
/** Phase 1 — enumerate the source. A single file is its own one-entry enumeration. */
function enumerateSource(absoluteSource, sourceKind, omit, diagnostics, omittedPaths, skippedDirs) {
    if (sourceKind === "directory") {
        return enumerateDirectory(absoluteSource, omit, diagnostics, omittedPaths, skippedDirs);
    }
    const stats = fs.lstatSync(absoluteSource);
    return [{
            absolutePath: absoluteSource,
            relativePath: path.basename(absoluteSource),
            kind: "file",
            sizeBytes: stats.size,
            mtimeMs: stats.mtimeMs,
            mtimeNs: highResolutionMtime(absoluteSource),
            linkTarget: null,
        }];
}
/**
 * Phase 3 — re-enumerate and compare. Returns why the snapshot is not trustworthy,
 * or null when the source held still for the whole observation.
 */
function verifySnapshotStability(absoluteSource, sourceKind, entries, omit) {
    if (sourceKind === "directory") {
        return enumerationDiffers(entries, enumerateDirectory(absoluteSource, omit, [], [], []));
    }
    const after = fs.lstatSync(absoluteSource);
    const stillThere = observedFileStateMatches(entries[0], {
        sizeBytes: after.size,
        mtimeMs: after.mtimeMs,
        mtimeNs: highResolutionMtime(absoluteSource),
    });
    if (!stillThere) {
        return `${entries[0].relativePath}: file changed while it was being observed`;
    }
    return null;
}
/**
 * Derive the snapshot digest and the source revision.
 *
 * Archive members are semantic content, not part of the physical snapshot, so this
 * runs before any archive work and sees only what is actually on the filesystem.
 */
function deriveSourceIdentity(hashed, sourceKind) {
    const manifestEntries = hashed.map(({ entry, contentHashHex }) => ({
        path: entry.relativePath,
        kind: entry.kind,
        ...(contentHashHex !== null ? { contentHash: sha256Prefixed(contentHashHex) } : {}),
        ...(entry.linkTarget !== null ? { linkTarget: entry.linkTarget } : {}),
    }));
    const physicalSnapshotHash = physicalManifestDigest(manifestEntries);
    const singleFileHash = hashed.length === 1 ? hashed[0].contentHashHex : null;
    const useFileHash = sourceKind !== "directory" && singleFileHash !== null;
    return {
        physicalSnapshotHash,
        sourceRevision: revisionFor(sourceKind, useFileHash ? singleFileHash : physicalSnapshotHash),
    };
}
/** Queue the ZIP archives to expand, reporting the formats v1 does not open. */
function planArchiveTasks(hashed, diagnostics) {
    const queue = [];
    for (const { entry, contentHashHex } of hashed) {
        if (entry.kind !== "file")
            continue;
        if (isZipPath(entry.relativePath)) {
            queue.push({
                physicalPath: entry.absolutePath,
                sourcePath: entry.relativePath,
                depth: 0,
                parentArchiveHash: null,
                parentArchivePath: null,
                expectedArchiveHash: contentHashHex === null ? null : sha256Prefixed(contentHashHex),
            });
            continue;
        }
        const extension = path.extname(entry.relativePath).toLowerCase();
        if (KNOWN_UNEXPANDABLE_ARCHIVE_EXTENSIONS.has(extension)) {
            diagnostics.push({
                code: "archive.format_not_expanded",
                severity: "info",
                message: `${extension} is classified as an archive but v1 expands ZIP only; it is hashed and not opened`,
                sourcePath: entry.relativePath,
            });
        }
    }
    return queue;
}
/** Report each archive left unopened because expansion was disabled. */
function reportDisabledExpansion(hashed, diagnostics) {
    for (const { entry } of hashed) {
        if (entry.kind !== "file" || !isZipPath(entry.relativePath))
            continue;
        diagnostics.push({
            code: "local-source.archive_expansion_disabled",
            severity: "info",
            message: "archive expansion is disabled; the archive is hashed and its members are not observed",
            sourcePath: entry.relativePath,
        });
    }
}
/** Diagnose an entry that is observed but deliberately never opened. */
function reportUnopenedEntry(entry, diagnostics) {
    if (entry.kind === "symlink") {
        diagnostics.push({
            code: "local-source.symlink_not_traversed",
            severity: "info",
            message: entry.linkTarget === null
                ? "symbolic link observed; its target was not read"
                : `symbolic link observed; its literal target is '${entry.linkTarget}' and was not read`,
            sourcePath: entry.relativePath,
        });
        return;
    }
    if (entry.kind === "special") {
        diagnostics.push({
            code: "local-source.special_entry_observed",
            severity: "info",
            message: "filesystem entry is a device, socket or FIFO; it is recorded but never opened",
            sourcePath: entry.relativePath,
        });
    }
}
/** The record for one physical entry, including the unknowns its kind implies. */
function physicalRecord(hashedEntry) {
    const { entry, contentHashHex, encoding, unknowns } = hashedEntry;
    const entryUnknowns = [...unknowns];
    if (entry.kind === "symlink")
        entryUnknowns.push("symlink_not_traversed");
    if (entry.kind === "special")
        entryUnknowns.push("special_filesystem_entry");
    if (encoding !== null && encoding.status === "binary")
        entryUnknowns.push("binary_content");
    // A link and a device were both observed without being read, so neither carries a
    // classification derived from content.
    const unopened = entry.kind === "symlink" || entry.kind === "special";
    return buildLocalRecord({
        relativePath: entry.relativePath,
        absolutePath: entry.absolutePath,
        kind: entry.kind,
        sizeBytes: entry.sizeBytes,
        contentHash: contentHashHex,
        unknowns: entryUnknowns,
        ...(unopened
            ? {
                artifactTypeOverride: "unknown",
                evidenceOverride: entry.kind === "symlink"
                    ? "symbolic link, not traversed"
                    : "special filesystem entry, not opened",
                confidenceOverride: 1,
            }
            : {}),
    });
}
/** Physical entries and virtual archive members, in one code-point-ordered set. */
function buildRecords(hashed, members, diagnostics) {
    const records = [];
    for (const hashedEntry of hashed) {
        reportUnopenedEntry(hashedEntry.entry, diagnostics);
        records.push(physicalRecord(hashedEntry));
    }
    for (const member of members) {
        records.push(buildLocalRecord({
            relativePath: member.virtualSourcePath,
            absolutePath: member.stagedPath,
            kind: "archive-member",
            sizeBytes: member.sizeBytes,
            contentHash: member.contentHash.replace("sha256:", ""),
            unknowns: [],
        }));
    }
    return records.sort((a, b) => (0, ordering_1.compareCodePoints)(a.relative_path, b.relative_path));
}
/** Assemble the inventory view the packet builder and interpretation consume. */
function buildInventoryResult(root, records, skippedDirs, omittedPaths) {
    const typeDistribution = {};
    let files = 0, folders = 0;
    for (const record of records) {
        typeDistribution[record.artifact_type] = (typeDistribution[record.artifact_type] ?? 0) + 1;
        if (record.artifact_type === "folder")
            folders++;
        else
            files++;
    }
    return {
        root,
        total: records.length,
        files,
        folders,
        typeDistribution,
        // Acquisition writes no manifests of its own; the CLI owns output placement.
        manifestPaths: { json: "", csv: "", md: "", duplicates: "" },
        // Clustered over the complete record set — physical entries and virtual
        // archive members together. Leaving this empty, as acquisition used to, meant
        // a file and its copy inside a ZIP were never seen as the same bytes, which
        // is the single most common shape a real corpus has.
        duplicates: (0, inventory_1.buildDuplicateClusters)(records),
        records,
        skippedDirs,
        omittedPaths: [...omittedPaths].sort(ordering_1.compareCodePoints),
    };
}
/** Total order over diagnostics, so a packet's diagnostic list is reproducible. */
function compareDiagnostics(a, b) {
    return (0, ordering_1.compareCodePoints)(a.code, b.code)
        || (0, ordering_1.compareCodePoints)(a.sourcePath ?? "", b.sourcePath ?? "")
        || (0, ordering_1.compareCodePoints)(a.message, b.message);
}
/**
 * Observe a local source read-only and return everything a deterministic packet
 * needs: a stable snapshot identity, per-entry evidence, virtual archive members
 * with exact hashes, and the provenance that binds each member to its archive.
 *
 * The caller owns the returned observation's lifetime and must call `dispose()`
 * once the staged member bytes are no longer needed.
 */
function acquireLocalSource(input) {
    const absoluteSource = path.resolve(input.path);
    if (!fs.existsSync(absoluteSource)) {
        throw new Error(`local-source: path does not exist: ${absoluteSource}`);
    }
    const sourceKind = resolveSourceKind(absoluteSource, input.sourceKind ?? "auto");
    const sourceName = input.name && input.name.length > 0 ? input.name : path.basename(absoluteSource);
    // The single resolution point shared with the materialization path: one policy
    // and one session budget judge every archive, on both paths.
    const { policy, budget } = (0, archive_execution_1.resolveArchiveExecution)(input.archivePolicy);
    const omitRoot = sourceKind === "directory" ? absoluteSource : path.dirname(absoluteSource);
    const omit = buildAcquisitionOmit(input, omitRoot);
    const diagnostics = [];
    const omittedPaths = [];
    const skippedDirs = [];
    // Enumerate, hash, then re-enumerate. A source that moved between the first and
    // last read has no single snapshot to describe, and saying so is the whole point.
    const entries = enumerateSource(absoluteSource, sourceKind, omit, diagnostics, omittedPaths, skippedDirs);
    const { hashed, unstableReason: hashUnstable, hashing } = hashEntries(entries, input.hashMaxBytes, diagnostics, input.knownHashes);
    const unstableReason = hashUnstable
        ?? verifySnapshotStability(absoluteSource, sourceKind, entries, omit);
    if (unstableReason !== null) {
        diagnostics.push({
            code: "local-source.source_changed_during_observation",
            severity: "error",
            message: `SOURCE_CHANGED_DURING_OBSERVATION: ${unstableReason}`,
        });
    }
    const identity = deriveSourceIdentity(hashed, sourceKind);
    const scratchParent = input.scratchParent ?? os.tmpdir();
    // Before createScratch, which is the first thing here that writes.
    assertScratchOutsideSource(scratchParent, absoluteSource, sourceKind);
    const scratch = createScratch(scratchParent);
    const archives = [];
    const members = [];
    // Archive expansion. A held archive still contributes its own observation.
    const expandArchives = input.expandArchives !== false;
    const archiveSourceChanged = [];
    if (!expandArchives) {
        reportDisabledExpansion(hashed, diagnostics);
    }
    else if (unstableReason === null) {
        const context = {
            scratch, policy, budget, omit, diagnostics, archives, members, omittedPaths,
            manifests: input.archiveManifests,
            sourceChanged: archiveSourceChanged,
        };
        const queue = planArchiveTasks(hashed, diagnostics);
        while (queue.length > 0)
            acquireArchive(context, queue.shift(), queue);
    }
    const records = buildRecords(hashed, members, diagnostics);
    for (const skipped of skippedDirs) {
        diagnostics.push({
            code: "local-source.directory_unreadable",
            severity: "error",
            message: `directory could not be read; its subtree is absent from this observation: ${skipped}`,
        });
    }
    return {
        sourceKind,
        sourceName,
        sourceRevision: identity.sourceRevision,
        physicalSnapshotHash: identity.physicalSnapshotHash,
        hashing,
        inventory: buildInventoryResult(absoluteSource, records, skippedDirs, omittedPaths),
        archives: [...archives].sort((a, b) => (0, ordering_1.compareCodePoints)(a.sourcePath, b.sourcePath)),
        virtualArtifacts: [...members].sort((a, b) => (0, ordering_1.compareCodePoints)(a.virtualSourcePath, b.virtualSourcePath)),
        diagnostics: [...diagnostics].sort(compareDiagnostics),
        archivePolicy: policy,
        stable: unstableReason === null && archiveSourceChanged.length === 0,
        scratchRoot: scratch.root,
        dispose: () => scratch.dispose(),
    };
}
//# sourceMappingURL=local_source.js.map