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
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { InventoryArtifactType, InventoryRecord, InventoryResult, classifyInventory } from "./inventory";
import { EncodingProbe, probeFileEncoding } from "./encoding";
import { OmitMatcher, buildOmitMatcher } from "./omit";
import {
  ArchiveHold,
  ArchivePreflightResult,
  canonicalMemberPath,
  preflightArchive,
} from "./archive_preflight";
import {
  ArchiveSessionBudget,
  LocalArchivePolicy,
  resolveLocalArchivePolicy,
} from "./local_archive_policy";
import { ZipBudgetExceededError, readZipCentralDirectory, streamZipMember } from "./zip_reader";

/** Separator between an archive path and a member path in a virtual locator. */
export const ARCHIVE_MEMBER_SEPARATOR = "!/";

/** Ownership marker written at the root of every scratch directory this module creates. */
export const SCRATCH_OWNER_FILE = ".l9-scratch-owner.json";
export const SCRATCH_OWNER_ID = "l9-meta-injector.local-source";

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
export const GENERATED_ARTIFACT_OMIT_PATTERNS: readonly string[] = [
  "*.inject.log",
  "*.l9meta.yaml",
  ".l9/",
  ".l9inventory/",
  ".l9out/",
  ".l9skills/",
];

/** Marker a tool-owned legacy extraction directory carries. */
export const LEGACY_EXTRACTION_OWNER_FILE = ".l9extracted-owner.json";
export const LEGACY_EXTRACTION_SUFFIX = ".l9extracted";

export type LocalSourceKind = "file" | "directory" | "archive";
export type RequestedSourceKind = LocalSourceKind | "auto";

export type LocalEntryKind = "file" | "directory" | "symlink" | "special";

export type LocalSourceDiagnosticSeverity = "info" | "warning" | "error";

export interface LocalSourceDiagnostic {
  code: string;
  severity: LocalSourceDiagnosticSeverity;
  message: string;
  /** Repository-relative or virtual path the diagnostic is about, when it has one. */
  sourcePath?: string;
}

export interface LocalArchiveObservation {
  /** Source-relative POSIX path of the archive file, or a virtual locator when nested. */
  sourcePath: string;
  /** `sha256:`-prefixed digest of the exact archive bytes. */
  contentHash: string;
  sizeBytes: number;
  /** Nesting depth; the outermost archive is 0. */
  nestedDepth: number;
  /** Digest of the containing archive when this archive is itself a member. */
  parentArchiveHash: string | null;
  /** Source path of the containing archive when this archive is itself a member. */
  parentArchivePath: string | null;
  /** True when the archive's members were expanded and are claimed as observed. */
  expanded: boolean;
  memberCount: number;
  omittedMemberCount: number;
  /** Violations that held the archive. Empty when it was expanded. */
  holds: ArchiveHold[];
}

export interface LocalArchiveMemberObservation {
  /** Machine-independent virtual locator, e.g. `Bundle.zip!/docs/a.md`. */
  virtualSourcePath: string;
  /** Canonical member path inside its own archive. */
  memberPath: string;
  /** `sha256:`-prefixed digest of the exact member bytes. */
  contentHash: string;
  sizeBytes: number;
  parentArchiveHash: string;
  parentArchivePath: string;
  nestedDepth: number;
  compressionMethod: number;
  crc32: number;
  /** Absolute staged path. Implementation detail; never semantic, never emitted. */
  stagedPath: string;
}

export interface LocalSourceAcquireInput {
  /** Absolute or relative path to the file, directory, or archive to observe. */
  path: string;
  sourceKind?: RequestedSourceKind;
  /** Canonical source name. Defaults to the basename of the source path. */
  name?: string;
  /** Expand ZIP archives into tool-owned staging. Default true. */
  expandArchives?: boolean;
  archivePolicy?: Partial<LocalArchivePolicy>;
  /** Pre-built omit matcher. When absent one is built from the patterns below. */
  omit?: OmitMatcher;
  omitPatterns?: string[];
  omitFile?: string;
  /**
   * Optional ceiling on the bytes hashed per file. Unset means every regular file
   * is hashed in full. When set and exceeded, the hash is absent, a diagnostic is
   * emitted, and the canonical snapshot is blocked rather than silently degraded.
   */
  hashMaxBytes?: number;
  /** Scratch parent directory. Defaults to the OS temporary directory. */
  scratchParent?: string;
}

