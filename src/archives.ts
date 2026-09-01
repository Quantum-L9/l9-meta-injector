// archives.ts — legacy, opt-in, MUTATING local-files archive expansion.
//
// This is not the canonical observation path. Canonical local-source and archive
// observation lives in `local_source.ts`, is read-only, and stages members into
// tool-owned scratch (ADR-036). This module remains only for the pre-existing
// `PipelineConfig.localFiles` materialization workflow, where the operator has
// explicitly asked for archive members to be written beside their archive and
// injected in place. It is a materialization surface, not an observation one, and
// it must never be described as non-destructive.
//
// Default (repo) mode never extracts. When PipelineConfig.localFiles is set,
// .zip archives under the scan root are expanded into sibling *.l9extracted/
// directories, members become ordinary inject targets, and each archive gets an
// inventory-style sidecar (<zip>.l9meta.yaml). Nested zips are expanded up to
// maxDepth.
//
// This module coordinates placement; it does not decide what a ZIP is. Reading,
// admission and extraction belong to the canonical primitives -- `zip_reader`,
// `archive_preflight` and the resolved `local_archive_policy` -- the same ones
// the read-only observation path uses. It previously shelled out to a system
// `unzip`, which made it a second archive authority: a subprocess decides for
// itself what a member path means and how many bytes to write, so the two paths
// could disagree about which archives are safe, and the mutating one was the
// weaker of the two. There is now one decision authority and two output modes.
//
// Two invariants this module now holds unconditionally, legacy or not:
//
//   - A directory is never removed because of its name. `Foo.l9extracted` may be
//     a user directory that happens to be named that way, so extraction refuses
//     to overwrite any existing directory that does not carry this tool's
//     ownership marker. The previous unconditional recursive delete could destroy
//     user data that merely sat next to a zip.
//   - Dry run means zero source-tree mutation. This path previously extracted
//     even in dry run and only skipped the sidecar, which made "dry run" a claim
//     the code did not honor.
//
// Omit (ADR-017): when an OmitMatcher is supplied, omitted archives are not
// expanded / sidecared, omitted directories are not walked, and omitted zip
// members (e.g. SKILL.md, *.log, __pycache__) are not extracted onto disk.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { sidecarPathFor } from "./comment";
import { serializeYamlObject } from "./yaml_serialize";
import type { OmitMatcher } from "./omit";
import {
  EXTRACTION_OWNER_ID,
  LEGACY_EXTRACTION_OWNER_FILE,
  LOCAL_FILES_EXTRACTION_SCHEMA,
  hasExtractionOwnershipV2,
  hasLegacyExtractionOwnership,
} from "./local_source";
import { canonicalMemberPath } from "./archive_preflight";
import { ArchiveExecutionContext } from "./archive_execution";
import type { LocalArchivePolicy } from "./local_archive_policy";
import { readZipCentralDirectory, streamZipMember } from "./zip_reader";
import type { PreflightMember } from "./archive_preflight";

/** Directory-name suffix for an expanded archive (sibling of the .zip). */
export const EXTRACTED_DIR_SUFFIX = ".l9extracted";

/** Archive extensions expanded in local-files mode (v1: zip only). */
export const EXPANDABLE_ARCHIVE_EXTS = new Set([".zip"]);

export interface ArchiveRecord {
  zipPath: string;
  extractDir: string;
  memberCount: number;
  sidecarPath?: string;
  nestedDepth: number;
  /**
   * Why this archive was observed but not expanded. Absent when it was expanded.
   * A refusal is reported rather than thrown so one unsafe archive does not abort
   * a whole local-files run.
   */
  heldReason?: string;
}

export interface ExpandArchivesOptions {
  /** When true, nothing is extracted and no sidecar is written: zero source mutation. */
  dryRun: boolean;
  verbose: boolean;
  /** Max nested-zip depth (outer zip = 0). Default 3. */
  maxDepth?: number;
  /**
   * Shared omit matcher (inventory/pipeline/skills). When set, omitted archives
   * and members are skipped — same policy as findFiles / inventoryTree.
   */
  omit?: OmitMatcher;
}

export interface ExpandArchivesResult {
  archives: ArchiveRecord[];
  /** Absolute extract-dir roots created/refreshed this run. */
  extractedRoots: string[];
  /** Relative paths of archives skipped by omit. */
  omittedArchives: string[];
}

