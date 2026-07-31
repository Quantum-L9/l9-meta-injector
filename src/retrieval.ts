// retrieval.ts — File discovery and scan. Supports every text filetype in a repo.
// A glob ending in `*.ext` filters to that extension; otherwise all text files are
// returned (binary/media extensions excluded, and unknown extensions null-byte-sniffed).
// Markdown/frontmatter files parse their header; everything else defers to the
// filetype-aware injection strategy (see comment.ts).
import * as fs from "fs";
import * as path from "path";
import { ScanEntry, HeaderConvention, BodyStructure } from "./schema";
import { splitContent } from "./extract";
import { FRONTMATTER_EXTS, resolveStrategy } from "./comment";
import { buildOmitMatcher, OmitMatcher } from "./omit";

/** Injector-generated artifacts must never be re-discovered as inputs. */
function isGeneratedArtifact(name: string): boolean {
  return name.endsWith(".inject.log") || name.endsWith(".l9meta.yaml");
}

/**
 * Read a small prefix and report whether it looks binary (has a NUL byte). A file
 * that cannot be opened is excluded (returns true) but — unlike before — the read
 * error is surfaced to stderr rather than silently conflated with a real binary
 * (finding OBS-008), so a dropped input is traceable to its access error.
 */
function looksBinaryOnDisk(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
  } catch (err) {
    process.stderr.write(`[l9-meta-injector] retrieval: excluded unreadable file ${filePath}: ${(err as Error).message}\n`);
    return true;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

export interface FindFilesOptions {
  /** Extra omit patterns (gitignore-style). */
  omitPatterns?: string[];
  /** Optional omit-file path. */
  omitFile?: string;
  /**
   * When true (default), built-in SKILL.md protect applies.
   * Skills mode sets false so skill entrypoints are discoverable.
   */
  protectSkillMd?: boolean;
  /** Pre-built matcher; when set, other omit fields are ignored. */
  omit?: OmitMatcher;
}

export function findFiles(root: string, glob: string, opts: FindFilesOptions = {}): string[] {
  // Extract extension filter from glob pattern (e.g. **/*.md → .md). No `*.ext`
  // suffix (e.g. **/*) → every text file the injector can safely annotate.
  const extMatch = glob.match(/\*\.([a-z0-9]+)$/i);
  const extFilter: string | null = extMatch ? `.${extMatch[1].toLowerCase()}` : null;

  const absRoot = path.resolve(root);
  const omit = opts.omit ?? buildOmitMatcher({
    root: absRoot,
    patterns: opts.omitPatterns,
    omitFile: opts.omitFile,
    protectSkillMd: opts.protectSkillMd !== false,
    ignoreDirNames: ["node_modules"],
  });

  const results: string[] = [];
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(absRoot, full).split(path.sep).join("/");

      if (entry.isDirectory()) {
        // Keep prior behavior: skip hidden dirs (except we still omit via matcher for __pycache__).
        if (entry.name.startsWith(".") && entry.name !== ".") continue;
        if (omit.shouldOmit(rel) || omit.shouldOmit(rel + "/")) continue;
        walk(full);
      } else if (entry.isFile()) {
        if (isGeneratedArtifact(entry.name)) continue; // skip our own .inject.log / .l9meta.yaml
        if (omit.shouldOmit(rel)) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (extFilter && !entry.name.toLowerCase().endsWith(extFilter)) continue; // filtered out
        // Cheap ext-based strategy check first; only sniff the bytes when the
        // extension is unknown (sidecar fallback). This runs for filtered globs
        // too, so a glob like **/*.foo over binary content is still excluded.
        const spec = resolveStrategy(full, ""); // ext-only decision (empty content)
        if (spec.strategy === "skip-binary") continue; // known binary/media extension
        const knownText = FRONTMATTER_EXTS.has(ext)
          || spec.strategy === "line-comment"
          || spec.strategy === "block-comment";
        if (!knownText && looksBinaryOnDisk(full)) continue; // unknown ext: exclude binaries
        results.push(full);
      }
    }
  }
  if (fs.existsSync(absRoot)) walk(absRoot);
  return results;
}

function detectBodyStructure(body: string): BodyStructure {
  if (/^##\s+/m.test(body)) return "sections";
  if (/\|.+\|.+\|/.test(body)) return "table-driven";
  if (body.trim().length > 0) return "flat";
  return "unknown";
}

export function scanFiles(filePaths: string[]): ScanEntry[] {
  return filePaths.map((fp) => {
    const raw = fs.readFileSync(fp, "utf8");
    const stat = fs.statSync(fp);
    const ext = path.extname(fp).toLowerCase();
    // Only markdown-family files carry YAML frontmatter. .txt and all non-prose
    // filetypes are headerConvention="none" (their metadata rides in comment blocks
    // or a sidecar, resolved at injection time).
    const isFrontmatter = FRONTMATTER_EXTS.has(ext) && ext !== ".txt" && ext !== ".text";
    const { frontMatter, headerConvention, body } = isFrontmatter
      ? splitContent(raw)
      : { frontMatter: null, headerConvention: "none" as HeaderConvention, body: raw };
    return {
      sourcePath: fp, fileName: path.basename(fp), sizeBytes: stat.size,
      headerConvention: headerConvention as HeaderConvention,
      bodyStructure: detectBodyStructure(body),
      hasExistingFrontMatter: frontMatter !== null,
    };
  });
}
