// repository_interpretation.ts — deterministic structured interpretation of a repository.
//
// The inventory stage answers "what files are here". This stage answers a strictly larger
// but still evidence-bound question: "what do a small set of structured surfaces *declare*
// about themselves". It reads package manifests, service specs, and Python route
// decorators, and returns facts that each carry the exact path, line, and content hash
// they came from.
//
// Boundaries this module holds, without exception:
//   - Declared or directly observed only. Nothing is inferred from a filename when the
//     answer lives in the file body, and nothing is concluded across repositories.
//   - No model, no network, no clock, no randomness, no locale-sensitive ordering.
//   - A fact that cannot be established becomes a diagnostic. `Unknown` beats a guess.
//   - Observing a route proves a decorator exists at a path and line. It does not prove
//     the handler is implemented, reachable, correctly wired, or deployed.
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { InventoryRecord } from "./inventory";

export const INTERPRETATION_PROFILE_ID = "meta-injector-structured-interpretation";
export const INTERPRETATION_PROFILE_VERSION = "1.0.0";

/** Per-extractor versions. Changing any of these changes the profile identity. */
export const EXTRACTOR_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  "package-manifest": "1.0.0",
  "service-spec": "1.0.0",
  "python-routes": "1.0.0",
});

/** Interpretation never reads a file larger than this; it records a diagnostic instead. */
const MAX_INTERPRETED_BYTES = 512 * 1024;

export type InterpretationFactKind =
  | "package_manager"
  | "package_identity"
  | "runtime_constraint"
  | "declared_dependency"
  | "service_identity"
  | "declared_action"
  | "declared_route"
  | "implementation_marker";

export type InterpretationEvidenceClass = "declared" | "observed";

export interface InterpretationSourceRef {
  sourcePath: string;
  lineNumber?: number;
  contentHash?: string;
}

export interface InterpretationFact {
  factId: string;
  kind: InterpretationFactKind;
  extractorId: string;
  extractorVersion: string;
  evidenceClass: InterpretationEvidenceClass;
  /** Stable, human-meaningful identity of the fact's value, e.g. `poetry`, `GET /health`. */
  value: string;
  /** Structured detail. Strings only, so canonical JSON stays integer- and float-free. */
  detail: Readonly<Record<string, string>>;
  sourceRef: InterpretationSourceRef;
}

export interface InterpretationDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  sourcePath?: string;
  extractorId?: string;
}

export interface InterpretationProfile {
  id: string;
  version: string;
  hash: string;
  extractorVersions: Readonly<Record<string, string>>;
}

export interface InterpretationResult {
  profile: InterpretationProfile;
  facts: InterpretationFact[];
  diagnostics: InterpretationDiagnostic[];
}

export interface InterpretRepositoryInput {
  root: string;
  records: readonly InventoryRecord[];
  sourceRevision: string;
}

// ───────────────────────────── deterministic helpers ─────────────────────────────

/** Code-point ordering. Never locale-aware: ordering must not vary by environment. */
function compareCodePoints(a: string, b: string): number {
  const left = [...a], right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    const l = left[i].codePointAt(0) ?? 0, r = right[i].codePointAt(0) ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}

function stableDigest(value: unknown): string {
  const render = (item: unknown): string => {
    if (item === null || item === undefined) return "null";
    if (Array.isArray(item)) return `[${item.map(render).join(",")}]`;
    if (typeof item === "object") {
      const source = item as Record<string, unknown>;
      const keys = Object.keys(source).sort(compareCodePoints);
      return `{${keys.map((key) => `${JSON.stringify(key)}:${render(source[key])}`).join(",")}}`;
    }
    return JSON.stringify(item);
  };
  return crypto.createHash("sha256").update(render(value), "utf8").digest("hex");
}

/** Identity of a fact: same source, same extractor, same value → same id, always. */
function factId(draft: Omit<InterpretationFact, "factId">): string {
  return `fact:${stableDigest({
    kind: draft.kind,
    extractor_id: draft.extractorId,
    extractor_version: draft.extractorVersion,
    evidence_class: draft.evidenceClass,
    value: draft.value,
    detail: draft.detail,
    source_ref: {
      source_path: draft.sourceRef.sourcePath,
      line_number: draft.sourceRef.lineNumber ?? null,
      content_hash: draft.sourceRef.contentHash ?? null,
    },
  }).slice(0, 32)}`;
}

