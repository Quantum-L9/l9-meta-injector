// namespace.ts — Deterministic path → namespace + sharing_scope + primitive_folder
import * as path from "node:path";
import { SharingScope } from "./schema";
import { FRONTMATTER_EXTS } from "./comment";

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

// The only slice of NamespaceConfig that namespace resolution actually reads.
// Declaring the narrow port (ICC-004) keeps resolveNamespace honest about its
// inputs and lets callers pass a minimal object without the IO/threshold fields.
export type NamespaceInput = Pick<NamespaceConfig, "namespace" | "namespaceGlobs">;

const SHARED_SIGNALS = ["_shared", "shared", "core", "common", "universal"];
const PRIVATE_SIGNALS = ["l9", "plastos", "legal", "ops", "private"];

function matchGlob(filePath: string, glob: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  // Escape EVERY regex metacharacter first, then re-introduce glob wildcards.
  // Previously only "." was escaped, so a glob containing "[", "(", "+", "\\", …
  // reached RegExp and could throw (DoS) or backtrack (ReDoS) — finding SEC-002.
  const pat = glob
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape all metachars (including the "*" re-added next)
    .replace(/\\\*\\\*/g, "DSTAR")          // "**" (now "\*\*") → cross-segment placeholder
    .replace(/\\\*/g, "[^/]*")              // "*"  (now "\*")   → single-segment wildcard
    .replace(/DSTAR/g, ".*");
  try {
    return new RegExp(`(^|/)${pat}($|/)`).test(norm);
  } catch {
    return false; // a malformed glob never matches, rather than throwing
  }
}

function deriveSharingScope(filePath: string): SharingScope {
  // Shared/private-scope signal words are a *prose taxonomy* convention (a namespace-wide
  // "this primitive is shared" folder like `_shared/` or `l9/`) — the exact same restriction
  // classify.ts already applies to its own path-pattern taxonomy heuristics (see the comment
  // at classify.ts's FRONTMATTER_EXTS check): they must not be applied to code/config files.
  // Without this guard, a generic English word like "core" or "common" used as an internal
  // implementation-detail folder name (e.g. a legacy tool's own `core/` module, unrelated to
  // any namespace-sharing convention) silently flips sharing_scope for arbitrary source files,
  // which the assurance gate (verify.ts checkSharingScope) then reports as a false violation.
  if (!FRONTMATTER_EXTS.has(path.extname(filePath).toLowerCase())) return "agnostic";
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

export function resolveNamespace(filePath: string, cfg: NamespaceInput, typeHint?: string): NamespaceResolution {
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
