// retrieval.ts — File discovery and scan. Supports .md and .txt.
// .txt files are treated as pure prose: no frontmatter parsing, all fields via regex-seed + LLM assist.
import * as fs from "fs";
import * as path from "path";
import { ScanEntry, HeaderConvention, BodyStructure } from "./schema";
import { splitContent } from "./extract";

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt"]);

export function findFiles(root: string, glob: string): string[] {
  // Extract extension filter from glob pattern (e.g. **/*.md → .md, **/*.txt → .txt, **/* → all supported)
  const extMatch = glob.match(/\*\.([a-z]+)$/);
  const extFilter: string | null = extMatch ? `.${extMatch[1]}` : null;

  const results: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extFilter ? entry.name.endsWith(extFilter) : SUPPORTED_EXTENSIONS.has(ext)) {
          results.push(path.join(dir, entry.name));
        }
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
    // .txt is always headerConvention="none" — pure prose, no frontmatter
    const { frontMatter, headerConvention, body } = ext === ".txt"
      ? { frontMatter: null, headerConvention: "none" as HeaderConvention, body: raw }
      : splitContent(raw);
    return {
      sourcePath: fp, fileName: path.basename(fp), sizeBytes: stat.size,
      headerConvention: headerConvention as HeaderConvention,
      bodyStructure: detectBodyStructure(body),
      hasExistingFrontMatter: frontMatter !== null,
    };
  });
}