function isExpandableArchive(filePath: string): boolean {
  return EXPANDABLE_ARCHIVE_EXTS.has(path.extname(filePath).toLowerCase());
}

function relPosix(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

function isOmitted(omit: OmitMatcher | undefined, rel: string): boolean {
  if (!omit) return false;
  return omit.shouldOmit(rel) || omit.shouldOmit(rel.endsWith("/") ? rel : `${rel}/`);
}

function sortPaths(paths: string[]): string[] {
  return paths.sort((a, b) => a.localeCompare(b));
}

/** Sibling extract directory for a zip: `Archive.zip` → `Archive.l9extracted`. */
export function extractDirFor(zipPath: string): string {
  const dir = path.dirname(zipPath);
  const base = path.basename(zipPath, path.extname(zipPath));
  return path.join(dir, base + EXTRACTED_DIR_SUFFIX);
}

/**
 * List member paths inside a zip, rejecting Zip-Slip (`..` / absolute) names.
 *
 * Read from the central directory rather than from `unzip -Z1`. The names a
 * subprocess prints are already its own interpretation of the bytes, so taking
 * them as input meant trusting a second parser about what a member is even
 * called. Directory entries keep a trailing separator so callers can still tell
 * them from files.
 */
export function listZipMembers(zipPath: string): string[] {
  return readZipCentralDirectory(zipPath).entries.map((entry) => {
    const canonical = canonicalMemberPath(entry.name);
    if (canonical.startsWith("/") || canonical.split("/").includes("..")) {
      throw new Error(`refusing to extract unsafe zip member path from ${zipPath}: ${entry.name}`);
    }
    return entry.kind === "directory" ? `${canonical}/` : canonical;
  });
}

/**
 * Reason an existing extraction directory may not be replaced, or null when it may.
 *
 * Ownership must be proven, never inferred from the path. A directory named
 * `Foo.l9extracted` next to `Foo.zip` can be a user directory: without the
 * ownership marker this tool writes, removing it would destroy data this package
 * never created.
 */
export function extractionRefusalReason(extractDir: string): string | null {
  if (!fs.existsSync(extractDir)) return null;
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(extractDir);
  } catch (error) {
    return `extraction target cannot be inspected: ${(error as Error).message}`;
  }
  if (stat.isSymbolicLink()) return `extraction target is a symbolic link: ${extractDir}`;
  if (!stat.isDirectory()) return `extraction target exists and is not a directory: ${extractDir}`;
  if (hasExtractionOwnershipV2(extractDir)) return null;
  if (fs.readdirSync(extractDir).length === 0) {
    return (
      `extraction target exists, is empty, and carries no v2 ownership marker, ` +
      `so it is treated as user data and never replaced: ${extractDir}`
    );
  }
  if (hasLegacyExtractionOwnership(extractDir)) {
    return (
      `extraction target carries a legacy ownership marker without the v2 schema, ` +
      `so it is never replaced; remove it manually to re-extract: ${extractDir}`
    );
  }
  return (
    `extraction target already exists and carries no ${LEGACY_EXTRACTION_OWNER_FILE} ownership marker, ` +
    `so it is treated as user data and never removed: ${extractDir}`
  );
}

/**
 * Record that this tool owns an extraction directory, so a later run may refresh it.
 *
 * The marker is the v2 schema: it binds the directory to the exact archive bytes
 * it was extracted from, and destructive authority requires the exact schema and
 * owner, never a prefix match.
 */
