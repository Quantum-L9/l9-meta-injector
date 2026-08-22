"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalMemberPath = canonicalMemberPath;
exports.memberCollisionKey = memberCollisionKey;
exports.preflightArchive = preflightArchive;
const zip_reader_1 = require("./zip_reader");
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const NUL = "\u0000";
/**
 * Normalize a stored member name to a canonical POSIX path.
 *
 * Backslashes become separators first: a member named `..\escape.txt` is a
 * traversal on Windows, and treating the backslash as an ordinary filename
 * character would let it through the `..` check.
 *
 * `.` segments are dropped, because the canonical path decides both duplicate
 * detection and where a member is staged. Leaving them in would let `./a.txt`
 * and `a.txt` pass as two distinct members and then resolve to one staged file,
 * so the second would silently overwrite the first and the first member's
 * recorded digest would no longer describe the bytes on disk. `..` is preserved
 * so the traversal rule still sees it.
 */
function canonicalMemberPath(name) {
    const normalized = name.replace(/\\/g, "/");
    const segments = normalized.split("/").filter((segment) => segment !== "" && segment !== ".");
    const canonical = segments.join("/");
    // A leading separator is meaningful (it makes the path absolute) and must
    // survive normalization so the absolute-path rule can still reject it.
    return normalized.startsWith("/") ? `/${canonical}` : canonical;
}
/**
 * Collision key for a member path.
 *
 * NFC folds canonically equivalent spellings together (a precomposed `é` and
 * `e` plus a combining acute are the same filename on macOS), and the case fold
 * folds `A.txt` onto `a.txt`. Two members sharing a key cannot both be
 * materialized faithfully on every filesystem, so the archive is held rather
 * than resolved by whichever one happened to be written last.
 */
function memberCollisionKey(canonicalPath) {
    return canonicalPath.normalize("NFC").toLowerCase();
}
/** Resolve a canonical member path against an empty virtual root, purely textually. */
function resolvesInsideRoot(canonical) {
    const stack = [];
    for (const segment of canonical.split("/")) {
        if (segment === "" || segment === ".")
            continue;
        if (segment === "..") {
            if (stack.length === 0)
                return false;
            stack.pop();
            continue;
        }
        stack.push(segment);
    }
    return stack.length > 0;
}
function pathHolds(canonical, raw, policy) {
    const holds = [];
    const normalized = raw.replace(/\\/g, "/");
    if (raw.includes(NUL)) {
        holds.push({ code: "archive.path_nul", memberPath: raw.replace(/\u0000/g, "?"), message: "member path contains a NUL character" });
    }
    if (raw.startsWith("\\\\") || normalized.startsWith("//")) {
        holds.push({ code: "archive.path_unc", memberPath: raw, message: "member path is a UNC path" });
    }
    else if (normalized.startsWith("/")) {
        holds.push({ code: "archive.path_absolute", memberPath: raw, message: "member path is absolute" });
    }
    if (WINDOWS_DRIVE.test(raw)) {
        holds.push({
            code: "archive.path_drive_absolute",
            memberPath: raw,
            message: "member path is a Windows drive-absolute path",
        });
    }
    if (normalized.split("/").includes("..")) {
        holds.push({ code: "archive.path_traversal", memberPath: raw, message: "member path contains a '..' component" });
    }
    if (canonical.length === 0) {
        holds.push({ code: "archive.path_empty", memberPath: raw, message: "member path is empty after normalization" });
    }
    if (raw.length > policy.maxPathLength) {
        holds.push({
            code: "archive.path_too_long",
            memberPath: raw.slice(0, 120),
            message: `member path exceeds the ${policy.maxPathLength}-character limit`,
        });
    }
    // Final containment check, independent of the component rules above: resolving
    // the canonical path against a virtual root must stay inside that root.
    if (canonical.length > 0 && !resolvesInsideRoot(canonical)) {
        holds.push({
            code: "archive.path_escapes_root",
            memberPath: raw,
            message: "member path resolves outside the archive's virtual root",
        });
    }
    return holds;
}
function entryKindHold(entry) {
    switch (entry.kind) {
        case "symlink":
            return {
                code: "archive.entry_symlink",
                memberPath: entry.name,
                message: "member is a symbolic link, which is never materialized",
            };
        case "special":
            return {
                code: "archive.entry_special",
                memberPath: entry.name,
                message: "member is a device, socket or FIFO entry",
            };
        case "unknown":
            return {
                code: "archive.entry_kind_unknown",
                memberPath: entry.name,
                message: "member declares a file type this reader does not recognize",
            };
        default:
            return null;
    }
}
/** Classify a collision between two canonical paths that share a fold key. */
function collisionHold(canonical, previous, rawName) {
    const sameAfterUnicodeFold = canonical.normalize("NFC") === previous.normalize("NFC");
    return {
        code: sameAfterUnicodeFold ? "archive.unicode_collision" : "archive.case_collision",
        memberPath: rawName,
        message: sameAfterUnicodeFold
            ? `member path is canonically equivalent to '${previous}' under Unicode normalization`
            : `member path collides with '${previous}' under a case fold`,
    };
}
/**
 * Judge an archive against every path, entry-type, encryption, compression,
 * collision and resource rule. Never touches the filesystem.
 */
