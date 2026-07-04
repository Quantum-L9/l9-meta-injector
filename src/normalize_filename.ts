// normalize_filename.ts — Normalize .md filenames to snake_case; write sidecar .normalize.log.yaml
// --dry-run: write sidecar only, never rename. Live: sidecar + rename flag (rename is a separate pass).
import * as path from "path";
import * as fs from "fs";

export interface NormalizeFilenameResult {
  originalPath: string;
  normalizedName: string;
  normalizedPath: string;
  changed: boolean;
  sidecarPath: string;
}

export function toSnakeCase(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[-\s]+/g, "_")
    .replace(/[^a-z0-9_.]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

export function normalizeFilename(filePath: string): NormalizeFilenameResult {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);

  // Preserve dot-convention prefix: ns.primitive.Stem.md → ns.primitive.snake_stem.md
  const dotMatch = stem.match(/^([a-z_]+\.[a-z_]+\.)(.+)$/i);
  let normalizedStem: string;
  if (dotMatch) {
    normalizedStem = dotMatch[1].toLowerCase() + toSnakeCase(dotMatch[2]);
  } else if (/^Prompt-/i.test(stem)) {
    normalizedStem = "Prompt-" + toSnakeCase(stem.replace(/^Prompt-/i, ""));
  } else {
    normalizedStem = toSnakeCase(stem);
  }

  const normalizedBase = normalizedStem + ext.toLowerCase();
  const normalizedPath = path.join(dir, normalizedBase);
  return { originalPath: filePath, normalizedName: normalizedBase, normalizedPath, changed: normalizedBase !== base, sidecarPath: filePath + ".normalize.log.yaml" };
}

export interface NormalizeFilenameOptions { dryRun: boolean; verbose: boolean; }

export function normalizeFilenameWithLog(filePath: string, opts: NormalizeFilenameOptions): NormalizeFilenameResult {
  const result = normalizeFilename(filePath);
  if (!result.changed) return result;
  const log = [
    `# normalize.log`, `original: "${result.originalPath}"`, `normalized: "${result.normalizedPath}"`,
    `dry_run: ${opts.dryRun}`, `timestamp: "${new Date().toISOString()}"`,
    `status: ${opts.dryRun ? "pending_rename" : "sidecar_written"}`,
  ].join("\n") + "\n";
  fs.writeFileSync(result.sidecarPath, log, "utf8");
  if (opts.verbose) process.stderr.write(`[normalize${opts.dryRun ? "-dry-run" : ""}] ${path.basename(result.originalPath)} → ${result.normalizedName}\n`);
  return result;
}

export function normalizeFilenames(filePaths: string[], opts: NormalizeFilenameOptions): NormalizeFilenameResult[] {
  return filePaths.map((fp) => normalizeFilenameWithLog(fp, opts));
}
