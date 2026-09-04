// archive_preflight.ts — decide an archive's fate before any byte is written.
//
// Preflight answers one question over the complete central directory: may this
// archive be expanded at all? It is deliberately all-or-nothing. Expanding the
// safe members of an archive that also contains a Zip-Slip path would claim a
// partial view as an observation, and a consumer cannot tell a partial view from
// a complete one. So a single violation holds the whole archive: the archive is
// still observed, hashed and reported, but none of its members are claimed.
//
// Filesystem behavior never decides member identity here. Collisions are computed
// from Unicode normalization and a deterministic case fold rather than from what
// the host filesystem happens to do, so the same archive is judged identically on
// a case-sensitive and a case-insensitive machine.
import { LocalArchivePolicy } from "./local_archive_policy";
import {
  COMPRESSION_DEFLATE,
  COMPRESSION_STORED,
  ZipCentralEntry,
  ZipDirectory,
} from "./zip_reader";

/** Codes are stable identifiers; message text may change, codes may not. */
export type ArchiveHoldCode =
  | "archive.path_absolute"
  | "archive.path_drive_absolute"
  | "archive.path_unc"
  | "archive.path_traversal"
  | "archive.path_nul"
  | "archive.path_escapes_root"
  | "archive.path_too_long"
  | "archive.path_empty"
  | "archive.entry_symlink"
  | "archive.entry_special"
  | "archive.entry_kind_unknown"
  | "archive.member_encrypted"
  | "archive.compression_unsupported"
  | "archive.duplicate_member"
  | "archive.path_conflict"
  | "archive.case_collision"
  | "archive.unicode_collision"
  | "archive.member_count_exceeded"
  | "archive.member_too_large"
  | "archive.total_uncompressed_exceeded"
  | "archive.compression_ratio_exceeded"
  | "archive.nesting_depth_exceeded"
  | "archive.session_budget_exceeded"
  | "archive.extracted_bytes_exceeded"
  | "archive.member_integrity_failed"
  | "archive.format_unreadable"
  | "archive.format_not_expanded";

export interface ArchiveHold {
  code: ArchiveHoldCode;
  /** Member the violation was found on, when it is member-scoped. */
  memberPath?: string;
  message: string;
}

export interface PreflightMember {
  /** Canonical POSIX member path with no leading separator and no trailing slash. */
  canonicalPath: string;
  entry: ZipCentralEntry;
}

export interface ArchivePreflightResult {
  /** True when every rule passed and the archive may be expanded. */
  accepted: boolean;
  /** Violations that held the archive. Empty when accepted. */
  holds: ArchiveHold[];
  /** File members eligible for extraction, in central-directory order. */
  members: PreflightMember[];
  /** Directory entries, retained so an empty declared directory is still observable. */
  directories: string[];
  /** Sum of the declared uncompressed sizes of `members`. */
  declaredUncompressedBytes: number;
  /** Sum of the declared compressed sizes of `members`. */
  declaredCompressedBytes: number;
}

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const NUL = "\u0000";
/**
 * Longest single path component, in UTF-8 bytes, any mainstream filesystem will
 * store. The policy bounds the whole path; without this a member whose one
 * segment was longer than NAME_MAX passed preflight and failed at the host,
 * which turned a property of the archive into a host error mid-extraction.
 */
