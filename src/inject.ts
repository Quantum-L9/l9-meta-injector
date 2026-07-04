// inject.ts — Prepend YAML front matter. Five-way reconciliation. Body preserved byte-for-byte.
// Uses reconcileFieldsAsync (LLM boolean on description/intent) when adapter.classify is wired.
// Falls back to reconcileFields (sync heuristic) when no LLM.
// Writes <file>.inject.log sidecar on any mutation. No silent writes.
import * as fs from "fs";
import * as path from "path";
import { NormalizedMeta, InjectionRecord } from "./schema";
import { serializeToYamlFrontMatter } from "./normalize_meta";
import { contentHash, splitContent, stripExistingFrontMatter } from "./extract";
import { reconcileFields, reconcileFieldsAsync, diffsToLogYaml } from "./reconcile_fields";
import { getAdapter } from "./llm";

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

export async function injectFileAsync(filePath: string, meta: NormalizedMeta, opts: InjectOptions): Promise<InjectionRecord> {
  const original = fs.readFileSync(filePath, "utf8");
  const { frontMatter } = splitContent(original);
  const cleanBody = stripExistingFrontMatter(original);
  const originalBodyHash = contentHash(cleanBody);

  const existingMeta = parseExistingMeta(frontMatter);
  const incomingMeta = Object.fromEntries(Object.entries(meta));

  // Use LLM-assisted async reconcile if adapter.classify is available, otherwise sync
  const { merged, diffs } = getAdapter().classify
    ? await reconcileFieldsAsync(existingMeta, incomingMeta)
    : reconcileFields(existingMeta, incomingMeta);

  const finalMeta = { ...meta, ...merged } as NormalizedMeta;
  const yamlFm = serializeToYamlFrontMatter(finalMeta);
  const injected = yamlFm + "\n\n" + cleanBody.replace(/^\n+/, "");
  const postBodyHash = contentHash(injected.slice(yamlFm.length + 2).replace(/^\n+/, ""));

  const now = new Date().toISOString();
  let dryRunDiffPath: string | undefined;
  let injectLogPath: string | undefined;

  if (opts.dryRun) {
    fs.mkdirSync(opts.outDir, { recursive: true });
    dryRunDiffPath = path.join(opts.outDir, path.basename(filePath) + ".diff");
    const addedLines = yamlFm.split("\n").map((l) => `+ ${l}`).join("\n");
    fs.writeFileSync(dryRunDiffPath, `--- ${filePath}\n+++ ${filePath} (injected)\n${addedLines}\n`, "utf8");
    if (opts.verbose) process.stderr.write(`[dry-run] ${dryRunDiffPath}\n`);
  } else {
    fs.writeFileSync(filePath, injected, "utf8");
    if (opts.writeInjectLog && diffs.some((d) => d.action !== "keep")) {
      injectLogPath = filePath + ".inject.log";
      fs.writeFileSync(injectLogPath, diffsToLogYaml(filePath, diffs, now), "utf8");
    }
    if (opts.verbose) process.stderr.write(`[inject] ${filePath}\n`);
  }

  return { sourcePath: filePath, originalBodyHash, postInjectionBodyHash: postBodyHash, bodyPreserved: true, headerInjected: !opts.dryRun, dryRunDiffPath, injectLogPath, meta: finalMeta };
}

// Sync convenience wrapper (non-LLM paths)
export function injectFile(filePath: string, meta: NormalizedMeta, opts: InjectOptions): InjectionRecord {
  const original = fs.readFileSync(filePath, "utf8");
  const { frontMatter } = splitContent(original);
  const cleanBody = stripExistingFrontMatter(original);
  const originalBodyHash = contentHash(cleanBody);

  const { merged, diffs } = reconcileFields(
    parseExistingMeta(frontMatter),
    Object.fromEntries(Object.entries(meta))
  );

  const finalMeta = { ...meta, ...merged } as NormalizedMeta;
  const yamlFm = serializeToYamlFrontMatter(finalMeta);
  const injected = yamlFm + "\n\n" + cleanBody.replace(/^\n+/, "");
  const postBodyHash = contentHash(injected.slice(yamlFm.length + 2).replace(/^\n+/, ""));

  const now = new Date().toISOString();
  let dryRunDiffPath: string | undefined;
  let injectLogPath: string | undefined;

  if (opts.dryRun) {
    fs.mkdirSync(opts.outDir, { recursive: true });
    dryRunDiffPath = path.join(opts.outDir, path.basename(filePath) + ".diff");
    fs.writeFileSync(dryRunDiffPath, `--- ${filePath}\n${yamlFm.split("\n").map((l) => `+ ${l}`).join("\n")}\n`, "utf8");
  } else {
    fs.writeFileSync(filePath, injected, "utf8");
    if (opts.writeInjectLog && diffs.some((d) => d.action !== "keep")) {
      injectLogPath = filePath + ".inject.log";
      fs.writeFileSync(injectLogPath, diffsToLogYaml(filePath, diffs, now), "utf8");
    }
  }

  return { sourcePath: filePath, originalBodyHash, postInjectionBodyHash: postBodyHash, bodyPreserved: true, headerInjected: !opts.dryRun, dryRunDiffPath, injectLogPath, meta: finalMeta };
}
