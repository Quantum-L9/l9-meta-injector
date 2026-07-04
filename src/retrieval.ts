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

/** Injector-generated artifacts must never be re-discovered as inputs. */
function isGeneratedArtifact(name: string): boolean {
  return name.endsWith(".inject.log") || name.endsWith(".l9meta.yaml");
}

/** Read a small prefix and report whether it looks binary (has a NUL byte). */
function looksBinaryOnDisk(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
  } catch {
    return true;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

export function findFiles(root: string, glob: string): string[] {
  // Extract extension filter from glob pattern (e.g. **/*.md → .md). No `*.ext`
  // suffix (e.g. **/*) → every text file the injector can safely annotate.
  const extMatch = glob.match(/\*\.([a-z0-9]+)$/i);
  const extFilter: string | null = extMatch ? `.${extMatch[1].toLowerCase()}` : null;

  const results: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        if (isGeneratedArtifact(entry.name)) continue; // skip our own .inject.log / .l9meta.yaml
        const full = path.join(dir, entry.name);
        if (extFilter) {
          if (entry.name.toLowerCase().endsWith(extFilter)) results.push(full);
          continue;
        }
        // No extension filter: include any text file. Cheap ext-based strategy check
        // first; only sniff the bytes when the extension is unknown (sidecar fallback).
        const ext = path.extname(entry.name).toLowerCase();
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
  if (fs.existsSync(root)) walk(root);
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
