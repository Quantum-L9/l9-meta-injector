/**
 * Deterministic central metadata index.
 *
 * The index is newline-delimited canonical JSON at `.l9/metadata-index.jsonl`.
 * It is the sole default metadata carrier for source, configuration, test,
 * automation, infrastructure, structured data, and inventory-only artifacts.
 * This module never creates adjacent sidecars or inject logs.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { ArtifactType } from "./schema";
import type { AuthorityConfig, CarrierDecision, MetadataCarrier, OperationMode } from "./operation_contracts";
import { compareCodePoints } from "./ordering";
import {
  assertCarrierDecisionCoverage,
  resolveCarrierDecisions,
  type CarrierSubject,
} from "./mutation_policy";

export const METADATA_INDEX_SCHEMA = "l9.metadata-index/v1" as const;
export const METADATA_INDEX_RELATIVE_PATH = ".l9/metadata-index.jsonl" as const;

export type MaterializedMetadataCarrier = Exclude<MetadataCarrier, "hard_skip">;

const MATERIALIZED_CARRIERS = new Set<MetadataCarrier>([
  "inventory_only", "central_manifest", "inline_managed",
]);
const ARTIFACT_TYPES = new Set<ArtifactType>([
  "skill", "playbook", "kernel", "context", "prompt", "doctrine",
  "test", "script", "source", "unknown",
]);

export interface ManagedMetadataSubject extends CarrierSubject {
  contentHash: string;
  metadata: Readonly<Record<string, unknown>>;
}

export interface MetadataIndexRecord {
  schema: typeof METADATA_INDEX_SCHEMA;
  path: string;
  carrier: MaterializedMetadataCarrier;
  artifact_type: ArtifactType;
  content_hash: string;
  metadata: Record<string, unknown>;
}

export interface MetadataIndexCompilation {
  records: MetadataIndexRecord[];
  bytes: string;
  sha256: string;
  carrierDecisions: CarrierDecision[];
}

export interface CompileMetadataIndexInput {
  authority: AuthorityConfig;
  mode: OperationMode;
  subjects: readonly ManagedMetadataSubject[];
  /**
   * Existing index records carried forward verbatim (ADR-058). A scoped governed run
   * passes the records of paths its discovery ledger marked scope-filtered; they are
   * merged with the records compiled from `subjects` and validated as one index.
   * Carrier decisions still cover `subjects` only.
   */
  preservedRecords?: readonly MetadataIndexRecord[];
}

export interface WriteMetadataIndexOptions {
  dryRun?: boolean;
}

export interface WriteMetadataIndexResult extends MetadataIndexCompilation {
  absolutePath: string;
  relativePath: typeof METADATA_INDEX_RELATIVE_PATH;
  changed: boolean;
  written: boolean;
}

const FORBIDDEN_VOLATILE_KEYS = new Set([
  "absolute_path",
  "generated_at",
  "report_path",
  "run_started_at",
  "runtime_timestamp",
]);

/** The record keys `schemas/metadata-index-record.schema.json` allows (additionalProperties: false). */
const RECORD_KEYS = ["artifact_type", "carrier", "content_hash", "metadata", "path", "schema"] as const;
const MAX_PATH_CODE_POINTS = 4096;
// The schema's path pattern forbids exactly these characters.
const CONTROL_CHARACTER = /[\u0001-\u001F\u007F]/u;

/** Canonical repository-relative POSIX structure, required of every subject path. */
function normalizeRelativePath(value: string): string {
  if (value.includes("\u0000")) throw new Error("metadata index path contains NUL");
  if (value.includes("\\")) throw new Error(`metadata index path must use POSIX separators: ${value}`);
  if (value.startsWith("/") || value.startsWith("./")) {
    throw new Error(`metadata index path must be canonical repository-relative POSIX: ${value}`);
  }
  if (value.includes("//")) throw new Error(`metadata index path contains an empty segment: ${value}`);
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`metadata index path contains a non-canonical segment: ${value}`);
  }
  return segments.join("/");
}

/**
 * The record schema's remaining `path` rules (pattern and maxLength), required of every
 * materialized record: no control character, no leading '.', at most 4096 code points.
 */
function assertRecordPath(pathName: string): void {
  const problem = metadataIndexPathProblem(pathName);
  if (problem !== null) throw new Error(problem);
}

/**
 * Why the index schema cannot represent `pathName`, or null when it can.
 *
 * Shared with discovery (DEC-RC-013 option B), which holds such a file with a
 * blocking disposition so `check` reports it instead of the producer throwing.
 */