export interface LocalSourceObservation {
  sourceKind: LocalSourceKind;
  sourceName: string;
  /** `file:sha256:…`, `archive:sha256:…`, or `fs:sha256:…`. Derived, never supplied. */
  sourceRevision: string;
  /** `sha256:`-prefixed digest of the canonical physical manifest. */
  physicalSnapshotHash: string;
  /** Physical entries plus virtual archive members, in the inventory record shape. */
  inventory: InventoryResult;
  archives: LocalArchiveObservation[];
  virtualArtifacts: LocalArchiveMemberObservation[];
  diagnostics: LocalSourceDiagnostic[];
  /** Applied archive policy, recorded so a manifest states the rules that produced it. */
  archivePolicy: LocalArchivePolicy;
  /**
   * False when the source changed while it was being observed. A canonical
   * Repository Model Packet must not be produced from an unstable observation.
   */
  stable: boolean;
  /** Tool-owned staging root. Implementation detail; never semantic. */
  scratchRoot: string;
  /** Remove the staging root. Safe to call more than once. */
  dispose(): void;
}

// ───────────────────────────── scratch ownership ─────────────────────────────

interface ScratchHandle {
  root: string;
  token: string;
  dispose(): void;
}

/**
 * Create a tool-owned scratch root outside the source tree.
 *
 * The ownership token is what makes cleanup safe: a recursive delete is permitted
 * only for a path inside a root this session created and whose marker still
 * carries this session's token. Nothing is ever removed because of its name.
 */
function createScratch(parent: string): ScratchHandle {
  const base = parent.length > 0 ? parent : os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "l9-local-source-"));
  const token = crypto.randomUUID();
  fs.writeFileSync(
    path.join(root, SCRATCH_OWNER_FILE),
    JSON.stringify({ owner: SCRATCH_OWNER_ID, token, pid: process.pid }, null, 2),
    "utf8",
  );
  let disposed = false;
  return {
    root,
    token,
    dispose(): void {
      if (disposed) return;
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
export function removeOwnedScratch(root: string, token: string): void {
  let marker: { owner?: unknown; token?: unknown };
  try {
    marker = JSON.parse(fs.readFileSync(path.join(root, SCRATCH_OWNER_FILE), "utf8")) as typeof marker;
  } catch {
    return; // No provable ownership: leave the path alone.
  }
  if (marker.owner !== SCRATCH_OWNER_ID || marker.token !== token) return;
  fs.rmSync(root, { recursive: true, force: true });
}

/**
 * True when a directory carries evidence that this tool created it.
 *
 * A directory is not tool-owned merely because its name ends in `.l9extracted`.
 * Users name directories whatever they like, and treating a name as ownership is
 * exactly how user data gets deleted.
 */
export function hasLegacyExtractionOwnership(directory: string): boolean {
  try {
    const marker = JSON.parse(
      fs.readFileSync(path.join(directory, LEGACY_EXTRACTION_OWNER_FILE), "utf8"),
    ) as { owner?: unknown };
    return typeof marker.owner === "string" && marker.owner.startsWith("l9-meta-injector.");
  } catch {
    return false;
  }
}

/**
 * True when `directory` is a legacy extraction of an archive that sits beside it.
 *
 * Both signals must agree: the ownership marker, and an adjacent archive whose
 * name the directory derives from. Either alone is an assumption.
 */
export function isLegacyGeneratedExtraction(absoluteDirectory: string): boolean {
  if (!absoluteDirectory.endsWith(LEGACY_EXTRACTION_SUFFIX)) return false;
  if (!hasLegacyExtractionOwnership(absoluteDirectory)) return false;
  const stem = absoluteDirectory.slice(0, -LEGACY_EXTRACTION_SUFFIX.length);
  return [...ZIP_EXTENSIONS].some((extension) => {
    try {
      return fs.lstatSync(stem + extension).isFile();
    } catch {
      return false;
    }
  });
}

// ───────────────────────────── hashing ─────────────────────────────

function sha256Prefixed(digestHex: string): string {
  return `sha256:${digestHex}`;
}

/** Stream a file through SHA-256. Bounded memory regardless of file size. */
export function hashFileStreaming(absolutePath: string): { hash: string; bytes: number } {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(HASH_CHUNK_BYTES);
    let position = 0;
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      position += count;
    }
    return { hash: sha256Prefixed(hash.digest("hex")), bytes: position };
  } finally {
    fs.closeSync(fd);
  }
}

// ───────────────────────────── canonical manifest ─────────────────────────────

