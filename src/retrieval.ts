// retrieval.ts - deterministic file discovery and scan.
// Every encountered filesystem entry receives one terminal disposition. Only
// eligible UTF-8 regular files are returned to the classifier and injector.

import * as fs from "node:fs";
import * as path from "node:path";
import { ScanEntry, HeaderConvention, BodyStructure } from "./schema";
import { splitContent } from "./extract";
import { FRONTMATTER_EXTS, resolveStrategy } from "./comment";
import { buildOmitMatcher, OmitMatcher } from "./omit";
import {
  DiscoveryLedgerEntry,
  DiscoverySummary,
  summarizeDiscovery,
} from "./discovery_contracts";

/** Injector-generated adjacent artifacts must never be rediscovered as inputs. */
function isGeneratedArtifact(name: string): boolean {
  return name.endsWith(".inject.log") || name.endsWith(".l9meta.yaml");
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function isL9InternalPath(relPath: string): boolean {
  return relPath === ".l9" || relPath.startsWith(".l9/");
}

function isHiddenControlPath(relPath: string): boolean {
  return relPath.split("/").some((segment) => segment.startsWith(".") && segment !== ".");
}

interface ProbeResult {
  status: "text" | "binary" | "unsupported_encoding" | "unreadable";
  reason: string;
  sizeBytes?: number;
}

function probeTextFile(filePath: string): ProbeResult {
  let fd: number | null = null;
  try {
    const stat = fs.statSync(filePath);
    fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(Math.min(8192, Math.max(1, stat.size)));
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const prefix = buffer.subarray(0, count);
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] === 0) return { status: "binary", reason: "NUL byte detected", sizeBytes: stat.size };
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(prefix, { stream: count < stat.size });
    } catch (error) {
      return {
        status: "unsupported_encoding",
        reason: `invalid UTF-8 prefix: ${error instanceof Error ? error.message : String(error)}`,
        sizeBytes: stat.size,
      };
    }
    return { status: "text", reason: "regular UTF-8 text file", sizeBytes: stat.size };
  } catch (error) {
    return {
      status: "unreadable",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

export interface FindFilesOptions {
  /** Extra omit patterns in gitignore syntax. */
  omitPatterns?: string[];
  /** Optional omit-file path. */
  omitFile?: string;
  /** When true, built-in SKILL.md protect applies. */
  protectSkillMd?: boolean;
  /** Pre-built matcher; when set, other omit fields are ignored. */
  omit?: OmitMatcher;
}

export interface DiscoveryResult {
  files: string[];
  summary: DiscoverySummary;
}

function record(
  ledger: DiscoveryLedgerEntry[],
  pathName: string,
  kind: DiscoveryLedgerEntry["kind"],
  disposition: DiscoveryLedgerEntry["disposition"],
  reason: string,
  sizeBytes?: number,
): void {
  ledger.push({ path: pathName, kind, disposition, reason, ...(sizeBytes === undefined ? {} : { sizeBytes }) });
}

export function discoverFiles(root: string, glob: string, opts: FindFilesOptions = {}): DiscoveryResult {
  const extMatch = glob.match(/\*\.([a-z0-9]+)$/i);
  const extFilter: string | null = extMatch ? `.${extMatch[1].toLowerCase()}` : null;
  const absRoot = path.resolve(root);
  let rootStat: fs.Stats;
  try {
    rootStat = fs.lstatSync(absRoot);
  } catch (error) {
    throw new Error(`discovery root cannot be inspected: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (rootStat.isSymbolicLink()) throw new Error(`discovery root must not be a symbolic link: ${absRoot}`);
  if (!rootStat.isDirectory()) throw new Error(`discovery root must be a directory: ${absRoot}`);

  const omit = opts.omit ?? buildOmitMatcher({
    root: absRoot,
    patterns: opts.omitPatterns,
    omitFile: opts.omitFile,
    protectSkillMd: opts.protectSkillMd !== false,
    ignoreDirNames: ["node_modules"],
  });

  const files: string[] = [];
  const ledger: DiscoveryLedgerEntry[] = [];

  const walk = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      const rel = toPosix(path.relative(absRoot, directory)) || ".";
      record(ledger, rel, "directory", "unreadable", `directory enumeration failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      const rel = toPosix(path.relative(absRoot, full));
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(full);
      } catch (error) {
        record(ledger, rel, "other", "unreadable", `lstat failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      if (stat.isSymbolicLink()) {
        let target = "unknown target";
        try { target = fs.readlinkSync(full); } catch { /* retained as unknown */ }
        record(ledger, rel, "symlink", "symlink", `symbolic link is not traversed or mutated: ${target}`);
        continue;
      }

      if (stat.isDirectory()) {
        if (isL9InternalPath(rel)) {
          record(ledger, rel, "directory", "generated_artifact", ".l9 is reserved for authority and generated metadata state");
          continue;
        }
        if (omit.shouldOmit(rel) || omit.shouldOmit(`${rel}/`)) {
          record(ledger, rel, "directory", "omitted", "directory matched omit policy");
          continue;
        }
        if (isHiddenControlPath(rel)) {
          record(ledger, rel, "directory", "hidden_control", "hidden control directory is reserved for authority scanning");
          continue;
        }
        record(ledger, rel, "directory", "traversed_directory", "directory traversed for candidate discovery");
        walk(full);
        continue;
      }

      if (!stat.isFile()) {
        record(ledger, rel, "other", "unsupported_entry", "filesystem entry is not a regular file, directory, or symlink", stat.size);
        continue;
      }

      if (isL9InternalPath(rel)) {
        record(ledger, rel, "file", "generated_artifact", ".l9 is reserved for authority and generated metadata state", stat.size);
        continue;
      }
      // Adjacent injector output is identified before omit policy so a generated
      // artifact is never reclassified as merely omitted by a noise pattern
      // (e.g. the built-in `*.log` rule matching `*.inject.log`).
      if (isGeneratedArtifact(entry.name)) {
        record(ledger, rel, "file", "generated_artifact", "adjacent injector output is not an input", stat.size);
        continue;
      }
      if (omit.shouldOmit(rel)) {
        record(ledger, rel, "file", "omitted", "file matched omit policy", stat.size);
        continue;
      }
      if (isHiddenControlPath(rel)) {
        record(ledger, rel, "file", "hidden_control", "hidden control file is reserved for authority scanning", stat.size);
        continue;
      }
      if (extFilter && !entry.name.toLowerCase().endsWith(extFilter)) {
        record(ledger, rel, "file", "extension_filtered", `file does not match requested ${extFilter} filter`, stat.size);
        continue;
      }

      const strategy = resolveStrategy(full, "");
      if (strategy.strategy === "skip-binary") {
        record(ledger, rel, "file", "known_binary", "file extension resolves to skip-binary", stat.size);
        continue;
      }

      // Known-text extensions are eligible on their extension alone; only unknown
      // extensions are sniffed on disk. This keeps a readable known-text file
      // eligible even when the byte probe would fail (OBS-008).
      const ext = path.extname(entry.name).toLowerCase();
      const knownText =
        FRONTMATTER_EXTS.has(ext) ||
        strategy.strategy === "line-comment" ||
        strategy.strategy === "block-comment";
      if (knownText) {
        record(ledger, rel, "file", "eligible", "known text extension", stat.size);
        files.push(full);
        continue;
      }

      const probe = probeTextFile(full);
      if (probe.status === "binary") {
        record(ledger, rel, "file", "binary_detected", probe.reason, probe.sizeBytes);
        continue;
      }
      if (probe.status === "unsupported_encoding") {
        record(ledger, rel, "file", "unsupported_encoding", probe.reason, probe.sizeBytes);
        continue;
      }
      if (probe.status === "unreadable") {
        // Surface the access error to stderr rather than silently conflating it
        // with a real binary, so a dropped input is traceable (OBS-008).
        process.stderr.write(`[l9-meta-injector] retrieval: excluded unreadable file ${full}: ${probe.reason}\n`);
        record(ledger, rel, "file", "unreadable", probe.reason);
        continue;
      }

      record(ledger, rel, "file", "eligible", probe.reason, probe.sizeBytes);
      files.push(full);
    }
  };

  walk(absRoot);
  files.sort((a, b) => a.localeCompare(b));
  return { files, summary: summarizeDiscovery(ledger) };
}

/** Backward-compatible file-only discovery wrapper. */
export function findFiles(root: string, glob: string, opts: FindFilesOptions = {}): string[] {
  return discoverFiles(root, glob, opts).files;
}

function detectBodyStructure(body: string): BodyStructure {
  if (/^##\s+/m.test(body)) return "sections";
  if (/\|.+\|.+\|/.test(body)) return "table-driven";
  if (body.trim().length > 0) return "flat";
  return "unknown";
}

export function scanFiles(filePaths: string[]): ScanEntry[] {
  return filePaths.map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf8");
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isFrontmatter = FRONTMATTER_EXTS.has(ext) && ext !== ".txt" && ext !== ".text";
    const { frontMatter, headerConvention, body } = isFrontmatter
      ? splitContent(raw)
      : { frontMatter: null, headerConvention: "none" as HeaderConvention, body: raw };
    return {
      sourcePath: filePath,
      fileName: path.basename(filePath),
      sizeBytes: stat.size,
      headerConvention: headerConvention as HeaderConvention,
      bodyStructure: detectBodyStructure(body),
      hasExistingFrontMatter: frontMatter !== null,
    };
  });
}
