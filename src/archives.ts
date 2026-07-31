// archives.ts — Opt-in local-files archive expansion for the pipeline.
// Default (repo) mode never extracts. When PipelineConfig.localFiles is set,
// .zip archives under the scan root are expanded into sibling *.l9extracted/
// directories, members become ordinary inject targets, and each archive gets an
// inventory-style sidecar (<zip>.l9meta.yaml). Nested zips are expanded up to
// maxDepth. Extraction uses the system `unzip` binary (macOS/Linux); missing
// unzip fails closed with an explicit error.
//
// Omit (ADR-017): when an OmitMatcher is supplied, omitted archives are not
// expanded / sidecared, omitted directories are not walked, and omitted zip
// members (e.g. SKILL.md, *.log, __pycache__) are not extracted onto disk.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { sidecarPathFor } from "./comment";
import { serializeYamlObject } from "./yaml_serialize";
import type { OmitMatcher } from "./omit";

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
}

export interface ExpandArchivesOptions {
  /** When true, still extract (local-files is mutative for archives) but skip sidecar writes. */
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

/** Sibling extract directory for a zip: `Archive.zip` → `Archive.l9extracted`. */
export function extractDirFor(zipPath: string): string {
  const dir = path.dirname(zipPath);
  const base = path.basename(zipPath, path.extname(zipPath));
  return path.join(dir, base + EXTRACTED_DIR_SUFFIX);
}

function requireUnzip(): string {
  try {
    return execFileSync("which", ["unzip"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(
      "local-files mode requires the `unzip` binary on PATH (macOS/Linux). " +
        "Install unzip or run without --local-files / localFiles.",
    );
  }
}

/** List member paths inside a zip; reject Zip-Slip (`..` / absolute) names. */
export function listZipMembers(zipPath: string): string[] {
  requireUnzip();
  const out = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const members = out.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
  for (const name of members) {
    const normalized = name.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error(`refusing to extract unsafe zip member path from ${zipPath}: ${name}`);
    }
  }
  return members;
}

/**
 * Remove and recreate extractDir, then unzip allowed members into it.
 * When `allowedMembers` is set, only those paths are extracted (omit filter).
 * Returns the number of non-directory members actually extracted.
 */
export function extractZip(
  zipPath: string,
  extractDir: string,
  allowedMembers?: string[],
): number {
  requireUnzip();
  const members = listZipMembers(zipPath);
  const files = members.filter((m) => !m.endsWith("/"));
  const toExtract = allowedMembers
    ? files.filter((m) => allowedMembers.includes(m))
    : files;

  if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  if (toExtract.length === 0) return 0;

  // Pass member names explicitly so omitted paths (SKILL.md, *.log, …) never land on disk.
  execFileSync("unzip", ["-q", "-o", "-d", extractDir, zipPath, ...toExtract], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
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

/** Discover expandable archives under root (does not enter existing *.l9extracted dirs). */
export function findArchives(
  root: string,
  omit?: OmitMatcher,
): { archives: string[]; omitted: string[] } {
  const absRoot = path.resolve(root);
  const archives: string[] = [];
  const omitted: string[] = [];
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = relPosix(absRoot, full);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        if (entry.name.endsWith(EXTRACTED_DIR_SUFFIX)) continue; // don't re-discover from prior extract trees as roots
        if (isOmitted(omit, rel)) continue;
        walk(full);
      } else if (entry.isFile() && isExpandableArchive(full)) {
        if (isOmitted(omit, rel)) omitted.push(rel);
        else archives.push(full);
      }
    }
  }
  if (fs.existsSync(absRoot)) walk(absRoot);
  archives.sort();
  omitted.sort();
  return { archives, omitted };
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

  // Queue of { zip, depth }. Start with archives found outside any extract tree.
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

    const extractDir = extractDirFor(zipPath);
    const members = listZipMembers(zipPath).filter((m) => !m.endsWith("/"));
    const allowed = omit
      ? members.filter((m) => {
          const memberAbs = path.join(extractDir, m);
          const memberRel = relPosix(absRoot, memberAbs);
          return !isOmitted(omit, memberRel);
        })
      : members;

    if (opts.verbose) {
      process.stderr.write(
        `[l9-meta-injector] local-files: extracting ${zipPath} → ${extractDir} ` +
          `(depth=${depth}, members=${allowed.length}/${members.length})\n`,
      );
    }
    const memberCount = extractZip(zipPath, extractDir, omit ? allowed : undefined);
    extractedRoots.push(extractDir);

    let sidecarPath: string | undefined;
    if (!opts.dryRun) {
      sidecarPath = writeArchiveSidecar(zipPath, extractDir, memberCount, {
        nested_depth: depth,
        expanded_at: new Date().toISOString(),
        members_omitted: members.length - allowed.length,
      });
    }

    archives.push({ zipPath, extractDir, memberCount, sidecarPath, nestedDepth: depth });

    if (depth >= maxDepth) continue;

    // Nested zips inside this extract tree (omit still applies to their relative paths)
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

  if (opts.verbose || archives.length > 0 || omittedArchives.length > 0) {
    process.stderr.write(
      `[l9-meta-injector] local-files: expanded ${archives.length} archive(s)` +
        (omittedArchives.length ? `, omitted ${omittedArchives.length}` : "") +
        ` under ${absRoot}\n`,
    );
  }

  return { archives, extractedRoots, omittedArchives };
}
