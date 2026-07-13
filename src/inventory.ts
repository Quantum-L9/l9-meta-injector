// inventory.ts — Filesystem/Dropbox inventory mode.
// Non-destructive: classifies every file AND folder under a root, appends metadata
// headers to text files (reusing the filetype-aware injector), writes a metadata
// sidecar for binaries and for folders, and emits a single inventory manifest
// (JSON + CSV + MD) using the ArtifactInventory record shape. Never moves, renames,
// or deletes anything.
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { contentHash } from "./extract";
import { resolveStrategy, sidecarPathFor } from "./comment";
import { injectFile } from "./inject";
import { NormalizedMeta } from "./schema";
import { MetaSchema, applySchema, targetIncludes, parseCanonicalYaml, toMetaSchema } from "./meta_schema";

export type InventoryArtifactType =
  | "spec" | "code" | "schema" | "prompt" | "research_markdown" | "research_pdf"
  | "config" | "test" | "documentation" | "archive" | "folder" | "unknown";

export type SourceSystem = "dropbox" | "github" | "local" | "upload" | "unknown";

export interface InventoryRecord {
  artifact_id: string;
  source_system: SourceSystem;
  absolute_path: string | null;
  relative_path: string;
  file_name: string;
  extension: string | null;
  artifact_type: InventoryArtifactType;
  mime_type: string | null;
  size_bytes: number | null;
  modified_at: string | null;
  content_hash: string | null;
  parent_folder: string | null;
  depth: number;
  classification_confidence: number;
  evidence_excerpt: string | null;
  unknowns: string[];
  created_at: string | null;
  meta?: Record<string, unknown>; // schema-shaped fields, present when a schema targets "manifest"
}

export interface InventoryConfig {
  root: string;
  outDir: string;
  sourceSystem?: SourceSystem;
  dryRun?: boolean;         // classify + manifest only; no header/sidecar writes
  injectHeaders?: boolean;  // append headers to text files (default true)
  folderSidecars?: boolean; // write <folder>/.l9meta.yaml (default true)
  hashMaxBytes?: number;    // skip content_hash above this size (default 50 MiB)
  ignore?: string[];        // directory names to skip (default node_modules, .git)
  now?: string;             // ISO timestamp (injected for determinism)
  schema?: MetaSchema;      // custom meta structure; when absent the built-in default is used
}

export interface DuplicateCluster {
  content_hash: string;
  count: number;
  wasted_bytes: number;     // (count-1) * size — bytes recoverable if deduped
  keeper: string;           // suggested keeper (shortest path)
  paths: string[];
}

export interface InventoryResult {
  root: string;
  total: number;
  files: number;
  folders: number;
  typeDistribution: Record<string, number>;
  manifestPaths: { json: string; csv: string; md: string; duplicates: string };
  duplicates: DuplicateCluster[];
  records: InventoryRecord[];
}

/** Load and validate a canonical meta-schema YAML file. */
export function loadMetaSchema(filePath: string): MetaSchema {
  return toMetaSchema(parseCanonicalYaml(fs.readFileSync(filePath, "utf8")));
}

