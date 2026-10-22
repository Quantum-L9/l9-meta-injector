// inject.ts — Filetype-aware metadata injection. Five-way reconciliation.
// Markdown → YAML frontmatter. Code/config → comment-wrapped block (line or
// block comment), placed after any shebang. Comment-less formats (JSON), .txt/.text,
// and unknown text → a `<file>.l9meta.yaml` sidecar (the file itself is untouched). Binary/media
// are skipped. Body is preserved verbatim; the injected block carries sentinels so a
// re-run replaces it instead of duplicating. Writes <file>.inject.log on any mutation.
import * as fs from "node:fs";
import * as path from "node:path";
import { NormalizedMeta, InjectionRecord, MetaRecord, asRecord, normalizeMetaRecord, FieldDiff } from "./schema";
import { serializeToYamlFrontMatter } from "./normalize_meta";
import { contentHash } from "./extract";
import { probeFileEncoding } from "./encoding";
import { reconcileFields, reconcileFieldsAsync, diffsToLogYaml } from "./reconcile_fields";
import { getAdapter } from "./llm";
import { MetricsCollector } from "./metrics";
import { parseCanonicalYaml } from "./meta_schema";
import { inspectFrontMatterDocument, patchManagedFrontMatter } from "./frontmatter_patch";
import {
  resolveStrategy, StrategySpec, frontMatterInner, yamlToBlock, stripInjectedBlock,
  extractInjectedYaml, applyCommentInjection, sidecarPathFor, detectNewlineConvention,
} from "./comment";
import { replaceFileAtomically } from "./durable_write";

// Parse the inner YAML of an existing injected header into a plain object.
// Delegates to the canonical parser (meta_schema.ts) so all parsing rules —
// quoted-string escaping, inline lists, depth guards — are applied consistently.
// Returns {} on malformed input rather than throwing, to keep injection safe.
function parseExistingMeta(fm: string | null): MetaRecord {
  if (!fm) return {};
  const inner = fm.replace(/^---\s*\n/, "").replace(/\n?---\s*$/, "");
  try {
    const obj = parseCanonicalYaml(inner);
    // Normalize the typed BaseHeader fields (numbers/booleans) so the reconcile edge
    // compares against buildMeta's output like-for-like, not string-vs-number (ICC-005).
    return typeof obj === "object" && obj !== null ? normalizeMetaRecord(obj as MetaRecord) : {};
  } catch {
    return {};
  }
}

export interface InjectOptions {
  dryRun: boolean;
  outDir: string;
  verbose: boolean;
  writeInjectLog: boolean;
  /** When false, dry-run returns an in-memory plan without creating diff files. */
  writeDryRunDiff?: boolean;
  /**
   * When false, write incoming meta as-is. Inventory already harvested and
   * applied derive-or-Unknown precedence; reconcile would resurrect the
   * placeholders that pass just discarded.
   */
  reconcileExisting?: boolean;
}

interface ReadCtx {
  raw: string;
  spec: StrategySpec;
  cleanBody: string;
  originalBodyHash: string;
  existingMeta: MetaRecord;
}

/**
 * Body bytes that identity hashes describe: the file with the L9 managed
 * carrier removed. Frontmatter uses the body after the fences; comment
 * strategies use `stripInjectedBlock`; sidecar and skip-binary use the raw
 * text. An unsafe frontmatter document is returned unchanged so inventory
 * can still hash it; `injectFile` refuses that case separately.
 */
export function managedCarrierFreeBody(filePath: string, raw: string): string {
  const spec = resolveStrategy(filePath, raw);
  if (spec.strategy === "yaml-frontmatter") {
    const inspected = inspectFrontMatterDocument(raw);
    return inspected.safe ? inspected.body : raw;
  }
  if (spec.strategy === "line-comment" || spec.strategy === "block-comment") {
    return stripInjectedBlock(raw, spec);
  }
  return raw;
}