/** Profile identity. Extraction policy participates in packet semantic identity. */
export const INTERPRETATION_PROFILE_HASH = `sha256:${stableDigest({
  id: INTERPRETATION_PROFILE_ID,
  version: INTERPRETATION_PROFILE_VERSION,
  extractor_versions: EXTRACTOR_VERSIONS,
  epistemics: "declared-or-observed-only",
  model_assisted: false,
  network: false,
  cross_repository_inference: false,
  max_interpreted_bytes: MAX_INTERPRETED_BYTES,
})}`;

export function interpretationProfile(): InterpretationProfile {
  return {
    id: INTERPRETATION_PROFILE_ID,
    version: INTERPRETATION_PROFILE_VERSION,
    hash: INTERPRETATION_PROFILE_HASH,
    extractorVersions: EXTRACTOR_VERSIONS,
  };
}

// ───────────────────────────── minimal TOML subset ─────────────────────────────
//
// Deliberately a subset, not a TOML implementation: table headers, `key = value` with
// single-line scalars, single- or multi-line arrays of scalars, and single-line inline
// tables. Anything else is left unread and reported, never approximated.

interface TomlDocument {
  /** `table.key` → scalar text or array of scalar texts. */
  values: Map<string, string | string[]>;
  /** Line number of each `table.key`. */
  lines: Map<string, number>;
  tables: Set<string>;
  unreadable: string[];
}

function tomlScalarText(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) return null;
    try { const parsed: unknown = JSON.parse(value); return typeof parsed === "string" ? parsed : null; }
    catch { return null; }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) return null;
    return value.slice(1, -1);
  }
  if (value.startsWith("{") || value.startsWith("[")) return null;
  return value;
}

function splitTopLevel(body: string): string[] {
  const items: string[] = [];
  let depth = 0, quote: string | null = null, current = "";
  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === "[" || char === "{") depth += 1;
    if (char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) { items.push(current); current = ""; continue; }
    current += char;
  }
  if (current.trim() !== "") items.push(current);
  return items;
}