const MAX_SEGMENT_BYTES = 255;

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
export function canonicalMemberPath(name: string): string {
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
export function memberCollisionKey(canonicalPath: string): string {
  return canonicalPath.normalize("NFC").toLowerCase();
}

/** Resolve a canonical member path against an empty virtual root, purely textually. */
function resolvesInsideRoot(canonical: string): boolean {
  const stack: string[] = [];
  for (const segment of canonical.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return false;
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.length > 0;
}

function pathHolds(canonical: string, raw: string, policy: LocalArchivePolicy): ArchiveHold[] {
  const holds: ArchiveHold[] = [];
  const normalized = raw.replace(/\\/g, "/");
  if (raw.includes(NUL)) {
    // Split/join rather than a regex: a control character inside a regex literal is
    // a readability hazard and a static-analysis finding, and the substitution is a
    // plain one here.
    holds.push({
      code: "archive.path_nul",
      memberPath: raw.split(NUL).join("?"),
      message: "member path contains a NUL character",
    });
  }
  if (raw.startsWith("\\\\") || normalized.startsWith("//")) {
    holds.push({ code: "archive.path_unc", memberPath: raw, message: "member path is a UNC path" });
  } else if (normalized.startsWith("/")) {
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
  } else if (canonical.split("/").some((segment) => Buffer.byteLength(segment, "utf8") > MAX_SEGMENT_BYTES)) {
    holds.push({
      code: "archive.path_too_long",
      memberPath: raw.slice(0, 120),
      message: `a member path component exceeds ${MAX_SEGMENT_BYTES} bytes, which no supported filesystem can store`,
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

function entryKindHold(entry: ZipCentralEntry): ArchiveHold | null {
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
function collisionHold(canonical: string, previous: string, rawName: string): ArchiveHold {
  const sameAfterUnicodeFold = canonical.normalize("NFC") === previous.normalize("NFC");
  return {
    code: sameAfterUnicodeFold ? "archive.unicode_collision" : "archive.case_collision",
    memberPath: rawName,
    message: sameAfterUnicodeFold
      ? `member path is canonically equivalent to '${previous}' under Unicode normalization`
      : `member path collides with '${previous}' under a case fold`,
  };
}

export interface ArchivePreflightInput {
  directory: ZipDirectory;
  policy: LocalArchivePolicy;
  /** Depth of this archive; the outermost archive is 0. */
  depth: number;
  /** Size of the archive file on disk, for the compression-ratio check. */
  archiveCompressedBytes: number;
}

/**
 * Judge an archive against every path, entry-type, encryption, compression,
 * collision and resource rule. Never touches the filesystem.
 */
/** Accumulates per-entry verdicts while the central directory is walked. */
interface PreflightAccumulator {
  holds: ArchiveHold[];
  members: PreflightMember[];
  directories: string[];
  declaredUncompressedBytes: number;
  declaredCompressedBytes: number;
  seenExact: Map<string, string>;
  seenCollision: Map<string, string>;
  /** Canonical paths declared by file members, with the raw name that declared each. */
  filePaths: Map<string, string>;
  /** Canonical paths already reported as exact duplicates; not reported a second way. */
  duplicates: Set<string>;
  /** Every canonical path some entry uses as a directory: explicit directory entries and all ancestors. */
  directoryPaths: Set<string>;
}

/** Archive-wide rules that do not depend on any individual entry. */
function archiveScopeHolds(input: ArchivePreflightInput): ArchiveHold[] {
  const { directory, policy } = input;
  const holds: ArchiveHold[] = [];
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
  return holds;
}

/**
 * Duplicate and collision rules.
 *
 * Applied to every entry, directories included, so a directory that shadows a file
 * is caught as well.
 */
function collisionHolds(
  entry: ZipCentralEntry,
  canonical: string,
  accumulator: PreflightAccumulator,
): ArchiveHold[] {
  if (canonical.length === 0) return [];
  const previousExact = accumulator.seenExact.get(canonical);
  if (previousExact !== undefined) {
    accumulator.duplicates.add(canonical);
    return [{
      code: "archive.duplicate_member",
      memberPath: entry.name,
      message: `member path is declared more than once (also '${previousExact}')`,
    }];
  }
  accumulator.seenExact.set(canonical, entry.name);
  const key = memberCollisionKey(canonical);
  const previousCollision = accumulator.seenCollision.get(key);
  if (previousCollision !== undefined) return [collisionHold(canonical, previousCollision, entry.name)];
  accumulator.seenCollision.set(key, canonical);
  return [];
}

/** Rules that apply only to a file member: compression support and declared size. */
function fileMemberHolds(entry: ZipCentralEntry, policy: LocalArchivePolicy): ArchiveHold[] {
  const holds: ArchiveHold[] = [];
  if (entry.compressionMethod !== COMPRESSION_STORED && entry.compressionMethod !== COMPRESSION_DEFLATE) {
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
      message:
        `member declares ${entry.uncompressedSize} uncompressed bytes, ` +
        `above the per-member limit of ${policy.maxSingleMemberUncompressedBytes}`,
    });
  }
  return holds;
}

/**
 * Record which canonical paths are used as files and which as directories.
 *
 * Every ancestor of a member is a directory by implication, so `a` declared as a
 * file and `a/b` declared as a file cannot both be materialized on any
 * filesystem. The exact-duplicate rule does not see this — the two paths differ —
 * and the outcome used to depend on central-directory order: `a/b` first was held
 * as an unreadable format, `a` first threw out of extraction. Usage is gathered
 * here and judged once, after the whole directory is known, so both orders receive
 * the same verdict from the same rule.
 */
function notePathUsage(entry: ZipCentralEntry, canonical: string, accumulator: PreflightAccumulator): void {
  if (canonical.length === 0 || canonical.startsWith("/")) return;
  const segments = canonical.split("/");
  if (entry.kind === "directory") {
    accumulator.directoryPaths.add(canonical);
  } else if (entry.kind === "file" && !accumulator.filePaths.has(canonical)) {
    accumulator.filePaths.set(canonical, entry.name);
  }
  for (let depth = 1; depth < segments.length; depth++) {
    accumulator.directoryPaths.add(segments.slice(0, depth).join("/"));
  }
}

/** A path declared as a file by one member and used as a directory by another. */
function pathConflictHolds(accumulator: PreflightAccumulator): ArchiveHold[] {
  const holds: ArchiveHold[] = [];
  for (const [canonical, rawName] of accumulator.filePaths) {
    if (!accumulator.directoryPaths.has(canonical)) continue;
    // `docs/` beside `docs` is the same path spelled twice and is already held as
    // an exact duplicate; one defect, one hold.
    if (accumulator.duplicates.has(canonical)) continue;
    holds.push({
      code: "archive.path_conflict",
      memberPath: rawName,
      message: "member path is declared as a file and used as a directory by another member",
    });
  }
  return holds;
}

/** Judge one central-directory entry and fold it into the accumulator. */
function inspectEntry(
  entry: ZipCentralEntry,
  policy: LocalArchivePolicy,
  accumulator: PreflightAccumulator,
): void {
  const canonical = canonicalMemberPath(entry.name);
  accumulator.holds.push(...pathHolds(canonical, entry.name, policy));
  notePathUsage(entry, canonical, accumulator);

  if (entry.encrypted) {
    accumulator.holds.push({
      code: "archive.member_encrypted",
      memberPath: entry.name,
      message: "member is encrypted and cannot be observed",
    });
  }
  const kindHold = entryKindHold(entry);
  if (kindHold) accumulator.holds.push(kindHold);
  accumulator.holds.push(...collisionHolds(entry, canonical, accumulator));

  if (entry.kind === "directory") {
    if (canonical.length > 0) accumulator.directories.push(canonical);
    return;
  }
  if (entry.kind !== "file") return;

  accumulator.holds.push(...fileMemberHolds(entry, policy));
  accumulator.declaredUncompressedBytes += entry.uncompressedSize;
  accumulator.declaredCompressedBytes += entry.compressedSize;
  accumulator.members.push({ canonicalPath: canonical, entry });
}

/** Expansion-total and ratio rules, judged once the whole directory is known. */
function expansionHolds(input: ArchivePreflightInput, declaredUncompressedBytes: number): ArchiveHold[] {
  const { policy } = input;
  const holds: ArchiveHold[] = [];
  if (declaredUncompressedBytes > policy.maxTotalUncompressedBytesPerArchive) {
    holds.push({
      code: "archive.total_uncompressed_exceeded",
      message:
        `archive declares ${declaredUncompressedBytes} uncompressed bytes, ` +
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
  return holds;
}

/**
 * Judge an archive against every path, entry-type, encryption, compression,
 * collision and resource rule. Never touches the filesystem.
 */
export function preflightArchive(input: ArchivePreflightInput): ArchivePreflightResult {
  const accumulator: PreflightAccumulator = {
    holds: archiveScopeHolds(input),
    members: [],
    directories: [],
    declaredUncompressedBytes: 0,
    declaredCompressedBytes: 0,
    seenExact: new Map(),
    seenCollision: new Map(),
    filePaths: new Map(),
    directoryPaths: new Set(),
    duplicates: new Set(),
  };

  for (const entry of input.directory.entries) inspectEntry(entry, input.policy, accumulator);
  accumulator.holds.push(
    ...pathConflictHolds(accumulator),
    ...expansionHolds(input, accumulator.declaredUncompressedBytes),
  );

  return {
    accepted: accumulator.holds.length === 0,
    holds: accumulator.holds,
    members: accumulator.members,
    directories: accumulator.directories,
    declaredUncompressedBytes: accumulator.declaredUncompressedBytes,
    declaredCompressedBytes: accumulator.declaredCompressedBytes,
  };
}