// Read the file and derive the clean body + any prior metadata, per strategy.
function readForInjection(filePath: string): ReadCtx {
  // Injection rewrites the whole file, so eligibility is decided over the whole
  // file. Decoding non-UTF-8 bytes here would substitute replacement characters
  // and then write them back, silently destroying the original encoding; a
  // filetype that "looks textual" is not evidence that its bytes are UTF-8.
  const encoding = probeFileEncoding(filePath);
  if (encoding.status !== "utf8") {
    throw new Error(`UNSUPPORTED_ENCODING: ${filePath}: ${encoding.reason}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const spec = resolveStrategy(filePath, raw);

  if (spec.strategy === "yaml-frontmatter") {
    const inspected = inspectFrontMatterDocument(raw);
    if (!inspected.safe) {
      throw new Error(`FRONTMATTER_UNSAFE: ${filePath}: ${inspected.issue?.code ?? "unknown"}: ${inspected.issue?.message ?? "unsafe header"}`);
    }
    const cleanBody = managedCarrierFreeBody(filePath, raw);
    return {
      raw,
      spec,
      cleanBody,
      originalBodyHash: contentHash(cleanBody),
      existingMeta: normalizeMetaRecord(inspected.meta),
    };
  }
  if (spec.strategy === "line-comment" || spec.strategy === "block-comment") {
    const cleanBody = managedCarrierFreeBody(filePath, raw);
    const existingYaml = extractInjectedYaml(raw, spec);
    return { raw, spec, cleanBody, originalBodyHash: contentHash(cleanBody), existingMeta: parseExistingMeta(existingYaml) };
  }
  // sidecar (and skip-binary, which callers guard against): file body is untouched.
  let existingMeta: MetaRecord = {};
  const sidecar = sidecarPathFor(filePath);
  if (fs.existsSync(sidecar)) existingMeta = parseExistingMeta(fs.readFileSync(sidecar, "utf8"));
  const cleanBody = managedCarrierFreeBody(filePath, raw);
  return { raw, spec, cleanBody, originalBodyHash: contentHash(cleanBody), existingMeta };
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
    const patched = patchManagedFrontMatter(ctx.raw, asRecord(finalMeta));
    if (!patched.safe) {
      throw new Error(`FRONTMATTER_UNSAFE: ${filePath}: ${patched.issue?.code ?? "unknown"}: ${patched.issue?.message ?? "unsafe header"}`);
    }
    return {
      targetPath: filePath,
      newContent: patched.content,
      addedLines: yamlFm,
      postBodyHash: contentHash(patched.body),
      strategy: ctx.spec.strategy,
    };
  }

  if (ctx.spec.strategy === "line-comment" || ctx.spec.strategy === "block-comment") {
    // The block adopts the file's own line-ending convention and sits after any
    // BOM, so the only bytes that change are the block's (DATA-002).
    const newline = detectNewlineConvention(ctx.cleanBody);
    const block = yamlToBlock(frontMatterInner(yamlFm), ctx.spec, newline);
    const newContent = applyCommentInjection(ctx.cleanBody, block, newline);
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

interface PlannedTargetState {
  targetExists: boolean;
  wouldChange: boolean;
  expectedContentHash: string;
  actualContentHash?: string;
}

type WriteResult = PlannedTargetState & {
  dryRunDiffPath?: string;
  injectLogPath?: string;
};

/** Mirrored dry-run path. Refuses a source_path that would leave outDir. */
function containedDiffPath(outDir: string, sourcePath: string): string {
  const posix = sourcePath.split(path.sep).join("/");
  const segments = posix.split("/");
  if (!posix || posix === "." || posix.startsWith("/") || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`dry-run diff escapes output directory: ${sourcePath}`);
  }
  const leaf = segments[segments.length - 1];
  segments[segments.length - 1] = `${leaf}.diff`;
  const diffPath = path.resolve(outDir, ...segments);
  const root = path.resolve(outDir);
  const relative = path.relative(root, diffPath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`dry-run diff escapes output directory: ${sourcePath}`);
  }
  return diffPath;
}

function writeInjection(filePath: string, built: Built, diffs: FieldDiff[], opts: InjectOptions, sourcePath: string): WriteResult {
  // Capture target state before any write. This keeps the plan truthful in both
  // read-only check mode and future apply mode, where reading after the write
  // would incorrectly report wouldChange=false.
  const targetExists = fs.existsSync(built.targetPath);
  const actualContent = targetExists ? fs.readFileSync(built.targetPath, "utf8") : undefined;
  const out: WriteResult = {
    targetExists,
    wouldChange: actualContent !== built.newContent,
    expectedContentHash: contentHash(built.newContent),
    actualContentHash: actualContent === undefined ? undefined : contentHash(actualContent),
  };
  if (opts.dryRun) {
    if (opts.writeDryRunDiff !== false) {
      out.dryRunDiffPath = containedDiffPath(opts.outDir, sourcePath);
      fs.mkdirSync(path.dirname(out.dryRunDiffPath), { recursive: true });
      const added = built.addedLines.split("\n").map((l) => `+ ${l}`).join("\n");
      const tgt = built.sidecarPath ? built.sidecarPath : filePath;
      fs.writeFileSync(out.dryRunDiffPath, `--- ${filePath}\n+++ ${tgt} (${built.strategy})\n${added}\n`, "utf8");
      if (opts.verbose) process.stderr.write(`[dry-run] ${out.dryRunDiffPath}\n`);
    }
  } else {
    // Staged beside the target and renamed in: the source is never truncated
    // mid-write, and a hard link to it elsewhere keeps its old bytes.
    replaceFileAtomically(built.targetPath, built.newContent);
    if (opts.writeInjectLog && diffs.some((d) => d.action !== "keep")) {
      out.injectLogPath = filePath + ".inject.log";
      replaceFileAtomically(out.injectLogPath, diffsToLogYaml(filePath, diffs, new Date().toISOString()));
    }
    if (opts.verbose) process.stderr.write(`[inject:${built.strategy}] ${built.targetPath}\n`);
  }
  return out;
}

function record(filePath: string, ctx: ReadCtx, built: Built, finalMeta: NormalizedMeta, opts: InjectOptions, paths: WriteResult): InjectionRecord {
  return {
    sourcePath: filePath,
    targetPath: built.targetPath,
    targetExists: paths.targetExists,
    wouldChange: paths.wouldChange,
    expectedContentHash: paths.expectedContentHash,
    actualContentHash: paths.actualContentHash,
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

function finalizeInjectionMeta(
  meta: NormalizedMeta,
  merged: MetaRecord,
  reconcileExisting: boolean,
): NormalizedMeta {
  if (reconcileExisting === false) return meta;
  return { ...meta, ...merged } as NormalizedMeta;
}

export async function injectFileAsync(filePath: string, meta: NormalizedMeta, opts: InjectOptions, metrics?: MetricsCollector): Promise<InjectionRecord> {
  const ctx = readForInjection(filePath);
  // Widen the typed producer (NormalizedMeta) onto the shared reconcile-edge record
  // type instead of the untyped Object.fromEntries clone (ICC-005). reconcile reads
  // incoming without mutating it, so an alias is safe.
  const incomingMeta: MetaRecord = asRecord(meta);
  const skipReconcile = opts.reconcileExisting === false;
  const { merged, diffs } = skipReconcile
    ? { merged: incomingMeta, diffs: [] }
    : getAdapter().classify
      ? await reconcileFieldsAsync(ctx.existingMeta, incomingMeta, metrics)
      : reconcileFields(ctx.existingMeta, incomingMeta);
  const finalMeta = finalizeInjectionMeta(meta, merged, opts.reconcileExisting !== false);
  const built = buildInjection(filePath, finalMeta, ctx);
  const paths = writeInjection(filePath, built, diffs, opts, finalMeta.source_path);
  return record(filePath, ctx, built, finalMeta, opts, paths);
}

export function injectFile(filePath: string, meta: NormalizedMeta, opts: InjectOptions): InjectionRecord {
  const ctx = readForInjection(filePath);
  const incomingMeta = asRecord(meta);
  const skipReconcile = opts.reconcileExisting === false;
  const { merged, diffs } = skipReconcile
    ? { merged: incomingMeta, diffs: [] }
    : reconcileFields(ctx.existingMeta, incomingMeta);
  const finalMeta = finalizeInjectionMeta(meta, merged, opts.reconcileExisting !== false);
  const built = buildInjection(filePath, finalMeta, ctx);
  const paths = writeInjection(filePath, built, diffs, opts, finalMeta.source_path);
  return record(filePath, ctx, built, finalMeta, opts, paths);
}
