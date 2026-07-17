// namespace.ts — Deterministic path → namespace + sharing_scope + primitive_folder
import * as path from "path";
import { SharingScope } from "./schema";

// SharingScope is single-sourced in schema.ts (finding ICC-002 / RAA-002).
export type { SharingScope } from "./schema";

export interface NamespaceResolution {
  namespace: string;
  sharingScope: SharingScope;
  primitiveFolder: string;
  idStem: string;
}

export interface NamespaceConfig {
  namespace: string;
  authority: string;
  nearDupThreshold: number;
  hashPrefixLength: number;
  outputDir: string;
  indexDir: string;
  namespaceGlobs?: Array<{ glob: string; namespace: string }>;
}

const SHARED_SIGNALS = ["_shared", "shared", "core", "common", "universal"];
const PRIVATE_SIGNALS = ["l9", "plastos", "legal", "ops", "private"];

function matchGlob(filePath: string, glob: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  const pat = glob.replace(/\./g, "\\.").replace(/\*\*/g, "DSTAR").replace(/\*/g, "[^/]*").replace(/DSTAR/g, ".*");
  return new RegExp(`(^|/)${pat}($|/)`).test(norm);
}

function deriveSharingScope(filePath: string): SharingScope {
  const parts = filePath.replace(/\\/g, "/").toLowerCase().split("/");
  if (SHARED_SIGNALS.some((s) => parts.includes(s))) return "shared";
  if (PRIVATE_SIGNALS.some((s) => parts.includes(s))) return "private";
  return "agnostic";
}

function derivePrimitiveFolder(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  const dot = base.match(/\.(skill|playbook|kernel|context|prompt|doctrine|test|script)\./);
  if (dot) return dot[1];
  const norm = filePath.replace(/\\/g, "/").toLowerCase();
  const segMap: Record<string, string> = {
    skills: "skill", playbooks: "playbook", kernels: "kernel", contexts: "context",
    prompts: "prompt", doctrines: "doctrine", tests: "test", scripts: "script",
  };
  for (const [seg, prim] of Object.entries(segMap)) {
    if (norm.includes(`/${seg}/`)) return prim;
  }
  if (/^prompt-/i.test(path.basename(filePath))) return "prompt";
  return "unknown";
}

export function toSnakeStem(filename: string): string {
  const stem = path.basename(filename, path.extname(filename))
    .replace(/^Prompt-/i, "")
    .replace(/\.[a-z]+$/i, "");
  return stem.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[-\s]+/g, "_")
    .replace(/[^a-z0-9_]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

export function resolveNamespace(filePath: string, cfg: NamespaceConfig, typeHint?: string): NamespaceResolution {
  const norm = filePath.replace(/\\/g, "/");
  let namespace = cfg.namespace ?? "l9";
  if (cfg.namespaceGlobs) {
    for (const e of cfg.namespaceGlobs) {
      if (matchGlob(norm, e.glob)) { namespace = e.namespace; break; }
    }
  }
  const sharingScope = deriveSharingScope(filePath);
  // Folder derivation wins; when the path yields no primitive folder, fall back to the
  // resolved artifact_type so the id reads e.g. l9.source.app rather than l9.unknown.app.
  let primitiveFolder = derivePrimitiveFolder(filePath);
  if (primitiveFolder === "unknown" && typeHint && typeHint !== "unknown") primitiveFolder = typeHint;
  const stem = toSnakeStem(path.basename(filePath));
  return { namespace, sharingScope, primitiveFolder, idStem: `${namespace}.${primitiveFolder}.${stem}` };
}