function preflightArchive(input) {
    const { directory, policy } = input;
    const holds = [];
    const members = [];
    const directories = [];
    let declaredUncompressedBytes = 0;
    let declaredCompressedBytes = 0;
    if (input.depth > policy.maxNestedDepth) {
        holds.push({
            code: "archive.nesting_depth_exceeded",
            message: `archive nesting depth ${input.depth} exceeds the limit of ${policy.maxNestedDepth}`,
        });
    }
    if (directory.entries.length > policy.maxMemberCount) {
        holds.push({
            code: "archive.member_count_exceeded",
            message: `archive declares ${directory.entries.length} members, above the limit of ${policy.maxMemberCount}`,
        });
    }
    const seenExact = new Map();
    const seenCollision = new Map();
    for (const entry of directory.entries) {
        const canonical = canonicalMemberPath(entry.name);
        holds.push(...pathHolds(canonical, entry.name, policy));
        if (entry.encrypted) {
            holds.push({
                code: "archive.member_encrypted",
                memberPath: entry.name,
                message: "member is encrypted and cannot be observed",
            });
        }
        const kindHold = entryKindHold(entry);
        if (kindHold)
            holds.push(kindHold);
        // Collision keys cover every entry, directories included, so a directory that
        // shadows a file is caught too.
        if (canonical.length > 0) {
            const previousExact = seenExact.get(canonical);
            if (previousExact !== undefined) {
                holds.push({
                    code: "archive.duplicate_member",
                    memberPath: entry.name,
                    message: `member path is declared more than once (also '${previousExact}')`,
                });
            }
            else {
                seenExact.set(canonical, entry.name);
                const key = memberCollisionKey(canonical);
                const previousCollision = seenCollision.get(key);
                if (previousCollision !== undefined)
                    holds.push(collisionHold(canonical, previousCollision, entry.name));
                else
                    seenCollision.set(key, canonical);
            }
        }
        if (entry.kind === "directory") {
            if (canonical.length > 0)
                directories.push(canonical);
            continue;
        }
        if (entry.kind !== "file")
            continue;
        if (entry.compressionMethod !== zip_reader_1.COMPRESSION_STORED && entry.compressionMethod !== zip_reader_1.COMPRESSION_DEFLATE) {
            holds.push({
                code: "archive.compression_unsupported",
                memberPath: entry.name,
                message: `member uses unsupported compression method ${entry.compressionMethod}`,
            });
        }
        if (entry.uncompressedSize > policy.maxSingleMemberUncompressedBytes) {
            holds.push({
                code: "archive.member_too_large",
                memberPath: entry.name,
                message: `member declares ${entry.uncompressedSize} uncompressed bytes, ` +
                    `above the per-member limit of ${policy.maxSingleMemberUncompressedBytes}`,
            });
        }
        declaredUncompressedBytes += entry.uncompressedSize;
        declaredCompressedBytes += entry.compressedSize;
        members.push({ canonicalPath: canonical, entry });
    }
    if (declaredUncompressedBytes > policy.maxTotalUncompressedBytesPerArchive) {
        holds.push({
            code: "archive.total_uncompressed_exceeded",
            message: `archive declares ${declaredUncompressedBytes} uncompressed bytes, ` +
                `above the per-archive limit of ${policy.maxTotalUncompressedBytesPerArchive}`,
        });
    }
    // The ratio is measured against the archive file on disk, headers included, so a
    // small archive of highly compressible data is judged on what it actually costs.
    const ratio = declaredUncompressedBytes / Math.max(1, input.archiveCompressedBytes);
    if (ratio > policy.maxCompressionRatio) {
        holds.push({
            code: "archive.compression_ratio_exceeded",
            message: `archive expands ${ratio.toFixed(1)}:1, above the limit of ${policy.maxCompressionRatio}:1`,
        });
    }
    return {
        accepted: holds.length === 0,
        holds,
        members,
        directories,
        declaredUncompressedBytes,
        declaredCompressedBytes,
    };
}
//# sourceMappingURL=archive_preflight.js.map