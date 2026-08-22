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
// maxDepth. Extraction uses a fixed-path system `unzip` binary (macOS/Linux);
// missing unzip fails closed with an explicit error.
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
import { execFileSync } from "node:child_process";
import { sidecarPathFor } from "./comment";
import { serializeYamlObject } from "./yaml_serialize";
import type { OmitMatcher } from "./omit";
import { LEGACY_EXTRACTION_OWNER_FILE, hasLegacyExtractionOwnership } from "./local_source";

/** Directory-name suffix for an expanded archive (sibling of the .zip). */
export const EXTRACTED_DIR_SUFFIX = ".l9extracted";

/** Archive extensions expanded in local-files mode (v1: zip only). */
export const EXPANDABLE_ARCHIVE_EXTS = new Set([".zip"]);

/** Fixed absolute unzip paths — avoid PATH lookup (Sonar S4036). */
const UNZIP_CANDIDATES = ["/usr/bin/unzip", "/bin/unzip"] as const;

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

/** Resolve a fixed-path unzip binary; never consult $PATH. */
export function resolveUnzipBinary(): string {
  for (const candidate of UNZIP_CANDIDATES) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    "local-files mode requires unzip at /usr/bin/unzip or /bin/unzip (macOS/Linux). " +
      "Install unzip or run without --local-files / localFiles.",
  );
}

function runUnzip(args: string[]): string {
  const unzip = resolveUnzipBinary();
  return execFileSync(unzip, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function assertSafeZipMember(zipPath: string, name: string): void {
  const normalized = name.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`refusing to extract unsafe zip member path from ${zipPath}: ${name}`);
  }
}

/** List member paths inside a zip; reject Zip-Slip (`..` / absolute) names. */
export function listZipMembers(zipPath: string): string[] {
  const out = runUnzip(["-Z1", zipPath]);
  const members = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const name of members) assertSafeZipMember(zipPath, name);
  return members;
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
  if (fs.readdirSync(extractDir).length === 0) return null;
  if (hasLegacyExtractionOwnership(extractDir)) return null;
  return (
    `extraction target already exists and carries no ${LEGACY_EXTRACTION_OWNER_FILE} ownership marker, ` +
    `so it is treated as user data and never removed: ${extractDir}`
  );
}

/** Record that this tool owns an extraction directory, so a later run may refresh it. */
function writeExtractionOwnership(extractDir: string, zipPath: string): void {
  fs.writeFileSync(
    path.join(extractDir, LEGACY_EXTRACTION_OWNER_FILE),
    JSON.stringify({ owner: "l9-meta-injector.local-files", archive: path.basename(zipPath) }, null, 2),
    "utf8",
  );
}

/**
 * Refresh extractDir and unzip allowed members into it.
 * When `allowedMembers` is set, only those paths are extracted (omit filter).
 * Returns the number of non-directory members actually extracted.
 *
 * Throws rather than deleting when the target exists and is not provably this
 * tool's own output.
 */
export function extractZip(
  zipPath: string,
  extractDir: string,
  allowedMembers?: string[],
): number {
  const refusal = extractionRefusalReason(extractDir);
  if (refusal !== null) throw new Error(`local-files: ${refusal}`);

  const members = listZipMembers(zipPath);
  const files = members.filter((m) => !m.endsWith("/"));
  const toExtract = allowedMembers
    ? files.filter((m) => allowedMembers.includes(m))
    : files;

  if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  writeExtractionOwnership(extractDir, zipPath);

  if (toExtract.length === 0) return 0;

  // Pass member names explicitly so omitted paths (SKILL.md, *.log, …) never land on disk.
  runUnzip(["-q", "-o", "-d", extractDir, zipPath, ...toExtract]);
  return toExtract.length;
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
  // a source-tree mutation. The archive is still listed and reported, so a dry run
  // states exactly what a real run would materialize.
  if (opts.dryRun) {
    if (opts.verbose) {
      process.stderr.write(
        `[l9-meta-injector] local-files: dry-run would extract ${zipPath} → ${extractDir} ` +
          `(depth=${depth}, members=${allowed.length}/${members.length})\n`,
      );
    }
    return {
      zipPath,
      extractDir,
      memberCount: 0,
      nestedDepth: depth,
      heldReason: `dry-run: ${allowed.length} member(s) would be extracted to ${extractDir}`,
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

  const memberCount = extractZip(zipPath, extractDir, omit ? allowed : undefined);
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