/** Code-point ordering. Locale comparison must never decide identity. */
function compareCodePoints(a: string, b: string): number {
  const left = [...a], right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    const l = left[i].codePointAt(0) ?? 0, r = right[i].codePointAt(0) ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  if (left.length === right.length) return 0;
  return left.length < right.length ? -1 : 1;
}

export interface PhysicalManifestEntry {
  path: string;
  kind: LocalEntryKind;
  /** Present for regular files whose bytes were hashed. */
  contentHash?: string;
  /** Present for symlinks: the literal target text, never a resolved path. */
  linkTarget?: string;
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
export function physicalManifestDigest(entries: PhysicalManifestEntry[]): string {
  const ordered = [...entries].sort((a, b) => compareCodePoints(a.path, b.path));
  const rendered = ordered
    .map((entry) => JSON.stringify([entry.path, entry.kind, entry.contentHash ?? null, entry.linkTarget ?? null]))
    .join("\n");
  return sha256Prefixed(crypto.createHash("sha256").update(rendered, "utf8").digest("hex"));
}

// ───────────────────────────── enumeration ─────────────────────────────

interface EnumeratedEntry {
  absolutePath: string;
  relativePath: string;
  kind: LocalEntryKind;
  /** Stability metadata, compared before and after hashing. Never part of identity. */
  sizeBytes: number | null;
  mtimeMs: number | null;
  linkTarget: string | null;
}

function entryKindFromStats(stats: fs.Stats): LocalEntryKind {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  return "special";
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/**
 * Enumerate a directory tree without following symlinks.
 *
 * `lstat` is used throughout: a symlink is observed as a symlink, and the tree it
 * points at — which may be outside the root, or a cycle — is never walked.
 */
/** Observe one filesystem entry with lstat, never following what it points at. */
function observeEntry(
  absolutePath: string,
  relativePath: string,
  diagnostics: LocalSourceDiagnostic[],
): EnumeratedEntry | null {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(absolutePath);
  } catch (error) {
    diagnostics.push({
      code: "local-source.entry_unreadable",
      severity: "warning",
      message: `filesystem entry could not be inspected: ${(error as Error).message}`,
      sourcePath: relativePath,
    });
    return null;
  }
  const kind = entryKindFromStats(stats);
  let linkTarget: string | null = null;
  if (kind === "symlink") {
    // The link's own text, never the resolved target: resolving it would read
    // outside the observed root.
    try {
      linkTarget = toPosix(fs.readlinkSync(absolutePath));
    } catch {
      linkTarget = null;
    }
  }
  return {
    absolutePath,
    relativePath,
    kind,
    sizeBytes: kind === "file" ? stats.size : null,
    mtimeMs: kind === "directory" ? null : stats.mtimeMs,
    linkTarget,
  };
}

/**
 * Enumerate a directory tree without following symlinks.
 *
 * `lstat` is used throughout: a symlink is observed as a symlink, and the tree it
 * points at — which may be outside the root, or a cycle — is never walked.
 */
function enumerateDirectory(
  root: string,
  omit: OmitMatcher,
  diagnostics: LocalSourceDiagnostic[],
  omittedPaths: string[],
  skippedDirs: string[],
): EnumeratedEntry[] {
  const out: EnumeratedEntry[] = [];

  const visit = (directory: string): void => {
    let names: string[];
    try {
      names = fs.readdirSync(directory);
    } catch (error) {
      skippedDirs.push(`${toPosix(path.relative(root, directory)) || "."}: ${(error as Error).message}`);
      return;
    }
    for (const name of [...names].sort(compareCodePoints)) {
      const absolutePath = path.join(directory, name);
      const relativePath = toPosix(path.relative(root, absolutePath));
      if (omit.shouldOmit(relativePath)) {
        omittedPaths.push(relativePath);
        continue;
      }
      const entry = observeEntry(absolutePath, relativePath, diagnostics);
      if (entry === null) continue;
      if (entry.kind === "directory" && isLegacyGeneratedExtraction(absolutePath)) {
        omittedPaths.push(relativePath);
        diagnostics.push({
          code: "local-source.legacy_extraction_excluded",
          severity: "info",
          message:
            "directory carries this tool's extraction-ownership marker beside its archive " +
            "and is excluded as generated output",
          sourcePath: relativePath,
        });
        continue;
      }
      out.push(entry);
      if (entry.kind === "directory") visit(absolutePath);
    }
  };

  visit(root);
  return out;
}

/** Compare two enumerations for the entry-set and per-entry stability checks. */
function enumerationDiffers(before: EnumeratedEntry[], after: EnumeratedEntry[]): string | null {
  if (before.length !== after.length) {
    return `entry count changed from ${before.length} to ${after.length}`;
  }
  const byPath = new Map(after.map((entry) => [entry.relativePath, entry]));
  for (const entry of before) {
    const later = byPath.get(entry.relativePath);
    if (later === undefined) return `entry disappeared during observation: ${entry.relativePath}`;
    if (later.kind !== entry.kind) return `entry kind changed during observation: ${entry.relativePath}`;
    if (later.sizeBytes !== entry.sizeBytes) return `file size changed during observation: ${entry.relativePath}`;
    if (later.mtimeMs !== entry.mtimeMs) return `file mtime changed during observation: ${entry.relativePath}`;
  }
  return null;
}

// ───────────────────────────── record construction ─────────────────────────────

function inventoryIdFor(relativePath: string): string {
  return "inv-" + crypto.createHash("sha256").update(relativePath, "utf8").digest("hex").slice(0, 16);
}

interface RecordDraft {
  relativePath: string;
  absolutePath: string | null;
  kind: LocalEntryKind | "archive-member";
  sizeBytes: number | null;
  /** Bare hex digest, matching the inventory record shape (no `sha256:` prefix). */
  contentHash: string | null;
  unknowns: string[];
  artifactTypeOverride?: InventoryArtifactType;
  evidenceOverride?: string;
  confidenceOverride?: number;
}

function buildLocalRecord(draft: RecordDraft): InventoryRecord {
  const relative = draft.relativePath;
  const fileName = relative.includes("/") ? relative.slice(relative.lastIndexOf("/") + 1) : relative;
  const isDir = draft.kind === "directory";
  const extension = isDir ? "" : path.extname(fileName);
  const classified = classifyInventory(relative, fileName, extension, isDir);
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

// ───────────────────────────── archive acquisition ─────────────────────────────

interface ArchiveTask {
  /** Path on disk to read the archive bytes from (source file, or staged member). */
  physicalPath: string;
  /** Machine-independent locator for the archive itself. */
  sourcePath: string;
  depth: number;
  parentArchiveHash: string | null;
  parentArchivePath: string | null;
}

interface ArchiveContext {
  scratch: ScratchHandle;
  policy: LocalArchivePolicy;
  budget: ArchiveSessionBudget;
  omit: OmitMatcher;
  diagnostics: LocalSourceDiagnostic[];
  archives: LocalArchiveObservation[];
  members: LocalArchiveMemberObservation[];
  omittedPaths: string[];
}

function holdArchive(
  context: ArchiveContext,
  task: ArchiveTask,
  contentHash: string,
  sizeBytes: number,
  holds: ArchiveHold[],
): void {
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
        ? `${task.sourcePath}${ARCHIVE_MEMBER_SEPARATOR}${canonicalMemberPath(hold.memberPath)}`
        : task.sourcePath,
    });
  }
  context.diagnostics.push({
    code: "local-source.archive_held",
    severity: "warning",
    message:
      `archive was observed and hashed but not expanded; ${holds.length} preflight or budget ` +
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
function memberStagingRoot(scratchRoot: string, archiveHash: string, occurrence: number): string {
  return path.join(scratchRoot, "members", `${occurrence}-${archiveHash.replace("sha256:", "")}`);
}

function extractMembers(
  context: ArchiveContext,
  task: ArchiveTask,
  archiveHash: string,
  occurrence: number,
  preflight: ArchivePreflightResult,
): { members: LocalArchiveMemberObservation[]; expandedBytes: number; failure: ArchiveHold | null } {
  const stagingRoot = memberStagingRoot(context.scratch.root, archiveHash, occurrence);
  const members: LocalArchiveMemberObservation[] = [];
  let expandedBytes = 0;
  const remainingSessionBytes = context.budget.remainingBytes();

  for (const member of preflight.members) {
    const virtualPath = `${task.sourcePath}${ARCHIVE_MEMBER_SEPARATOR}${member.canonicalPath}`;
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
    const ceiling = Math.min(
      context.policy.maxSingleMemberUncompressedBytes,
      Math.max(0, context.policy.maxTotalUncompressedBytesPerArchive - expandedBytes),
      Math.max(0, remainingSessionBytes - expandedBytes),
    );
    let handle: number | null = null;
    try {
      handle = fs.openSync(stagedPath, "w");
      const fd = handle;
      const result = streamZipMember(
        task.physicalPath,
        member.entry,
        { maxUncompressedBytes: ceiling },
        (chunk) => {
          hash.update(chunk);
          fs.writeSync(fd, chunk);
        },
      );
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
    } catch (error) {
      const budgetFailure = error instanceof ZipBudgetExceededError;
      return {
        members,
        expandedBytes,
        failure: {
          code: budgetFailure ? "archive.extracted_bytes_exceeded" : "archive.format_unreadable",
          memberPath: member.canonicalPath,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      if (handle !== null) fs.closeSync(handle);
    }
  }
  return { members, expandedBytes, failure: null };
}

/** Discard a held archive's partial staging so no member is left behind. */
function discardStaging(context: ArchiveContext, archiveHash: string, occurrence: number): void {
  const stagingRoot = memberStagingRoot(context.scratch.root, archiveHash, occurrence);
  // Contained by construction: `stagingRoot` is always built from the scratch root
  // this session created, never from a path derived from the source.
  if (!stagingRoot.startsWith(context.scratch.root + path.sep)) return;
  fs.rmSync(stagingRoot, { recursive: true, force: true });
}

function isZipPath(value: string): boolean {
  return ZIP_EXTENSIONS.has(path.extname(value).toLowerCase());
}

/**
 * Stage, preflight and expand one archive, queueing any nested archive it holds.
 *
 * The archive is read from a staged immutable copy rather than from the live
 * source file, which closes the window between hashing an archive and reading it:
 * a source file replaced between those two steps would otherwise be reported
 * under the digest of bytes that are no longer there.
 */
/** Outcome of copying an archive into scratch while hashing it. */
interface StagedArchive {
  stagedPath: string;
  archiveHash: string;
  sizeBytes: number;
}

/**
 * Copy an archive into scratch and hash it in one streaming pass.
 *
 * One pass means the digest describes exactly the bytes preflight and extraction
 * will read, closing the window in which a source file replaced between hashing
 * and parsing would be reported under a digest that no longer matches it.
 */
function stageArchive(
  context: ArchiveContext,
  task: ArchiveTask,
  occurrence: number,
): StagedArchive {
  const stagedArchiveDir = path.join(context.scratch.root, "archives");
  fs.mkdirSync(stagedArchiveDir, { recursive: true });
  const stagingTarget = path.join(stagedArchiveDir, `pending-${occurrence}.zip`);

  const hash = crypto.createHash("sha256");
  const source = fs.openSync(task.physicalPath, "r");
  const target = fs.openSync(stagingTarget, "w");
  let sizeBytes: number;
  try {
    const buffer = Buffer.alloc(HASH_CHUNK_BYTES);
    let position = 0;
    for (;;) {
      const count = fs.readSync(source, buffer, 0, buffer.length, position);
      if (count === 0) break;
      if (position + count > context.policy.maxArchiveCompressedBytes) {
        throw new ZipBudgetExceededError(
          `archive exceeds the ${context.policy.maxArchiveCompressedBytes}-byte staging limit`,
        );
      }
      hash.update(buffer.subarray(0, count));
      fs.writeSync(target, buffer.subarray(0, count));
      position += count;
    }
    sizeBytes = position;
  } catch (error) {
    fs.rmSync(stagingTarget, { force: true });
    throw error;
  } finally {
    fs.closeSync(source);
    fs.closeSync(target);
  }

  const archiveHash = sha256Prefixed(hash.digest("hex"));
  const stagedPath = path.join(stagedArchiveDir, `${archiveHash.replace("sha256:", "")}.zip`);
  if (fs.existsSync(stagedPath)) fs.rmSync(stagingTarget, { force: true });
  else fs.renameSync(stagingTarget, stagedPath);
  return { stagedPath, archiveHash, sizeBytes };
}

/** Record an archive that could not even be staged or hashed. */
function recordUnstageableArchive(context: ArchiveContext, task: ArchiveTask, error: unknown): void {
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
function enqueueNestedArchives(
  context: ArchiveContext,
  task: ArchiveTask,
  archiveHash: string,
  members: LocalArchiveMemberObservation[],
  queue: ArchiveTask[],
): void {
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
function preflightStaged(
  context: ArchiveContext,
  task: ArchiveTask,
  staged: StagedArchive,
): ArchivePreflightResult | null {
  let preflight: ArchivePreflightResult;
  try {
    preflight = preflightArchive({
      directory: readZipCentralDirectory(staged.stagedPath),
      policy: context.policy,
      depth: task.depth,
      archiveCompressedBytes: staged.sizeBytes,
    });
  } catch (error) {
    holdArchive(context, task, staged.archiveHash, staged.sizeBytes, [{
      code: "archive.format_unreadable",
      message: `central directory could not be read: ${error instanceof Error ? error.message : String(error)}`,
    }]);
    return null;
  }
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
function acquireArchive(context: ArchiveContext, task: ArchiveTask, queue: ArchiveTask[]): void {
  // Position of this archive in the run. Distinguishes two archives that hold
  // identical bytes, which share a digest but must not share staging.
  const occurrence = context.archives.length;

  let staged: StagedArchive;
  try {
    staged = stageArchive(context, task, occurrence);
  } catch (error) {
    recordUnstageableArchive(context, task, error);
    return;
  }

  const preflight = preflightStaged(context, task, staged);
  if (preflight === null) return;

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

function resolveSourceKind(absolutePath: string, requested: RequestedSourceKind): LocalSourceKind {
  const stats = fs.lstatSync(absolutePath);
  if (stats.isSymbolicLink()) {
    throw new Error(
      `local-source: the source path is a symbolic link and is never followed: ${absolutePath}`,
    );
  }
  const nonDirectoryKind: LocalSourceKind = isZipPath(absolutePath) ? "archive" : "file";
  const actual: LocalSourceKind = stats.isDirectory() ? "directory" : nonDirectoryKind;
  if (requested === "auto" || requested === undefined) return actual;
  if (requested === "directory" && !stats.isDirectory()) {
    throw new Error(`local-source: --source-kind directory was requested but the path is not a directory`);
  }
  if (requested !== "directory" && stats.isDirectory()) {
    throw new Error(`local-source: --source-kind ${requested} was requested but the path is a directory`);
  }
  return requested;
}

function buildAcquisitionOmit(input: LocalSourceAcquireInput, omitRoot: string): OmitMatcher {
  if (input.omit) return input.omit;
  return buildOmitMatcher({
    root: omitRoot,
    patterns: [...GENERATED_ARTIFACT_OMIT_PATTERNS, ...(input.omitPatterns ?? [])],
    ...(input.omitFile !== undefined ? { omitFile: input.omitFile } : {}),
    // SKILL.md is protected from mutation, not from observation. Acquisition never
    // mutates anything, and hiding a skill entrypoint would make the observation
    // silently incomplete.
    protectSkillMd: false,
    ignoreDirNames: [".git", "node_modules"],
  });
}

interface HashedEntry {
  entry: EnumeratedEntry;
  contentHashHex: string | null;
  encoding: EncodingProbe | null;
  unknowns: string[];
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
function hashStableFile(entry: EnumeratedEntry): { digest: string | null; reason: string; changed: boolean } {
  let reason = "";
  for (let attempt = 0; attempt <= STABILITY_RETRY_LIMIT; attempt++) {
    let before: fs.Stats;
    try {
      before = fs.lstatSync(entry.absolutePath);
    } catch (error) {
      return { digest: null, reason: (error as Error).message, changed: false };
    }
    let candidate: string;
    try {
      candidate = hashFileStreaming(entry.absolutePath).hash;
    } catch (error) {
      return { digest: null, reason: (error as Error).message, changed: false };
    }
    const after = fs.lstatSync(entry.absolutePath);
    if (after.size === before.size && after.mtimeMs === before.mtimeMs) {
      return { digest: candidate, reason: "", changed: false };
    }
    reason = "file changed while it was being hashed";
  }
  return { digest: null, reason, changed: true };
}

/** Hash one entry and classify its encoding, or explain why neither happened. */
function hashOneEntry(
  entry: EnumeratedEntry,
  hashMaxBytes: number | undefined,
  diagnostics: LocalSourceDiagnostic[],
): { hashed: HashedEntry; unstableReason: string | null } {
  const unknowns: string[] = [];
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

  const encoding = probeFileEncoding(entry.absolutePath);
  if (encoding.status === "invalid") {
    unknowns.push("unsupported_encoding");
    diagnostics.push({
      code: "local-source.unsupported_encoding",
      severity: "warning",
      message: `file is not valid UTF-8 and is observed by hash only: ${encoding.reason}`,
      sourcePath: entry.relativePath,
    });
  }
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
function hashEntries(
  entries: EnumeratedEntry[],
  hashMaxBytes: number | undefined,
  diagnostics: LocalSourceDiagnostic[],
): { hashed: HashedEntry[]; unstableReason: string | null } {
  const hashed: HashedEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== "file") {
      hashed.push({ entry, contentHashHex: null, encoding: null, unknowns: [] });
      continue;
    }
    const result = hashOneEntry(entry, hashMaxBytes, diagnostics);
    if (result.unstableReason !== null) return { hashed, unstableReason: result.unstableReason };
    hashed.push(result.hashed);
  }
  return { hashed, unstableReason: null };
}

function revisionFor(sourceKind: LocalSourceKind, digest: string): string {
  const bare = digest.replace("sha256:", "");
  if (sourceKind === "file") return `file:sha256:${bare}`;
  if (sourceKind === "archive") return `archive:sha256:${bare}`;
  return `fs:sha256:${bare}`;
}

/** Phase 1 — enumerate the source. A single file is its own one-entry enumeration. */
function enumerateSource(
  absoluteSource: string,
  sourceKind: LocalSourceKind,
  omit: OmitMatcher,
  diagnostics: LocalSourceDiagnostic[],
  omittedPaths: string[],
  skippedDirs: string[],
): EnumeratedEntry[] {
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
    linkTarget: null,
  }];
}

/**
 * Phase 3 — re-enumerate and compare. Returns why the snapshot is not trustworthy,
 * or null when the source held still for the whole observation.
 */
function verifySnapshotStability(
  absoluteSource: string,
  sourceKind: LocalSourceKind,
  entries: EnumeratedEntry[],
  omit: OmitMatcher,
): string | null {
  if (sourceKind === "directory") {
    return enumerationDiffers(entries, enumerateDirectory(absoluteSource, omit, [], [], []));
  }
  const after = fs.lstatSync(absoluteSource);
  if (after.size !== entries[0].sizeBytes || after.mtimeMs !== entries[0].mtimeMs) {
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
function deriveSourceIdentity(
  hashed: HashedEntry[],
  sourceKind: LocalSourceKind,
): { physicalSnapshotHash: string; sourceRevision: string } {
  const manifestEntries: PhysicalManifestEntry[] = hashed.map(({ entry, contentHashHex }) => ({
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
    sourceRevision: revisionFor(sourceKind, useFileHash ? (singleFileHash as string) : physicalSnapshotHash),
  };
}

/** Queue the ZIP archives to expand, reporting the formats v1 does not open. */
function planArchiveTasks(hashed: HashedEntry[], diagnostics: LocalSourceDiagnostic[]): ArchiveTask[] {
  const queue: ArchiveTask[] = [];
  for (const { entry } of hashed) {
    if (entry.kind !== "file") continue;
    if (isZipPath(entry.relativePath)) {
      queue.push({
        physicalPath: entry.absolutePath,
        sourcePath: entry.relativePath,
        depth: 0,
        parentArchiveHash: null,
        parentArchivePath: null,
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
function reportDisabledExpansion(hashed: HashedEntry[], diagnostics: LocalSourceDiagnostic[]): void {
  for (const { entry } of hashed) {
    if (entry.kind !== "file" || !isZipPath(entry.relativePath)) continue;
    diagnostics.push({
      code: "local-source.archive_expansion_disabled",
      severity: "info",
      message: "archive expansion is disabled; the archive is hashed and its members are not observed",
      sourcePath: entry.relativePath,
    });
  }
}

/** Diagnose an entry that is observed but deliberately never opened. */
function reportUnopenedEntry(entry: EnumeratedEntry, diagnostics: LocalSourceDiagnostic[]): void {
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
function physicalRecord(hashedEntry: HashedEntry): InventoryRecord {
  const { entry, contentHashHex, encoding, unknowns } = hashedEntry;
  const entryUnknowns = [...unknowns];
  if (entry.kind === "symlink") entryUnknowns.push("symlink_not_traversed");
  if (entry.kind === "special") entryUnknowns.push("special_filesystem_entry");
  if (encoding !== null && encoding.status === "binary") entryUnknowns.push("binary_content");
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
          artifactTypeOverride: "unknown" as InventoryArtifactType,
          evidenceOverride: entry.kind === "symlink"
            ? "symbolic link, not traversed"
            : "special filesystem entry, not opened",
          confidenceOverride: 1,
        }
      : {}),
  });
}

/** Physical entries and virtual archive members, in one code-point-ordered set. */
function buildRecords(
  hashed: HashedEntry[],
  members: LocalArchiveMemberObservation[],
  diagnostics: LocalSourceDiagnostic[],
): InventoryRecord[] {
  const records: InventoryRecord[] = [];
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
  return records.sort((a, b) => compareCodePoints(a.relative_path, b.relative_path));
}

/** Assemble the inventory view the packet builder and interpretation consume. */
function buildInventoryResult(
  root: string,
  records: InventoryRecord[],
  skippedDirs: string[],
  omittedPaths: string[],
): InventoryResult {
  const typeDistribution: Record<string, number> = {};
  let files = 0, folders = 0;
  for (const record of records) {
    typeDistribution[record.artifact_type] = (typeDistribution[record.artifact_type] ?? 0) + 1;
    if (record.artifact_type === "folder") folders++; else files++;
  }
  return {
    root,
    total: records.length,
    files,
    folders,
    typeDistribution,
    // Acquisition writes no manifests of its own; the CLI owns output placement.
    manifestPaths: { json: "", csv: "", md: "", duplicates: "" },
    duplicates: [],
    records,
    skippedDirs,
    omittedPaths: [...omittedPaths].sort(compareCodePoints),
  };
}

/** Total order over diagnostics, so a packet's diagnostic list is reproducible. */
function compareDiagnostics(a: LocalSourceDiagnostic, b: LocalSourceDiagnostic): number {
  return compareCodePoints(a.code, b.code)
    || compareCodePoints(a.sourcePath ?? "", b.sourcePath ?? "")
    || compareCodePoints(a.message, b.message);
}

/**
 * Observe a local source read-only and return everything a deterministic packet
 * needs: a stable snapshot identity, per-entry evidence, virtual archive members
 * with exact hashes, and the provenance that binds each member to its archive.
 *
 * The caller owns the returned observation's lifetime and must call `dispose()`
 * once the staged member bytes are no longer needed.
 */
export function acquireLocalSource(input: LocalSourceAcquireInput): LocalSourceObservation {
  const absoluteSource = path.resolve(input.path);
  if (!fs.existsSync(absoluteSource)) {
    throw new Error(`local-source: path does not exist: ${absoluteSource}`);
  }
  const sourceKind = resolveSourceKind(absoluteSource, input.sourceKind ?? "auto");
  const sourceName = input.name && input.name.length > 0 ? input.name : path.basename(absoluteSource);
  const policy = resolveLocalArchivePolicy(input.archivePolicy);
  const budget = new ArchiveSessionBudget(policy, Date.now(), () => Date.now());
  const omitRoot = sourceKind === "directory" ? absoluteSource : path.dirname(absoluteSource);
  const omit = buildAcquisitionOmit(input, omitRoot);

  const diagnostics: LocalSourceDiagnostic[] = [];
  const omittedPaths: string[] = [];
  const skippedDirs: string[] = [];

  // Enumerate, hash, then re-enumerate. A source that moved between the first and
  // last read has no single snapshot to describe, and saying so is the whole point.
  const entries = enumerateSource(absoluteSource, sourceKind, omit, diagnostics, omittedPaths, skippedDirs);
  const { hashed, unstableReason: hashUnstable } = hashEntries(entries, input.hashMaxBytes, diagnostics);
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

  const scratch = createScratch(input.scratchParent ?? os.tmpdir());
  const archives: LocalArchiveObservation[] = [];
  const members: LocalArchiveMemberObservation[] = [];

  // Archive expansion. A held archive still contributes its own observation.
  const expandArchives = input.expandArchives !== false;
  if (!expandArchives) {
    reportDisabledExpansion(hashed, diagnostics);
  } else if (unstableReason === null) {
    const context: ArchiveContext = {
      scratch, policy, budget, omit, diagnostics, archives, members, omittedPaths,
    };
    const queue = planArchiveTasks(hashed, diagnostics);
    while (queue.length > 0) acquireArchive(context, queue.shift() as ArchiveTask, queue);
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
    inventory: buildInventoryResult(absoluteSource, records, skippedDirs, omittedPaths),
    archives: [...archives].sort((a, b) => compareCodePoints(a.sourcePath, b.sourcePath)),
    virtualArtifacts: [...members].sort((a, b) => compareCodePoints(a.virtualSourcePath, b.virtualSourcePath)),
    diagnostics: diagnostics.sort(compareDiagnostics),
    archivePolicy: policy,
    stable: unstableReason === null,
    scratchRoot: scratch.root,
    dispose: () => scratch.dispose(),
  };
}