function parseTomlSubset(text: string): TomlDocument {
  const doc: TomlDocument = { values: new Map(), lines: new Map(), tables: new Set(), unreadable: [] };
  const lines = text.split(/\r?\n/);
  let table = "";
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index].trim();
    if (line === "" || line.startsWith("#")) continue;

    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header) {
      table = header[1].trim().split(".").map((part) => tomlScalarText(part) ?? part).join(".");
      doc.tables.add(table);
      continue;
    }

    const assignment = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (!assignment) { doc.unreadable.push(`line ${index + 1}`); continue; }
    const key = tomlScalarText(assignment[1]) ?? assignment[1].trim();
    const qualified = table ? `${table}.${key}` : key;
    let rest = assignment[2].trim();

    // Multi-line arrays: accumulate until the brackets balance.
    if (rest.startsWith("[") && !rest.endsWith("]")) {
      let depth = 0, closed = false;
      const collected: string[] = [];
      for (let scan = index; scan < lines.length; scan++) {
        const chunk = scan === index ? rest : lines[scan].trim();
        collected.push(chunk.replace(/#.*$/, ""));
        for (const char of chunk) {
          if (char === "[") depth += 1;
          else if (char === "]") depth -= 1;
        }
        if (depth <= 0) { index = scan; closed = true; break; }
      }
      if (!closed) { doc.unreadable.push(`unterminated array at line ${index + 1}`); continue; }
      rest = collected.join(" ");
    }

    doc.lines.set(qualified, index + 1);
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const items = splitTopLevel(rest.slice(1, -1)).map(tomlScalarText);
      if (items.some((item) => item === null)) { doc.unreadable.push(qualified); continue; }
      doc.values.set(qualified, items as string[]);
      continue;
    }
    if (rest.startsWith("{") && rest.endsWith("}")) {
      // An inline table records the key's presence; its interior is not interpreted.
      doc.values.set(qualified, "");
      doc.tables.add(qualified);
      continue;
    }
    const scalar = tomlScalarText(rest.replace(/\s+#.*$/, ""));
    if (scalar === null) { doc.unreadable.push(qualified); continue; }
    doc.values.set(qualified, scalar);
  }
  return doc;
}

/** Keys directly under `table` in a parsed TOML subset, in code-point order. */
function tomlChildKeys(doc: TomlDocument, table: string): string[] {
  const prefix = `${table}.`;
  const keys = new Set<string>();
  for (const qualified of doc.values.keys()) {
    if (!qualified.startsWith(prefix)) continue;
    const remainder = qualified.slice(prefix.length);
    if (!remainder.includes(".")) keys.add(remainder);
  }
  return [...keys].sort(compareCodePoints);
}

/** `uvicorn[standard]>=0.32` → `uvicorn`. Null when no distribution name is present. */
function requirementName(requirement: string): string | null {
  const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(requirement);
  return match ? match[1] : null;
}

// ───────────────────────────── extractors ─────────────────────────────

interface ExtractorContext {
  relativePath: string;
  contentHash?: string;
  text: string;
  facts: InterpretationFact[];
  diagnostics: InterpretationDiagnostic[];
}

function emit(
  context: ExtractorContext,
  extractorId: string,
  kind: InterpretationFactKind,
  evidenceClass: InterpretationEvidenceClass,
  value: string,
  detail: Record<string, string>,
  lineNumber?: number,
): void {
  const draft: Omit<InterpretationFact, "factId"> = {
    kind,
    extractorId,
    extractorVersion: EXTRACTOR_VERSIONS[extractorId] ?? "0.0.0",
    evidenceClass,
    value,
    detail,
    sourceRef: {
      sourcePath: context.relativePath,
      ...(lineNumber !== undefined ? { lineNumber } : {}),
      ...(context.contentHash !== undefined ? { contentHash: context.contentHash } : {}),
    },
  };
  context.facts.push({ factId: factId(draft), ...draft });
}

function note(context: ExtractorContext, extractorId: string, code: string, message: string): void {
  context.diagnostics.push({ code, severity: "info", message, sourcePath: context.relativePath, extractorId });
}

const PACKAGE_MANIFEST = "package-manifest";

/** `pyproject.toml`: Poetry, PEP 621, and the packaging backend that actually built it. */
function extractPyProject(context: ExtractorContext): void {
  const doc = parseTomlSubset(context.text);
  const backend = typeof doc.values.get("build-system.build-backend") === "string"
    ? String(doc.values.get("build-system.build-backend"))
    : "";

  // Package manager: resolved from the file body, never from the filename. `pyproject.toml`
  // is shared by Poetry, uv, PDM, Hatch, and setuptools, so the discriminator must be the
  // declared tool table plus the declared build backend.
  const managers: Array<[string, boolean, string]> = [
    ["poetry", doc.tables.has("tool.poetry") && backend.includes("poetry"), "tool.poetry + build-system.build-backend"],
    ["uv", doc.tables.has("tool.uv"), "tool.uv"],
    ["pdm", doc.tables.has("tool.pdm"), "tool.pdm"],
    ["hatch", doc.tables.has("tool.hatch") || backend.includes("hatchling"), "tool.hatch"],
    ["setuptools", backend.includes("setuptools"), "build-system.build-backend"],
  ];
  const resolved = managers.filter(([, present]) => present);
  if (resolved.length === 0) {
    note(context, PACKAGE_MANIFEST, "package-manager-undetermined",
      "pyproject.toml declares no tool table or build backend this extractor recognizes; the package manager stays unknown");
  }
  for (const [manager, , rule] of resolved) {
    emit(context, PACKAGE_MANIFEST, "package_manager", "declared", manager, { rule },
      doc.lines.get("build-system.build-backend"));
  }

  const identities: Array<[string, string, string]> = [
    ["tool.poetry.name", "tool.poetry.version", "tool.poetry"],
    ["project.name", "project.version", "project"],
  ];
  for (const [nameKey, versionKey, table] of identities) {
    const name = doc.values.get(nameKey);
    if (typeof name !== "string" || name === "") continue;
    const version = doc.values.get(versionKey);
    emit(context, PACKAGE_MANIFEST, "package_identity", "declared", name, {
      table,
      ...(typeof version === "string" && version !== "" ? { version } : {}),
    }, doc.lines.get(nameKey));
  }

  const pythonConstraint = doc.values.get("tool.poetry.dependencies.python") ?? doc.values.get("project.requires-python");
  if (typeof pythonConstraint === "string" && pythonConstraint !== "") {
    emit(context, PACKAGE_MANIFEST, "runtime_constraint", "declared", `python ${pythonConstraint}`,
      { runtime: "python", constraint: pythonConstraint },
      doc.lines.get("tool.poetry.dependencies.python") ?? doc.lines.get("project.requires-python"));
  }

  const dependencies = new Map<string, { scope: string; line?: number }>();
  for (const key of tomlChildKeys(doc, "tool.poetry.dependencies")) {
    if (key === "python") continue; // the interpreter is a runtime constraint, not a dependency
    dependencies.set(key, { scope: "runtime", ...(doc.lines.has(`tool.poetry.dependencies.${key}`) ? { line: doc.lines.get(`tool.poetry.dependencies.${key}`) } : {}) });
  }
  const declared = doc.values.get("project.dependencies");
  if (Array.isArray(declared)) {
    for (const requirement of declared) {
      const name = requirementName(requirement);
      if (name === null) {
        note(context, PACKAGE_MANIFEST, "dependency-unparsed", `a project dependency entry has no readable distribution name: ${requirement}`);
        continue;
      }
      if (!dependencies.has(name)) dependencies.set(name, { scope: "runtime", ...(doc.lines.has("project.dependencies") ? { line: doc.lines.get("project.dependencies") } : {}) });
    }
  }
  for (const name of [...dependencies.keys()].sort(compareCodePoints)) {
    const entry = dependencies.get(name) as { scope: string; line?: number };
    emit(context, PACKAGE_MANIFEST, "declared_dependency", "declared", name, { ecosystem: "python", scope: entry.scope }, entry.line);
  }
  for (const item of doc.unreadable.slice(0, 5)) {
    note(context, PACKAGE_MANIFEST, "manifest-partially-unread", `pyproject.toml region not interpreted: ${item}`);
  }
}

function extractPackageJson(context: ExtractorContext): void {
  let parsed: unknown;
  try { parsed = JSON.parse(context.text); }
  catch (error) {
    context.diagnostics.push({
      code: "manifest-unparsable", severity: "warning", extractorId: PACKAGE_MANIFEST, sourcePath: context.relativePath,
      message: `package.json is not valid JSON, so nothing is claimed from it: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
  const manifest = parsed as Record<string, unknown>;

  const declaredManager = typeof manifest.packageManager === "string" ? manifest.packageManager.split("@")[0] : "";
  if (declaredManager !== "") {
    emit(context, PACKAGE_MANIFEST, "package_manager", "declared", declaredManager, { rule: "packageManager" });
  } else {
    // `package.json` alone identifies the npm ecosystem, not which client installs it;
    // a lockfile is what distinguishes npm from pnpm or yarn, and that is path evidence.
    note(context, PACKAGE_MANIFEST, "package-manager-undetermined",
      "package.json declares no packageManager field; the installing client is not determined by this file");
  }
  if (typeof manifest.name === "string" && manifest.name !== "") {
    emit(context, PACKAGE_MANIFEST, "package_identity", "declared", manifest.name, {
      table: "package.json",
      ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
    });
  }
  const engines = manifest.engines;
  if (typeof engines === "object" && engines !== null && !Array.isArray(engines)) {
    const node = (engines as Record<string, unknown>).node;
    if (typeof node === "string" && node !== "") {
      emit(context, PACKAGE_MANIFEST, "runtime_constraint", "declared", `node ${node}`, { runtime: "node", constraint: node });
    }
  }
  for (const [field, scope] of [["dependencies", "runtime"], ["devDependencies", "development"]] as const) {
    const block = manifest[field];
    if (typeof block !== "object" || block === null || Array.isArray(block)) continue;
    for (const name of Object.keys(block as Record<string, unknown>).sort(compareCodePoints)) {
      emit(context, PACKAGE_MANIFEST, "declared_dependency", "declared", name, { ecosystem: "npm", scope });
    }
  }
}

function extractCargoToml(context: ExtractorContext): void {
  const doc = parseTomlSubset(context.text);
  emit(context, PACKAGE_MANIFEST, "package_manager", "declared", "cargo", { rule: "Cargo.toml" });
  const name = doc.values.get("package.name");
  if (typeof name === "string" && name !== "") {
    const version = doc.values.get("package.version");
    emit(context, PACKAGE_MANIFEST, "package_identity", "declared", name, {
      table: "package",
      ...(typeof version === "string" && version !== "" ? { version } : {}),
    }, doc.lines.get("package.name"));
  }
  const rust = doc.values.get("package.rust-version");
  if (typeof rust === "string" && rust !== "") {
    emit(context, PACKAGE_MANIFEST, "runtime_constraint", "declared", `rust ${rust}`, { runtime: "rust", constraint: rust }, doc.lines.get("package.rust-version"));
  }
  for (const key of tomlChildKeys(doc, "dependencies")) {
    emit(context, PACKAGE_MANIFEST, "declared_dependency", "declared", key, { ecosystem: "cargo", scope: "runtime" }, doc.lines.get(`dependencies.${key}`));
  }
}

const SERVICE_SPEC = "service-spec";

function yamlScalarText(raw: string): string {
  const value = raw.trim().replace(/\s+#.*$/, "").trim();
  if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2)
    || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * `spec.yaml`: the declared service identity and its declared actions.
 *
 * Only the two shapes this extractor understands are read — a top-level `service:` map of
 * scalars, and a top-level `actions:` sequence of maps with `name`/`description`. Nested
 * input/output schemas are deliberately left unread: they are not the identity claim, and
 * half-reading them would produce facts nobody can trace.
 */
function extractServiceSpec(context: ExtractorContext): void {
  const lines = context.text.split(/\r?\n/);
  let section: "service" | "actions" | null = null;
  let pendingAction: { name?: string; description?: string; line: number } | null = null;
  const actions: Array<{ name: string; description?: string; line: number }> = [];

  const flush = (): void => {
    if (pendingAction?.name) {
      actions.push({
        name: pendingAction.name,
        ...(pendingAction.description !== undefined ? { description: pendingAction.description } : {}),
        line: pendingAction.line,
      });
    }
    pendingAction = null;
  };

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      flush();
      const top = /^([A-Za-z_][\w-]*):/.exec(raw);
      section = top && (top[1] === "service" || top[1] === "actions") ? (top[1] as "service" | "actions") : null;
      continue;
    }
    if (section === null) continue;

    if (section === "service") {
      const entry = /^\s{2}([A-Za-z_][\w-]*):\s*(.+)$/.exec(raw);
      if (!entry) continue;
      if (entry[1] === "name") {
        const value = yamlScalarText(entry[2]);
        if (value !== "") {
          emit(context, SERVICE_SPEC, "service_identity", "declared", value, { field: "service.name" }, index + 1);
        }
      }
      continue;
    }

    // actions: a `- name: x` item opens an entry; its two-space-deeper siblings extend it.
    const item = /^\s{2}-\s+([A-Za-z_][\w-]*):\s*(.+)$/.exec(raw);
    if (item) {
      flush();
      pendingAction = { line: index + 1 };
      if (item[1] === "name") pendingAction.name = yamlScalarText(item[2]);
      else if (item[1] === "description") pendingAction.description = yamlScalarText(item[2]);
      continue;
    }
    const child = /^\s{4}([A-Za-z_][\w-]*):\s*(.*)$/.exec(raw);
    if (child && pendingAction) {
      if (child[1] === "name") pendingAction.name = yamlScalarText(child[2]);
      else if (child[1] === "description") pendingAction.description = yamlScalarText(child[2]);
    }
  }
  flush();

  for (const action of actions) {
    if (action.name === "") continue;
    emit(context, SERVICE_SPEC, "declared_action", "declared", action.name, {
      field: "actions[].name",
      ...(action.description !== undefined && action.description !== "" ? { description: action.description } : {}),
    }, action.line);
  }
  if (actions.length === 0) {
    note(context, SERVICE_SPEC, "service-spec-no-actions",
      "no top-level `actions:` sequence of `- name:` entries was read from this spec");
  }
}

const PYTHON_ROUTES = "python-routes";

const ROUTE_DECORATOR = /^\s*@([A-Za-z_][\w.]*)\.(get|post|put|patch|delete|head|options)\(\s*(?:"([^"]*)"|'([^']*)')/;
const HANDLER_DEFINITION = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;

/**
 * FastAPI-style route decorators and the implementation markers inside their handlers.
 *
 * What this establishes: a decorator with this HTTP method and path literal exists at this
 * file and line, and the handler symbol immediately below it is named this. What it does
 * not establish — and must never be reported as — is that the route is implemented,
 * mounted, reachable, or correct.
 */
function extractPythonRoutes(context: ExtractorContext): void {
  const lines = context.text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const decorator = ROUTE_DECORATOR.exec(lines[index]);
    if (!decorator) continue;
    const method = decorator[2].toUpperCase();
    const routePath = decorator[3] ?? decorator[4] ?? "";
    if (routePath === "") continue;

    // Walk past any further decorators to the handler definition.
    let cursor = index + 1;
    while (cursor < lines.length && /^\s*@/.test(lines[cursor])) cursor += 1;
    const definition = cursor < lines.length ? HANDLER_DEFINITION.exec(lines[cursor]) : null;
    if (!definition) {
      note(context, PYTHON_ROUTES, "route-handler-unresolved",
        `a ${method} ${routePath} decorator has no handler definition directly beneath it; the handler symbol stays unknown`);
      continue;
    }

    emit(context, PYTHON_ROUTES, "declared_route", "observed", `${method} ${routePath}`, {
      method,
      route_path: routePath,
      handler: definition[1],
      decorator_target: decorator[1],
    }, index + 1);

    // The handler body is everything indented deeper than its `def` line.
    const defIndent = lines[cursor].length - lines[cursor].trimStart().length;
    for (let body = cursor + 1; body < lines.length; body++) {
      const line = lines[body];
      if (line.trim() === "") continue;
      const indent = line.length - line.trimStart().length;
      if (indent <= defIndent) break;
      const markers: Array<[string, boolean]> = [
        ["TODO", /(?:^|[^A-Za-z])TODO(?![A-Za-z])/.test(line)],
        ["NotImplementedError", line.includes("NotImplementedError")],
        ["pass", /^\s*pass\s*$/.test(line)],
      ];
      for (const [marker, present] of markers) {
        if (!present) continue;
        emit(context, PYTHON_ROUTES, "implementation_marker", "observed", marker, {
          marker,
          handler: definition[1],
          route: `${method} ${routePath}`,
        }, body + 1);
      }
    }
  }
}

// ───────────────────────────── driver ─────────────────────────────

type Extractor = (context: ExtractorContext) => void;

const BY_FILE_NAME: Readonly<Record<string, Extractor>> = Object.freeze({
  "pyproject.toml": extractPyProject,
  "package.json": extractPackageJson,
  "Cargo.toml": extractCargoToml,
  "spec.yaml": extractServiceSpec,
  "spec.yml": extractServiceSpec,
});

function extractorFor(record: InventoryRecord): Extractor | null {
  const byName = BY_FILE_NAME[record.file_name];
  if (byName) return byName;
  if ((record.extension ?? "").toLowerCase() === ".py") return extractPythonRoutes;
  return null;
}

/**
 * Interpret the supported structured surfaces of an already-observed repository.
 *
 * The observation is read-only: files are read, never written. Every returned fact traces
 * back to a repository-relative path and, where the reader can establish it, a line.
 */
export function interpretRepository(input: InterpretRepositoryInput): InterpretationResult {
  const root = path.resolve(input.root);
  const facts: InterpretationFact[] = [];
  const diagnostics: InterpretationDiagnostic[] = [];

  const ordered = [...input.records]
    .filter((record) => record.artifact_type !== "folder")
    .sort((a, b) => compareCodePoints(a.relative_path, b.relative_path));

  for (const record of ordered) {
    const extractor = extractorFor(record);
    if (!extractor) continue;
    const absolute = path.join(root, ...record.relative_path.split("/"));
    if ((record.size_bytes ?? 0) > MAX_INTERPRETED_BYTES) {
      diagnostics.push({
        code: "interpretation-skipped-oversize", severity: "info", sourcePath: record.relative_path,
        message: `file exceeds the ${MAX_INTERPRETED_BYTES}-byte interpretation limit and was not read`,
      });
      continue;
    }
    let text: string;
    try { text = fs.readFileSync(absolute, "utf8"); }
    catch (error) {
      diagnostics.push({
        code: "interpretation-unreadable", severity: "warning", sourcePath: record.relative_path,
        message: `file could not be read for interpretation: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    const context: ExtractorContext = {
      relativePath: record.relative_path,
      ...(record.content_hash !== null ? { contentHash: `sha256:${record.content_hash}` } : {}),
      text,
      facts,
      diagnostics,
    };
    extractor(context);
  }

  facts.sort((a, b) =>
    compareCodePoints(a.kind, b.kind)
    || compareCodePoints(a.sourceRef.sourcePath, b.sourceRef.sourcePath)
    || compareCodePoints(a.value, b.value)
    || compareCodePoints(a.factId, b.factId));
  diagnostics.sort((a, b) =>
    compareCodePoints(a.code, b.code)
    || compareCodePoints(a.sourcePath ?? "", b.sourcePath ?? "")
    || compareCodePoints(a.message, b.message));

  return { profile: interpretationProfile(), facts, diagnostics };
}
