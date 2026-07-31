// archives.ts — Opt-in local-files archive expansion for the pipeline.
// Default (repo) mode never extracts. When PipelineConfig.localFiles is set,
// .zip archives under the scan root are expanded into sibling *.l9extracted/
// directories, members become ordinary inject targets, and each archive gets an
// inventory-style sidecar (<zip>.l9meta.yaml). Nested zips are expanded up to
// maxDepth. Extraction uses the system `unzip` binary (macOS/Linux); missing
// unzip fails closed with an explicit error.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { sidecarPathFor } from "./comment";
import { serializeYamlObject } from "./yaml_serialize";

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
}

export interface ExpandArchivesResult {
  archives: ArchiveRecord[];
  /** Absolute extract-dir roots created/refreshed this run. */
  extractedRoots: string[];
}

function isExpandableArchive(filePath: string): boolean {
  return EXPANDABLE_ARCHIVE_EXTS.has(path.extname(filePath).toLowerCase());
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
  const members = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const name of members) {
    const normalized = name.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error(`refusing to extract unsafe zip member path from ${zipPath}: ${name}`);
    }
  }
  return members;
}

/**
 * Remove and recreate extractDir, then unzip into it.
 * Returns the number of non-directory member paths listed by unzip.
 */
export function extractZip(zipPath: string, extractDir: string): number {
  requireUnzip();
  const members = listZipMembers(zipPath);
  if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync("unzip", ["-q", "-o", "-d", extractDir, zipPath], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  // Count files (not directory markers that end with /)
  return members.filter((m) => !m.endsWith("/")).length;
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
export function findArchives(root: string): string[] {
  const all: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        if (entry.name.endsWith(EXTRACTED_DIR_SUFFIX)) continue; // don't re-discover from prior extract trees as roots
        walk(full);
      } else if (entry.isFile() && isExpandableArchive(full)) {
        all.push(full);
      }
    }
  }
  if (fs.existsSync(root)) walk(root);
  return all.sort();
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
 * up to maxDepth. Writes archive sidecars unless dryRun.
 */
export function expandArchivesUnderRoot(root: string, opts: ExpandArchivesOptions): ExpandArchivesResult {
  const maxDepth = opts.maxDepth ?? 3;
  const archives: ArchiveRecord[] = [];
  const extractedRoots: string[] = [];

  // Queue of { zip, depth }. Start with archives found outside any extract tree.
  const queue: Array<{ zipPath: string; depth: number }> = findArchives(root).map((zipPath) => ({
    zipPath,
    depth: 0,
  }));
  const seen = new Set<string>();

  while (queue.length) {
    const { zipPath, depth } = queue.shift()!;
    const key = path.resolve(zipPath);
    if (seen.has(key)) continue;
    seen.add(key);

    const extractDir = extractDirFor(zipPath);
    if (opts.verbose) {
      process.stderr.write(
        `[l9-meta-injector] local-files: extracting ${zipPath} → ${extractDir} (depth=${depth})\n`,
      );
    }
    const memberCount = extractZip(zipPath, extractDir);
    extractedRoots.push(extractDir);

    let sidecarPath: string | undefined;
    if (!opts.dryRun) {
      sidecarPath = writeArchiveSidecar(zipPath, extractDir, memberCount, {
        nested_depth: depth,
        expanded_at: new Date().toISOString(),
      });
    }

    archives.push({ zipPath, extractDir, memberCount, sidecarPath, nestedDepth: depth });

    if (depth >= maxDepth) continue;

    // Nested zips inside this extract tree
    const nested: string[] = [];
    walkFiles(extractDir, nested);
    for (const f of nested) {
      if (isExpandableArchive(f)) queue.push({ zipPath: f, depth: depth + 1 });
    }
  }

  if (opts.verbose || archives.length > 0) {
    process.stderr.write(
      `[l9-meta-injector] local-files: expanded ${archives.length} archive(s) under ${root}\n`,
    );
  }

  return { archives, extractedRoots };
}
