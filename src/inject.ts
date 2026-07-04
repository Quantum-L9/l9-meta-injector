// inject.ts — Filetype-aware metadata injection. Five-way reconciliation.
// Markdown/txt → YAML frontmatter. Code/config → comment-wrapped block (line or
// block comment), placed after any shebang. Comment-less formats (JSON) and unknown
// text → a `<file>.l9meta.yaml` sidecar (the file itself is untouched). Binary/media
// are skipped. Body is preserved verbatim; the injected block carries sentinels so a
// re-run replaces it instead of duplicating. Writes <file>.inject.log on any mutation.
import * as fs from "fs";
import * as path from "path";
import { NormalizedMeta, InjectionRecord } from "./schema";
import { serializeToYamlFrontMatter } from "./normalize_meta";
import { contentHash, splitContent, stripExistingFrontMatter } from "./extract";
import { reconcileFields, reconcileFieldsAsync, diffsToLogYaml } from "./reconcile_fields";
import { FieldDiff } from "./schema";
import { getAdapter } from "./llm";
import {
  resolveStrategy, StrategySpec, frontMatterInner, yamlToBlock, stripInjectedBlock,
  extractInjectedYaml, applyCommentInjection, sidecarPathFor,
} from "./comment";

function parseExistingMeta(fm: string | null): Record<string, unknown> {
  if (!fm) return {};
  const result: Record<string, unknown> = {};
  const lines = fm.replace(/^---\s*\n/, "").replace(/\n?---\s*$/, "").split("\n");
  let currentKey: string | null = null;
  let currentList: string[] = [];
  for (const line of lines) {
    const li = line.match(/^\s{2}-\s+(.+)/);
    if (li && currentKey) { currentList.push(li[1].replace(/^["']|["']$/g, "")); continue; }
    if (currentKey && currentList.length > 0) { result[currentKey] = currentList; currentList = []; currentKey = null; }
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)/);
    if (kv) {
      const val = kv[2].trim();
      if (val === "") { currentKey = kv[1]; currentList = []; }
      else if (val === "true") result[kv[1]] = true;
      else if (val === "false") result[kv[1]] = false;
      else if (/^\d+$/.test(val)) result[kv[1]] = parseInt(val, 10);
      else result[kv[1]] = val.replace(/^["']|["']$/g, "");
    }
  }
  if (currentKey && currentList.length > 0) result[currentKey] = currentList;
  return result;
}

export interface InjectOptions { dryRun: boolean; outDir: string; verbose: boolean; writeInjectLog: boolean; }

interface ReadCtx {
  raw: string;
  spec: StrategySpec;
  cleanBody: string;
  originalBodyHash: string;
  existingMeta: Record<string, unknown>;
}

// Read the file and derive the clean body + any prior metadata, per strategy.
function readForInjection(filePath: string): ReadCtx {
  const raw = fs.readFileSync(filePath, "utf8");
  const spec = resolveStrategy(filePath, raw);

  if (spec.strategy === "yaml-frontmatter") {
    const { frontMatter } = splitContent(raw);
    const cleanBody = stripExistingFrontMatter(raw);
    return { raw, spec, cleanBody, originalBodyHash: contentHash(cleanBody), existingMeta: parseExistingMeta(frontMatter) };
  }
  if (spec.strategy === "line-comment" || spec.strategy === "block-comment") {
    const cleanBody = stripInjectedBlock(raw, spec);
    const existingYaml = extractInjectedYaml(raw, spec);
    return { raw, spec, cleanBody, originalBodyHash: contentHash(cleanBody), existingMeta: parseExistingMeta(existingYaml) };
  }
  // sidecar (and skip-binary, which callers guard against): file body is untouched.
  let existingMeta: Record<string, unknown> = {};
  const sidecar = sidecarPathFor(filePath);
  if (fs.existsSync(sidecar)) existingMeta = parseExistingMeta(fs.readFileSync(sidecar, "utf8"));
  return { raw, spec, cleanBody: raw, originalBodyHash: contentHash(raw), existingMeta };
}

interface Built {
  targetPath: string;      // file that gets written (source file, or sidecar)
  newContent: string;      // full new content of targetPath
  addedLines: string;      // for dry-run diff display
  postBodyHash: string;
  sidecarPath?: string;
  strategy: string;
}

// Build the final content for the resolved strategy.
function buildInjection(filePath: string, finalMeta: NormalizedMeta, ctx: ReadCtx): Built {
  const yamlFm = serializeToYamlFrontMatter(finalMeta);

  if (ctx.spec.strategy === "yaml-frontmatter") {
    const newContent = yamlFm + "\n\n" + ctx.cleanBody.replace(/^\n+/, "");
    const postBodyHash = contentHash(newContent.slice(yamlFm.length + 2).replace(/^\n+/, ""));
    return { targetPath: filePath, newContent, addedLines: yamlFm, postBodyHash, strategy: ctx.spec.strategy };
  }

  if (ctx.spec.strategy === "line-comment" || ctx.spec.strategy === "block-comment") {
    const block = yamlToBlock(frontMatterInner(yamlFm), ctx.spec);
    const newContent = applyCommentInjection(ctx.cleanBody, block);
    const postBodyHash = contentHash(stripInjectedBlock(newContent, ctx.spec));
    return { targetPath: filePath, newContent, addedLines: block, postBodyHash, strategy: ctx.spec.strategy };
  }

  // sidecar: source file is left byte-for-byte; metadata goes to <file>.l9meta.yaml
  const sidecar = sidecarPathFor(filePath);
  return {
    targetPath: sidecar, newContent: yamlFm + "\n", addedLines: yamlFm,
    postBodyHash: ctx.originalBodyHash, sidecarPath: sidecar, strategy: ctx.spec.strategy,
  };
}

function writeInjection(filePath: string, built: Built, diffs: FieldDiff[], opts: InjectOptions): { dryRunDiffPath?: string; injectLogPath?: string } {
  const out: { dryRunDiffPath?: string; injectLogPath?: string } = {};
  if (opts.dryRun) {
    fs.mkdirSync(opts.outDir, { recursive: true });
    out.dryRunDiffPath = path.join(opts.outDir, path.basename(filePath) + ".diff");
    const added = built.addedLines.split("\n").map((l) => `+ ${l}`).join("\n");
    const tgt = built.sidecarPath ? built.sidecarPath : filePath;
    fs.writeFileSync(out.dryRunDiffPath, `--- ${filePath}\n+++ ${tgt} (${built.strategy})\n${added}\n`, "utf8");
    if (opts.verbose) process.stderr.write(`[dry-run] ${out.dryRunDiffPath}\n`);
  } else {
    fs.writeFileSync(built.targetPath, built.newContent, "utf8");
    if (opts.writeInjectLog && diffs.some((d) => d.action !== "keep")) {
      out.injectLogPath = filePath + ".inject.log";
      fs.writeFileSync(out.injectLogPath, diffsToLogYaml(filePath, diffs, new Date().toISOString()), "utf8");
    }
    if (opts.verbose) process.stderr.write(`[inject:${built.strategy}] ${built.targetPath}\n`);
  }
  return out;
}

function record(filePath: string, ctx: ReadCtx, built: Built, finalMeta: NormalizedMeta, opts: InjectOptions, paths: { dryRunDiffPath?: string; injectLogPath?: string }): InjectionRecord {
  return {
    sourcePath: filePath,
    originalBodyHash: ctx.originalBodyHash,
    postInjectionBodyHash: built.postBodyHash,
    bodyPreserved: built.postBodyHash === ctx.originalBodyHash,
    headerInjected: !opts.dryRun,
    injectionStrategy: built.strategy,
    sidecarPath: built.sidecarPath,
    dryRunDiffPath: paths.dryRunDiffPath,
    injectLogPath: paths.injectLogPath,
    meta: finalMeta,
  };
}

export async function injectFileAsync(filePath: string, meta: NormalizedMeta, opts: InjectOptions): Promise<InjectionRecord> {
  const ctx = readForInjection(filePath);
  const incomingMeta = Object.fromEntries(Object.entries(meta));
  const { merged, diffs } = getAdapter().classify
    ? await reconcileFieldsAsync(ctx.existingMeta, incomingMeta)
    : reconcileFields(ctx.existingMeta, incomingMeta);
  const finalMeta = { ...meta, ...merged } as NormalizedMeta;
  const built = buildInjection(filePath, finalMeta, ctx);
  const paths = writeInjection(filePath, built, diffs, opts);
  return record(filePath, ctx, built, finalMeta, opts, paths);
}

export function injectFile(filePath: string, meta: NormalizedMeta, opts: InjectOptions): InjectionRecord {
  const ctx = readForInjection(filePath);
  const { merged, diffs } = reconcileFields(ctx.existingMeta, Object.fromEntries(Object.entries(meta)));
  const finalMeta = { ...meta, ...merged } as NormalizedMeta;
  const built = buildInjection(filePath, finalMeta, ctx);
  const paths = writeInjection(filePath, built, diffs, opts);
  return record(filePath, ctx, built, finalMeta, opts, paths);
}