export function metadataIndexPathProblem(pathName: string): string | null {
  if (CONTROL_CHARACTER.test(pathName)) {
    return `metadata index path contains a control character (U+0001-U+001F, U+007F): ${JSON.stringify(pathName)}`;
  }
  if (pathName.startsWith(".")) return `metadata index path must not start with '.': ${pathName}`;
  if ([...pathName].length > MAX_PATH_CODE_POINTS) {
    return `metadata index path exceeds ${MAX_PATH_CODE_POINTS} characters: ${pathName.slice(0, 64)}...`;
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalize(value: unknown, location: string, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${location} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return canonicalizeArray(value, location, seen);
  if (!isPlainObject(value)) {
    throw new Error(`${location} contains an unsupported value of type ${typeof value}`);
  }
  return canonicalizeObject(value, location, seen);
}

function canonicalizeArray(value: unknown[], location: string, seen: Set<object>): unknown[] {
  if (seen.has(value)) throw new Error(`${location} contains a cycle`);
  seen.add(value);
  const output = value.map((item, index) => canonicalize(item, `${location}[${index}]`, seen));
  seen.delete(value);
  return output;
}

function canonicalizeObject(
  value: Record<string, unknown>,
  location: string,
  seen: Set<object>,
): Record<string, unknown> {
  if (seen.has(value)) throw new Error(`${location} contains a cycle`);
  seen.add(value);
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  // Explicit code-unit ordering: keeps the canonical JSON bytes identical to the
  // prior default sort while satisfying the "sort needs a comparator" rule.
  for (const key of Object.keys(value).sort(byCodeUnit)) {
    if (FORBIDDEN_VOLATILE_KEYS.has(key)) {
      throw new Error(`${location}.${key} is runtime- or machine-specific and cannot be persisted`);
    }
    const item = value[key];
    if (item === undefined || typeof item === "bigint" || typeof item === "function" || typeof item === "symbol") {
      throw new Error(`${location}.${key} contains a non-JSON value`);
    }
    output[key] = canonicalize(item, `${location}.${key}`, seen);
  }
  seen.delete(value);
  return output;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, "$", new Set<object>()));
}

function assertContentHash(value: string, pathName: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`metadata index content hash for ${pathName} must be lowercase SHA-256`);
  }
}

function toRecord(
  subject: ManagedMetadataSubject,
  decision: CarrierDecision,
): MetadataIndexRecord | undefined {
  const pathName = normalizeRelativePath(subject.path);
  if (decision.path !== pathName) {
    throw new Error(`carrier decision path mismatch for ${pathName}: ${decision.path}`);
  }
  if (decision.carrier === "hard_skip") return undefined;
  assertRecordPath(pathName);
  assertContentHash(subject.contentHash, pathName);

  const metadata = canonicalize(subject.metadata, `metadata:${pathName}`, new Set<object>());
  if (!isPlainObject(metadata)) throw new Error(`metadata for ${pathName} must be a plain object`);
  if (metadata.source_path !== undefined && metadata.source_path !== pathName) {
    throw new Error(`metadata source_path mismatch for ${pathName}`);
  }
  if (metadata.content_hash !== undefined && metadata.content_hash !== subject.contentHash) {
    throw new Error(`metadata content_hash mismatch for ${pathName}`);
  }

  return {
    schema: METADATA_INDEX_SCHEMA,
    path: pathName,
    carrier: decision.carrier,
    artifact_type: subject.artifactType,
    content_hash: subject.contentHash,
    metadata,
  };
}

/** Deterministic code-unit string comparison (stable canonical ordering). */
function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Records are in code-point path order, like every other identity-bearing order (ADR-058). */
function comparePath(left: { path: string }, right: { path: string }): number {
  return compareCodePoints(left.path, right.path);
}

function assertRecordKeys(record: MetadataIndexRecord): void {
  const keys = Object.keys(record).sort(byCodeUnit);
  if (keys.length !== RECORD_KEYS.length || keys.some((key, index) => key !== RECORD_KEYS[index])) {
    const pathName = typeof record.path === "string" ? record.path : "<unknown>";
    throw new Error(`metadata index record for ${pathName} must have exactly the keys ${RECORD_KEYS.join(", ")}; got ${keys.join(", ")}`);
  }
}

export function serializeMetadataIndex(records: readonly MetadataIndexRecord[]): string {
  const seen = new Set<string>();
  const sorted = [...records].sort(comparePath);
  for (const record of sorted) {
    assertRecordKeys(record);
    const pathName = normalizeRelativePath(record.path);
    assertRecordPath(pathName);
    if (seen.has(pathName)) throw new Error(`duplicate metadata index path: ${pathName}`);
    seen.add(pathName);
    if (record.schema !== METADATA_INDEX_SCHEMA) throw new Error(`unsupported metadata index schema for ${pathName}`);
    if (!MATERIALIZED_CARRIERS.has(record.carrier)) {
      throw new Error(`unsupported materialized carrier '${String(record.carrier)}' for ${pathName}`);
    }
    if (!ARTIFACT_TYPES.has(record.artifact_type)) {
      throw new Error(`unsupported artifact type '${String(record.artifact_type)}' for ${pathName}`);
    }
    assertContentHash(record.content_hash, pathName);
    if (!isPlainObject(record.metadata)) throw new Error(`metadata for ${pathName} must be a plain object`);
    if (record.metadata.source_path !== undefined && record.metadata.source_path !== pathName) {
      throw new Error(`metadata source_path mismatch for ${pathName}`);
    }
    if (record.metadata.content_hash !== undefined && record.metadata.content_hash !== record.content_hash) {
      throw new Error(`metadata content_hash mismatch for ${pathName}`);
    }
  }
  return sorted.length === 0 ? "" : `${sorted.map((record) => canonicalJson(record)).join("\n")}\n`;
}