/** Group records by content_hash to surface duplicate clusters across the whole tree. */
export function buildDuplicateClusters(records: InventoryRecord[]): DuplicateCluster[] {
  const byHash = new Map<string, InventoryRecord[]>();
  for (const r of records) {
    if (!r.content_hash || r.artifact_type === "folder") continue;
    const g = byHash.get(r.content_hash) ?? [];
    g.push(r);
    byHash.set(r.content_hash, g);
  }
  const clusters: DuplicateCluster[] = [];
  for (const [hash, group] of byHash) {
    if (group.length < 2) continue;
    const paths = group.map((g) => g.relative_path).sort();
    const size = group[0].size_bytes ?? 0;
    clusters.push({
      content_hash: hash,
      count: group.length,
      wasted_bytes: (group.length - 1) * size,
      keeper: paths.slice().sort((a, b) => a.length - b.length || a.localeCompare(b))[0],
      paths,
    });
  }
  return clusters.sort((a, b) => b.wasted_bytes - a.wasted_bytes || b.count - a.count);
}

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".rb", ".php", ".swift", ".kt", ".kts", ".scala", ".sh", ".bash", ".zsh", ".lua", ".r", ".jl", ".pl", ".pm", ".dart", ".ex", ".exs"]);
const CONFIG_EXTS = new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties", ".env", ".lock", ".plist", ".tf", ".tfvars"]);
const ARCHIVE_EXTS = new Set([".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".jar", ".war"]);
const DOC_EXTS = new Set([".txt", ".rst", ".doc", ".docx", ".rtf", ".odt", ".pages"]);

const MIME: Record<string, string> = {
  ".md": "text/markdown", ".txt": "text/plain", ".pdf": "application/pdf",
  ".json": "application/json", ".yaml": "application/yaml", ".yml": "application/yaml",
  ".csv": "text/csv", ".html": "text/html", ".xml": "application/xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".zip": "application/zip",
  ".ts": "text/x-typescript", ".js": "text/javascript", ".py": "text/x-python",
};

interface Classification { type: InventoryArtifactType; confidence: number; evidence: string; unknowns: string[]; }

/** Deterministic, evidence-based classification into the ArtifactInventory taxonomy. */
export function classifyInventory(relPath: string, fileName: string, ext: string, isDir: boolean): Classification {
  if (isDir) return { type: "folder", confidence: 1, evidence: "directory entry", unknowns: [] };
  const fn = fileName.toLowerCase();
  const norm = relPath.replace(/\\/g, "/").toLowerCase();
  const e = ext.toLowerCase();

  if (/\.schema\.(json|ya?ml)$/.test(fn) || fn.endsWith(".schema.json")) return { type: "schema", confidence: 0.92, evidence: "schema filename convention", unknowns: [] };
  if (/\.(test|spec)\.[a-z0-9]+$/.test(fn) || /(^|\/)(tests?|__tests__|spec)\//.test(norm)) return { type: "test", confidence: 0.85, evidence: "test filename/path", unknowns: [] };
  if (/^prompt[-_]/i.test(fileName) || /(^|\/)prompts?\//.test(norm)) return { type: "prompt", confidence: 0.85, evidence: "prompt filename/path", unknowns: [] };
  if (ARCHIVE_EXTS.has(e)) return { type: "archive", confidence: 0.95, evidence: `archive extension ${e}`, unknowns: [] };
  if (e === ".pdf") return { type: "research_pdf", confidence: 0.9, evidence: "pdf document", unknowns: [] };
  if (CODE_EXTS.has(e)) return { type: "code", confidence: 0.9, evidence: `code extension ${e}`, unknowns: [] };
  if (/(^|\/|[-_])spec([-_.]|s?\/)/.test(norm) && (e === ".md" || e === ".markdown" || e === ".yaml" || e === ".yml")) return { type: "spec", confidence: 0.7, evidence: "spec naming", unknowns: [] };
  if (CONFIG_EXTS.has(e)) return { type: "config", confidence: 0.8, evidence: `config extension ${e}`, unknowns: [] };
  if (e === ".md" || e === ".markdown" || e === ".mdx") {
    if (/(^|\/)(research|notes?|papers?)\//.test(norm)) return { type: "research_markdown", confidence: 0.75, evidence: "markdown under research/notes path", unknowns: [] };
    return { type: "documentation", confidence: 0.6, evidence: "markdown document", unknowns: [] };
  }
  if (DOC_EXTS.has(e)) return { type: "documentation", confidence: 0.7, evidence: `document extension ${e}`, unknowns: [] };
  return { type: "unknown", confidence: 0.2, evidence: "no recognized signal", unknowns: [e ? `unrecognized_extension:${e}` : "no_extension"] };
}

function idFor(relPath: string): string {
  return "inv-" + contentHash(relPath).slice(0, 16);
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function serializeYaml(rec: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(rec)) {
    if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${k}: []`);
      else { lines.push(`${k}:`); v.forEach((i) => lines.push(`  - ${JSON.stringify(i)}`)); }
    } else lines.push(`${k}: ${v === null ? "null" : JSON.stringify(v)}`);
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

function walk(root: string, ignore: Set<string>): Array<{ abs: string; isDir: boolean }> {
  const out: Array<{ abs: string; isDir: boolean }> = [];
  function rec(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (ignore.has(e.name)) continue;
        out.push({ abs, isDir: true });
        rec(abs);
      } else if (e.isFile()) {
        out.push({ abs, isDir: false });
      }
    }
  }
  rec(root);
  return out;
}

export function buildRecord(root: string, abs: string, isDir: boolean, cfg: Required<Pick<InventoryConfig, "sourceSystem" | "hashMaxBytes" | "now">>): InventoryRecord {
  const relative = path.relative(root, abs).split(path.sep).join("/") || ".";
  const fileName = path.basename(abs);
  const ext = isDir ? "" : path.extname(abs);
  const cls = classifyInventory(relative, fileName, ext, isDir);
  let size: number | null = null, modified: string | null = null, hash: string | null = null;
  const unknowns = [...cls.unknowns];
  try {
    const st = fs.statSync(abs);
    size = isDir ? null : st.size;
    modified = st.mtime.toISOString();
    if (!isDir && size !== null && size <= cfg.hashMaxBytes) {
      // Hash the raw BYTES (not a utf8-decoded string) so distinct binary payloads
      // don't collapse into the same hash via replacement chars — keeps identity and
      // the dedup view correct for non-UTF8 inputs.
      hash = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    } else if (!isDir && size !== null) {
      unknowns.push("content_hash_skipped:file_too_large");
    }
  } catch (err) {
    unknowns.push(`stat_failed:${(err as Error).message}`);
  }
  const parent = path.dirname(relative);
  return {
    artifact_id: idFor(relative),
    source_system: cfg.sourceSystem,
    absolute_path: abs,
    relative_path: relative,
    file_name: fileName,
    extension: ext || null,
    artifact_type: cls.type,
    mime_type: isDir ? "inode/directory" : (MIME[ext.toLowerCase()] ?? null),
    size_bytes: size,
    modified_at: modified,
    content_hash: hash,
    parent_folder: parent === "" || parent === "." ? null : parent,
    depth: relative === "." ? 0 : relative.split("/").length,
    classification_confidence: cls.confidence,
    evidence_excerpt: cls.evidence,
    unknowns,
    created_at: cfg.now,
  };
}

/** Run a non-destructive inventory over a filesystem root. */
export function inventoryTree(config: InventoryConfig): InventoryResult {
  const cfg = {
    sourceSystem: config.sourceSystem ?? "local",
    dryRun: config.dryRun ?? false,
    injectHeaders: config.injectHeaders ?? true,
    folderSidecars: config.folderSidecars ?? true,
    hashMaxBytes: config.hashMaxBytes ?? 50 * 1024 * 1024,
    // Default-ignore the inventory output dir so re-runs never inventory/mutate
    // previously generated manifests and sidecars.
    ignore: new Set(config.ignore ?? ["node_modules", ".git", ".l9inventory"]),
    now: config.now ?? "1970-01-01T00:00:00.000Z",
  };
  // Absolutize root so absolute_path is truly absolute and relative_path/manifest
  // output are deterministic regardless of the caller's cwd.
  const root = path.resolve(config.root);
  // outDir must not BE the root: its generated manifests would then sit directly in
  // root and get re-inventoried (and possibly injected) on the next run.
  if (path.resolve(config.outDir) === root) {
    throw new Error(
      "inventory: outDir must not equal the root directory (generated manifests would be re-inventoried); use a subdirectory such as <root>/.l9inventory"
    );
  }
  // If the chosen outDir lives inside root, ignore its top-level directory name too,
  // so a custom --out under root can't re-inventory or mutate its own generated output.
  const relOut = path.relative(root, path.resolve(config.outDir));
  if (relOut && !relOut.startsWith("..") && !path.isAbsolute(relOut)) {
    cfg.ignore.add(relOut.split(path.sep)[0]);
  }
  const entries = walk(root, cfg.ignore);
  const records: InventoryRecord[] = [];
  const typeDistribution: Record<string, number> = {};
  let files = 0, folders = 0;

  const schema = config.schema;
  for (const { abs, isDir } of entries) {
    const rec = buildRecord(root, abs, isDir, cfg);
    // The meta object written to headers/sidecars: schema-driven when provided, else default.
    let metaObj: Record<string, unknown>;
    if (schema) {
      const applied = applySchema(rec as unknown as Record<string, unknown>, schema);
      if (applied.missingRequired.length) rec.unknowns.push(...applied.missingRequired.map((n) => `missing_required:${n}`));
      metaObj = applied.fields;
      // Honor target:"manifest" — attach the schema-shaped meta to the record so it
      // flows into inventory.json (otherwise "manifest" in target would be a no-op).
      if (targetIncludes(schema, "manifest")) rec.meta = applied.fields;
    } else {
      metaObj = rec as unknown as Record<string, unknown>;
    }
    records.push(rec);
    typeDistribution[rec.artifact_type] = (typeDistribution[rec.artifact_type] || 0) + 1;
    if (isDir) folders++; else files++;

    if (cfg.dryRun) continue;

    if (isDir) {
      if (cfg.folderSidecars && targetIncludes(schema, "sidecar")) {
        writeFolderSidecar(abs, metaObj);
      }
      continue;
    }

    // Files: text files get an inline header via the filetype-aware injector;
    // binaries / comment-less formats get a metadata sidecar. Body is preserved.
    const raw = safeRead(abs);
    const strategy = raw === null ? "skip-binary" : resolveStrategy(abs, raw).strategy;
    const canHeader = raw !== null && (strategy === "yaml-frontmatter" || strategy === "line-comment" || strategy === "block-comment");
    if (cfg.injectHeaders && canHeader && targetIncludes(schema, "file_header")) {
      // With a schema, the header intentionally carries only the schema's fields
      // (tests assert built-in fields like mcp_primitive are absent), so it isn't a
      // structural NormalizedMeta. injectFile consumes meta as a generic field bag;
      // asInjectableMeta marks that single, deliberate boundary rather than casting inline.
      const headerMeta = schema ? asInjectableMeta(metaObj) : recordAsMeta(rec);
      try {
        injectFile(abs, headerMeta, { dryRun: false, outDir: config.outDir, verbose: false, writeInjectLog: false });
      } catch { if (targetIncludes(schema, "sidecar")) writeSidecar(abs, metaObj); }
    } else if (targetIncludes(schema, "sidecar")) {
      writeSidecar(abs, metaObj);
    }
  }

  const duplicates = buildDuplicateClusters(records);
  const manifestPaths = writeManifests(config.outDir, root, records, typeDistribution, duplicates, cfg.now, cfg.dryRun);
  return { root, total: records.length, files, folders, typeDistribution, manifestPaths, duplicates, records };
}

// Read only the first 8 KB — enough to decide binary-vs-text and pick a strategy,
// without loading a whole large binary into memory. injectFile re-reads the full
// file itself when it actually needs the body.
function safeRead(abs: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(abs, "r");
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return null; // binary
    return buf.subarray(0, n).toString("utf8");
  } catch { return null; } finally { if (fd !== null) fs.closeSync(fd); }
}

function writeSidecar(abs: string, obj: Record<string, unknown>): void {
  try { fs.writeFileSync(sidecarPathFor(abs), serializeYaml(obj), "utf8"); } catch { /* unwritable — recorded in manifest only */ }
}

// Write a folder's .l9meta.yaml non-destructively: if one already exists (possibly
// user-authored), merge so existing keys win and only missing keys are added,
// rather than blindly clobbering it. Mirrors the read/merge intent of injectFile.
// Boundary: a schema-driven header carries arbitrary schema fields, not the
// NormalizedMeta shape. injectFile serializes meta as a generic key/value bag, so
// this single documented cast is the one place that crosses that boundary.
function asInjectableMeta(fields: Record<string, unknown>): NormalizedMeta {
  return fields as unknown as NormalizedMeta;
}

function writeFolderSidecar(dir: string, metaObj: Record<string, unknown>): void {
  const p = path.join(dir, ".l9meta.yaml");
  // Non-destructive: never rewrite an existing folder sidecar. Round-tripping a
  // user-authored file through the constrained canonical parser could corrupt it
  // (escapes, nested maps), so leave any existing sidecar exactly as-is.
  if (fs.existsSync(p)) return;
  try { fs.writeFileSync(p, serializeYaml(metaObj), "utf8"); } catch { /* unwritable dir — recorded, skip */ }
}

// Map an InventoryRecord onto the minimal header the injector serializes. The injector
// preserves the file body and reconciles fields; inventory only needs the identity block.
function recordAsMeta(rec: InventoryRecord): NormalizedMeta {
  return {
    id: rec.artifact_id,
    title: rec.file_name,
    artifact_type: "source",
    mcp_primitive: "resource",
    callable: false,
    retrievable: true,
    injectable: true,
    namespace: "inventory",
    sharing_scope: "agnostic",
    source_path: rec.relative_path,
    content_hash: rec.content_hash ?? "Unknown",
    token_cost_estimate: 0,
    authority: "inventory",
    created_or_detected_at: rec.created_at ?? "Unknown",
    // inventory-specific fields ride along; reconcile/serialize keep them verbatim
    inventory_type: rec.artifact_type,
    classification_confidence: rec.classification_confidence,
    evidence: rec.evidence_excerpt ?? "Unknown",
  } as unknown as NormalizedMeta;
}

function writeManifests(outDir: string, root: string, records: InventoryRecord[], dist: Record<string, number>, duplicates: DuplicateCluster[], now: string, _dryRun: boolean): { json: string; csv: string; md: string; duplicates: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "inventory.json");
  const csvPath = path.join(outDir, "inventory.csv");
  const mdPath = path.join(outDir, "inventory.md");
  const dupPath = path.join(outDir, "inventory-duplicates.json");

  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: now, root, total: records.length, typeDistribution: dist, duplicateClusters: duplicates.length, records }, null, 2), "utf8");
  const totalWasted = duplicates.reduce((a, d) => a + d.wasted_bytes, 0);
  fs.writeFileSync(dupPath, JSON.stringify({ generatedAt: now, root, clusters: duplicates.length, totalWastedBytes: totalWasted, duplicates }, null, 2), "utf8");

  const cols: (keyof InventoryRecord)[] = ["relative_path", "file_name", "extension", "artifact_type", "size_bytes", "modified_at", "content_hash", "depth", "classification_confidence", "evidence_excerpt", "unknowns"];
  const rows = [cols.join(",")];
  for (const r of records) rows.push(cols.map((c) => csvCell(Array.isArray(r[c]) ? (r[c] as string[]).join("; ") : r[c])).join(","));
  fs.writeFileSync(csvPath, rows.join("\n") + "\n", "utf8");

  const md = [`# Inventory — ${root}`, ``, `Generated: ${now}  |  Total entries: ${records.length}  |  Duplicate clusters: ${duplicates.length}  |  Recoverable: ${totalWasted} bytes`, ``, `## Type distribution`, ``, ...Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- **${k}**: ${v}`)];
  if (duplicates.length) {
    md.push(``, `## Duplicate clusters (consolidated dedup view)`, ``, `Files sharing a content hash across the tree. Read-only — nothing is deleted.`, ``, `| # | count | wasted bytes | keeper | other paths |`, `|---|---|---|---|---|`);
    duplicates.slice(0, 100).forEach((d, i) => md.push(`| ${i + 1} | ${d.count} | ${d.wasted_bytes} | \`${d.keeper}\` | ${d.paths.filter((p) => p !== d.keeper).join("<br>")} |`));
  }
  md.push(``, `## Entries`, ``, `| path | type | conf | size | evidence |`, `|---|---|---|---|---|`, ...records.slice(0, 500).map((r) => `| ${r.relative_path} | ${r.artifact_type} | ${r.classification_confidence} | ${r.size_bytes ?? ""} | ${r.evidence_excerpt ?? ""} |`));
  if (records.length > 500) md.push(``, `_(${records.length - 500} more entries in inventory.json / inventory.csv)_`);
  fs.writeFileSync(mdPath, md.join("\n") + "\n", "utf8");

  return { json: jsonPath, csv: csvPath, md: mdPath, duplicates: dupPath };
}