function writeExtractionOwnership(extractDir: string, zipPath: string): void {
  fs.writeFileSync(
    path.join(extractDir, LEGACY_EXTRACTION_OWNER_FILE),
    JSON.stringify(
      {
        schema: LOCAL_FILES_EXTRACTION_SCHEMA,
        owner: EXTRACTION_OWNER_ID,
        archive: path.basename(zipPath),
        archive_sha256: contentHashFile(zipPath),
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

/**
 * Refresh extractDir and materialize allowed members into it.
 *
 * Admission runs through a shared `ArchiveExecutionContext`, so the archive is
 * preflighted once, against the resolved policy, at the depth its caller
 * actually occupies in the tree — never a hard-coded 0.
 *
 * When `allowedMembers` is set, only those canonical paths are written (omit
 * filter). Returns the number of members actually extracted.
 *
 * Throws rather than deleting when the target exists and is not provably this
 * tool's own output, and refuses the whole archive when canonical preflight
 * holds it. Admission is decided before the directory is refreshed, so a hostile
 * archive never reaches the point of removing anything.
 */
export function extractZip(
  zipPath: string,
  extractDir: string,
  allowedMembers?: string[],
  options?: { depth?: number; policy?: Partial<LocalArchivePolicy> },
): number {
  const context = new ArchiveExecutionContext({
    zipPath,
    extractDir,
    depth: options?.depth ?? 0,
    policy: options?.policy,
  });
  const refusal = extractionRefusalReason(extractDir);
  if (refusal !== null) throw new Error(`local-files: ${refusal}`);
  // Admission is decided before the directory is refreshed. Traversal was already
  // checked this early, but symlink members, entry-type violations, collisions and
  // the resource ceilings were not checked here at all: an archive that is held
  // now would previously have removed the operator's existing extraction and then
  // expanded whatever the subprocess was willing to accept.
  if (!context.preflight.accepted) {
    throw new Error(`local-files: refusing to extract ${path.basename(zipPath)}: ${context.holdReasons()}`);
  }

  const selected = context.planMembers(allowedMembers);

  // Materialize into a same-directory candidate, never into the live target. A
  // member that fails mid-write, a CRC mismatch, or a budget stop leaves the
  // candidate to be removed while the operator's existing extraction is
  // untouched. Only a complete, verified candidate is swapped into place.
  const candidate = `${extractDir}.candidate-${crypto.randomUUID().slice(0, 8)}`;
  // The candidate is removed on failure only when this run created it. If a
  // directory already exists at the candidate path — a stale leftover, or a
  // user directory that happens to share the name — mkdir fails and the
  // pre-existing directory is never touched.
  let candidateCreated = false;
  try {
    fs.mkdirSync(candidate, { recursive: false });
    candidateCreated = true;
    let expandedBytes = 0;
    for (const member of selected) {
      expandedBytes += writeMember(
        zipPath, candidate, member, context.policy, context.budget.remainingBytes(), expandedBytes,
      );
    }
    // The marker proves ownership only once every member has landed.
    writeExtractionOwnership(candidate, zipPath);
    swapCandidateIntoPlace(candidate, extractDir);
  } catch (error) {
    if (candidateCreated) fs.rmSync(candidate, { recursive: true, force: true });
    throw error;
  }
  return selected.length;
}

/**
 * Replace `extractDir` with the completed candidate.
 *
 * A directory rename cannot replace a non-empty directory, so when the target
 * exists it is first moved aside to a backup path and restored if the candidate
 * rename fails. Ownership was re-verified immediately before this call, and the
 * backup is removed only after the swap succeeded, so the live target is never
 * the half-written one and a failed swap leaves the previous extraction in place.
 */
function swapCandidateIntoPlace(candidate: string, extractDir: string): void {
  const hadPrevious = fs.existsSync(extractDir);
  const backup = hadPrevious ? `${extractDir}.previous-${crypto.randomUUID().slice(0, 8)}` : null;
  if (backup !== null) {
    // Admission ran before the candidate was written; re-check right before the
    // swap so a concurrent change to the target is not clobbered.
    const refusal = extractionRefusalReason(extractDir);
    if (refusal !== null) throw new Error(`local-files: ${refusal}`);
    fs.renameSync(extractDir, backup);
  }
  try {
    fs.renameSync(candidate, extractDir);
  } catch (error) {
    if (backup !== null) {
      try {
        fs.renameSync(backup, extractDir);
      } catch {
        // Both directories remain on disk; nothing was lost, and the error below
        // names the failure.
      }
    }
    throw error;
  }
  if (backup !== null) fs.rmSync(backup, { recursive: true, force: true });
}

/**
 * Write one preflight-approved member and return the bytes it produced.
 *
 * The ceiling handed to the reader is the smaller of what the member and the
 * archive have left, so the decompressor itself stops a member that produces
 * more than it declared -- the runtime accounting a declared-size check cannot
 * provide. CRC is verified against the central directory before the bytes are
 * allowed to stand.
 */
function writeMember(
  zipPath: string,
  extractDir: string,
  member: PreflightMember,
  policy: LocalArchivePolicy,
  sessionRemainingBytes: number,
  expandedBytes: number,
): number {
  const target = path.join(extractDir, member.canonicalPath);
  // Defence in depth: preflight already rejects traversal, but the write is the
  // irreversible step and it should not depend on an earlier check being right.
  const resolvedRoot = path.resolve(extractDir);
  if (path.resolve(target) !== resolvedRoot && !path.resolve(target).startsWith(resolvedRoot + path.sep)) {
    throw new Error(`local-files: refusing to write outside the extraction directory: ${member.canonicalPath}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const ceiling = Math.min(
    policy.maxSingleMemberUncompressedBytes,
    Math.max(0, policy.maxTotalUncompressedBytesPerArchive - expandedBytes),
    Math.max(0, sessionRemainingBytes - expandedBytes),
  );
  const handle = fs.openSync(target, "w");
  try {
    const result = streamZipMember(
      zipPath,
      member.entry,
      { maxUncompressedBytes: ceiling },
      (chunk) => { fs.writeSync(handle, chunk); },
    );
    if (result.crc32 !== member.entry.crc32) {
      throw new Error(
        `local-files: extracted bytes for ${member.canonicalPath} do not match the CRC in the central directory`,
      );
    }
    return result.bytesWritten;
  } finally {
    fs.closeSync(handle);
  }
}

function walkFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

/**
 * Skip a directory during archive discovery.
 *
 * A `.l9extracted` suffix alone is not evidence that this tool produced the
 * directory, so the ownership marker must also be present. Otherwise the
 * directory is ordinary user content and is walked like any other.
 */
function shouldSkipArchiveDir(
  name: string,
  omit: OmitMatcher | undefined,
  rel: string,
  absolute: string,
): boolean {
  if (name.startsWith(".") || name === "node_modules") return true;
  if (name.endsWith(EXTRACTED_DIR_SUFFIX) && hasLegacyExtractionOwnership(absolute)) return true;
  return isOmitted(omit, rel);
}

/** Discover expandable archives under root (does not enter existing *.l9extracted dirs). */
export function findArchives(
  root: string,
  omit?: OmitMatcher,
): { archives: string[]; omitted: string[] } {
  const absRoot = path.resolve(root);
  const archives: string[] = [];
  const omitted: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = relPosix(absRoot, full);
      if (entry.isDirectory()) {
        if (shouldSkipArchiveDir(entry.name, omit, rel, full)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile() || !isExpandableArchive(full)) continue;
      if (isOmitted(omit, rel)) omitted.push(rel);
      else archives.push(full);
    }
  }

  if (fs.existsSync(absRoot)) walk(absRoot);
  return { archives: sortPaths(archives), omitted: sortPaths(omitted) };
}

function contentHashFile(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return `sha256:${hash.digest("hex")}`;
}

/** Write `<zip>.l9meta.yaml` describing the archive and its extract location. */
export function writeArchiveSidecar(
  zipPath: string,
  extractDir: string,
  memberCount: number,
  extras: Record<string, unknown> = {},
): string {
  const sidecar = sidecarPathFor(zipPath);
  const obj: Record<string, unknown> = {
    schema: "l9.archive-sidecar/v1",
    artifact_type: "archive",
    source_path: zipPath,
    file_name: path.basename(zipPath),
    content_hash: contentHashFile(zipPath),
    size_bytes: fs.statSync(zipPath).size,
    extracted_to: extractDir,
    member_count: memberCount,
    injectable: false,
    expanded_by: "l9-meta-injector.local-files",
    ...extras,
  };
  fs.writeFileSync(
    sidecar,
    serializeYamlObject(obj, { fences: true, trailingNewline: true }),
    "utf8",
  );
  return sidecar;
}

function filterAllowedMembers(
  absRoot: string,
  extractDir: string,
  members: string[],
  omit: OmitMatcher | undefined,
): string[] {
  if (!omit) return members;
  return members.filter((m) => !isOmitted(omit, relPosix(absRoot, path.join(extractDir, m))));
}

function enqueueNestedZips(
  absRoot: string,
  extractDir: string,
  depth: number,
  maxDepth: number,
  omit: OmitMatcher | undefined,
  queue: Array<{ zipPath: string; depth: number }>,
  omittedArchives: string[],
): void {
  if (depth >= maxDepth) return;
  const nested: string[] = [];
  walkFiles(extractDir, nested);
  for (const f of nested) {
    if (!isExpandableArchive(f)) continue;
    const nestedRel = relPosix(absRoot, f);
    if (isOmitted(omit, nestedRel)) {
      omittedArchives.push(nestedRel);
      continue;
    }
    queue.push({ zipPath: f, depth: depth + 1 });
  }
}

function expandOneArchive(
  absRoot: string,
  zipPath: string,
  depth: number,
  opts: ExpandArchivesOptions,
  omit: OmitMatcher | undefined,
): ArchiveRecord {
  const extractDir = extractDirFor(zipPath);
  const members = listZipMembers(zipPath).filter((m) => !m.endsWith("/"));
  const allowed = filterAllowedMembers(absRoot, extractDir, members, omit);

  // Dry run is a promise of zero source-tree mutation, and sibling extraction is
  // a source-tree mutation. But a dry run must run the same admission as a real
  // run: the same preflight, the same ownership refusal, the same hold text —
  // otherwise "what a real run would do" is a claim the code did not check.
  if (opts.dryRun) {
    const context = new ArchiveExecutionContext({ zipPath, extractDir, depth });
    const refusal = extractionRefusalReason(extractDir);
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
    const selected = context.planMembers(allowed);
    if (opts.verbose) {
      process.stderr.write(
        `[l9-meta-injector] local-files: dry-run would extract ${zipPath} → ${extractDir} ` +
          `(depth=${depth}, members=${selected.length}/${members.length})\n`,
      );
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
    process.stderr.write(
      `[l9-meta-injector] local-files: extracting ${zipPath} → ${extractDir} ` +
        `(depth=${depth}, members=${allowed.length}/${members.length})\n`,
    );
  }

  const refusal = extractionRefusalReason(extractDir);
  if (refusal !== null) {
    process.stderr.write(`[l9-meta-injector] local-files: refusing to expand ${zipPath}: ${refusal}\n`);
    return { zipPath, extractDir, memberCount: 0, nestedDepth: depth, heldReason: refusal };
  }

  const memberCount = extractZip(zipPath, extractDir, omit ? allowed : undefined, { depth });
  const sidecarPath = writeArchiveSidecar(zipPath, extractDir, memberCount, {
    nested_depth: depth,
    expanded_at: new Date().toISOString(),
    members_omitted: members.length - allowed.length,
  });
  return { zipPath, extractDir, memberCount, sidecarPath, nestedDepth: depth };
}

/**
 * Expand all zips under root (and nested zips inside freshly extracted trees)
 * up to maxDepth. Writes archive sidecars unless dryRun. Honors `opts.omit`.
 */
export function expandArchivesUnderRoot(root: string, opts: ExpandArchivesOptions): ExpandArchivesResult {
  const absRoot = path.resolve(root);
  const maxDepth = opts.maxDepth ?? 3;
  const archives: ArchiveRecord[] = [];
  const extractedRoots: string[] = [];
  const omittedArchives: string[] = [];
  const omit = opts.omit;

  const found = findArchives(absRoot, omit);
  omittedArchives.push(...found.omitted);
  const queue: Array<{ zipPath: string; depth: number }> = found.archives.map((zipPath) => ({
    zipPath,
    depth: 0,
  }));
  const seen = new Set<string>();

  while (queue.length) {
    const { zipPath, depth } = queue.shift()!;
    const key = path.resolve(zipPath);
    if (seen.has(key)) continue;
    seen.add(key);

    const zipRel = relPosix(absRoot, zipPath);
    if (isOmitted(omit, zipRel)) {
      omittedArchives.push(zipRel);
      if (opts.verbose) {
        process.stderr.write(`[l9-meta-injector] local-files: omit archive ${zipRel}\n`);
      }
      continue;
    }

    const record = expandOneArchive(absRoot, zipPath, depth, opts, omit);
    archives.push(record);
    if (record.heldReason !== undefined) continue;
    extractedRoots.push(record.extractDir);
    enqueueNestedZips(absRoot, record.extractDir, depth, maxDepth, omit, queue, omittedArchives);
  }

  if (opts.verbose || archives.length > 0 || omittedArchives.length > 0) {
    process.stderr.write(
      `[l9-meta-injector] local-files: expanded ${archives.length} archive(s)` +
        (omittedArchives.length ? `, omitted ${omittedArchives.length}` : "") +
        ` under ${absRoot}\n`,
    );
  }

  return { archives, extractedRoots, omittedArchives };
}