/** Metadata ids must stay unique across compiled and preserved records (the pipeline only saw the compiled ones). */
function assertUniqueMergedMetadataIds(
  subjects: readonly ManagedMetadataSubject[],
  preserved: readonly MetadataIndexRecord[],
): void {
  const byId = new Map<string, string[]>();
  const add = (id: unknown, pathName: string): void => {
    if (id === undefined) return;
    const key = String(id);
    byId.set(key, [...(byId.get(key) ?? []), pathName]);
  };
  for (const subject of subjects) add(subject.metadata["id"], subject.path);
  for (const record of preserved) add(record.metadata["id"], record.path);
  const duplicates = [...byId.entries()].filter(([, paths]) => paths.length > 1);
  if (duplicates.length === 0) return;
  const detail = duplicates.map(([id, paths]) => `${id}: ${paths.join(", ")}`).join("; ");
  throw new Error(`DUPLICATE_METADATA_ID: ${duplicates.length} id(s) map to more than one path across the merged metadata index: ${detail}`);
}

export function compileMetadataIndex(input: CompileMetadataIndexInput): MetadataIndexCompilation {
  const carrierDecisions = resolveCarrierDecisions({
    authority: input.authority,
    mode: input.mode,
    subjects: input.subjects,
  });
  assertCarrierDecisionCoverage(input.subjects, carrierDecisions);
  const subjectByPath = new Map(input.subjects.map((subject) => [normalizeRelativePath(subject.path), subject]));
  const records: MetadataIndexRecord[] = [];
  for (const decision of carrierDecisions) {
    const subject = subjectByPath.get(decision.path);
    if (!subject) throw new Error(`carrier decision has no metadata subject: ${decision.path}`);
    const record = toRecord(subject, decision);
    if (record) records.push(record);
  }
  const preserved = input.preservedRecords ?? [];
  if (preserved.length > 0) {
    assertUniqueMergedMetadataIds(input.subjects, preserved);
    for (const record of preserved) {
      if (subjectByPath.has(record.path)) throw new Error(`preserved metadata index record overlaps a compiled subject: ${record.path}`);
      records.push(record);
    }
  }
  const bytes = serializeMetadataIndex(records);
  return {
    records: [...records].sort(comparePath),
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    carrierDecisions,
  };
}

function assertSafeOutput(root: string): { root: string; directory: string; target: string } {
  const absoluteRoot = path.resolve(root);
  const rootStat = fs.lstatSync(absoluteRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`metadata index root must be a real directory: ${absoluteRoot}`);
  }
  const directory = path.join(absoluteRoot, ".l9");
  const target = path.join(absoluteRoot, METADATA_INDEX_RELATIVE_PATH);
  const relative = path.relative(absoluteRoot, target);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`metadata index target escapes repository root: ${target}`);
  }
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`.l9 must be a real directory: ${directory}`);
  }
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`metadata index target must be a regular file: ${target}`);
  }
  return { root: absoluteRoot, directory, target };
}

export function writeMetadataIndex(
  root: string,
  input: CompileMetadataIndexInput,
  options: WriteMetadataIndexOptions = {},
): WriteMetadataIndexResult {
  const output = assertSafeOutput(root);
  const compiled = compileMetadataIndex(input);
  const current = fs.existsSync(output.target) ? fs.readFileSync(output.target, "utf8") : undefined;
  const changed = current !== compiled.bytes;
  if (!options.dryRun && changed) {
    fs.mkdirSync(output.directory, { recursive: true });
    const temp = path.join(output.directory, `.metadata-index.jsonl.tmp-${process.pid}`);
    if (fs.existsSync(temp)) throw new Error(`metadata index temporary path already exists: ${temp}`);
    try {
      fs.writeFileSync(temp, compiled.bytes, { encoding: "utf8", flag: "wx", mode: 0o644 });
      fs.renameSync(temp, output.target);
    } finally {
      if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
    }
  }
  return {
    ...compiled,
    absolutePath: output.target,
    relativePath: METADATA_INDEX_RELATIVE_PATH,
    changed,
    written: !options.dryRun && changed,
  };
}

export function parseMetadataIndex(bytes: string): MetadataIndexRecord[] {
  if (bytes === "") return [];
  if (!bytes.endsWith("\n")) throw new Error("metadata index must end with a newline");
  const records = bytes.slice(0, -1).split("\n").map((line, index) => {
    let value: unknown;
    try { value = JSON.parse(line); }
    catch (error) { throw new Error(`metadata index line ${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
    if (!isPlainObject(value)) throw new Error(`metadata index line ${index + 1} must be an object`);
    const record = value as unknown as MetadataIndexRecord;
    if (canonicalJson(record) !== line) throw new Error(`metadata index line ${index + 1} is not canonical JSON`);
    return record;
  });
  const canonical = serializeMetadataIndex(records);
  if (canonical !== bytes) throw new Error("metadata index records are not in canonical path order");
  return records;
}
