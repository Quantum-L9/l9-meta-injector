/**
 * Deterministic central metadata index.
 *
 * The index is newline-delimited canonical JSON at `.l9/metadata-index.jsonl`.
 * It is the sole default metadata carrier for source, configuration, test,
 * automation, infrastructure, structured data, and inventory-only artifacts.
 * This module never creates adjacent sidecars or inject logs.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type LegacyTrackedAliasGroup,
  TRACKED_COVERAGE_SCHEMA,
  TRACKED_POLICY_SCHEMA,
  type TrackedCarrierDecision,
  type TrackedGitEntry,
  type TrackedGitSnapshot,
} from "./discovery_contracts";
import { explicitHiddenControlPattern } from "./hidden_control";
import {
  assertCarrierDecisionCoverage,
  assertTrackedPathSpelling,
  type CarrierSubject,
  resolveCarrierDecisions,
  resolveTrackedCarrierDecision,
  resolveTrackedCarrierDecisions,
} from "./mutation_policy";
import {
  assertPortableRepositoryIdentity,
  compareTrackedPaths,
  resolveNamespace,
  trackedPathIdentity,
} from "./namespace";
import type {
  AuthorityConfig,
  CarrierDecision,
  MetadataCarrier,
  OperationMode,
} from "./operation_contracts";
import { compareCodePoints } from "./ordering";
import type { ArtifactType } from "./schema";

export const METADATA_INDEX_SCHEMA = "l9.metadata-index/v1" as const;
export const METADATA_INDEX_RELATIVE_PATH = ".l9/metadata-index.jsonl" as const;

export type MaterializedMetadataCarrier = Exclude<MetadataCarrier, "hard_skip">;

const MATERIALIZED_CARRIERS = new Set<MetadataCarrier>([
  "inventory_only",
  "central_manifest",
  "inline_managed",
]);
const ARTIFACT_TYPES = new Set<ArtifactType>([
  "skill",
  "playbook",
  "kernel",
  "context",
  "prompt",
  "doctrine",
  "test",
  "script",
  "source",
  "unknown",
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
const RECORD_KEYS = [
  "artifact_type",
  "carrier",
  "content_hash",
  "metadata",
  "path",
  "schema",
] as const;
const MAX_PATH_CODE_POINTS = 4096;
// The schema's path pattern forbids exactly these characters.
const CONTROL_CHARACTER = /[\u0001-\u001F\u007F]/u;

/** Canonical repository-relative POSIX structure, required of every subject path. */
function normalizeRelativePath(value: string): string {
  if (value.includes("\u0000")) throw new Error("metadata index path contains NUL");
  if (value.includes("\\"))
    throw new Error(`metadata index path must use POSIX separators: ${value}`);
  if (value.startsWith("/") || value.startsWith("./")) {
    throw new Error(`metadata index path must be canonical repository-relative POSIX: ${value}`);
  }
  if (value.includes("//"))
    throw new Error(`metadata index path contains an empty segment: ${value}`);
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`metadata index path contains a non-canonical segment: ${value}`);
  }
  return segments.join("/");
}

/**
 * The record schema's remaining `path` rules (pattern and maxLength), required of every
 * materialized record: no control character, only known leading-dot controls, at most
 * 4096 code points. Record representability does not itself grant inline authorization.
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
  if (pathName.startsWith(".") && !explicitHiddenControlPattern(pathName, [pathName])) {
    return `metadata index path must not start with '.' unless it names a supported hidden control: ${pathName}`;
  }
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
    if (
      item === undefined ||
      typeof item === "bigint" ||
      typeof item === "function" ||
      typeof item === "symbol"
    ) {
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
    throw new Error(
      `metadata index record for ${pathName} must have exactly the keys ${RECORD_KEYS.join(", ")}; got ${keys.join(", ")}`,
    );
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
    if (record.schema !== METADATA_INDEX_SCHEMA)
      throw new Error(`unsupported metadata index schema for ${pathName}`);
    if (!MATERIALIZED_CARRIERS.has(record.carrier)) {
      throw new Error(
        `unsupported materialized carrier '${String(record.carrier)}' for ${pathName}`,
      );
    }
    if (!ARTIFACT_TYPES.has(record.artifact_type)) {
      throw new Error(
        `unsupported artifact type '${String(record.artifact_type)}' for ${pathName}`,
      );
    }
    assertContentHash(record.content_hash, pathName);
    if (!isPlainObject(record.metadata))
      throw new Error(`metadata for ${pathName} must be a plain object`);
    if (record.metadata.source_path !== undefined && record.metadata.source_path !== pathName) {
      throw new Error(`metadata source_path mismatch for ${pathName}`);
    }
    if (
      record.metadata.content_hash !== undefined &&
      record.metadata.content_hash !== record.content_hash
    ) {
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
  throw new Error(
    `DUPLICATE_METADATA_ID: ${duplicates.length} id(s) map to more than one path across the merged metadata index: ${detail}`,
  );
}

export function compileMetadataIndex(input: CompileMetadataIndexInput): MetadataIndexCompilation {
  const carrierDecisions = resolveCarrierDecisions({
    authority: input.authority,
    mode: input.mode,
    subjects: input.subjects,
  });
  assertCarrierDecisionCoverage(input.subjects, carrierDecisions);
  const subjectByPath = new Map(
    input.subjects.map((subject) => [normalizeRelativePath(subject.path), subject]),
  );
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
      if (subjectByPath.has(record.path))
        throw new Error(
          `preserved metadata index record overlaps a compiled subject: ${record.path}`,
        );
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
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error(`.l9 must be a real directory: ${directory}`);
  }
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error(`metadata index target must be a regular file: ${target}`);
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
  const base = readMetadataIndexBaseBytes(root);
  const current = base.exists ? base.raw.toString("utf8") : undefined;
  if (current !== undefined) assertLegacyMetadataIndexWrite(current);
  const changed = current !== compiled.bytes;
  if (!options.dryRun && changed) {
    fs.mkdirSync(output.directory, { recursive: true });
    const temp = path.join(output.directory, `.metadata-index.jsonl.tmp-${process.pid}`);
    if (fs.existsSync(temp))
      throw new Error(`metadata index temporary path already exists: ${temp}`);
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
  const records = bytes
    .slice(0, -1)
    .split("\n")
    .map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `metadata index line ${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!isPlainObject(value))
        throw new Error(`metadata index line ${index + 1} must be an object`);
      const record = value as unknown as MetadataIndexRecord;
      if (canonicalJson(record) !== line)
        throw new Error(`metadata index line ${index + 1} is not canonical JSON`);
      return record;
    });
  const canonical = serializeMetadataIndex(records);
  if (canonical !== bytes)
    throw new Error("metadata index records are not in canonical path order");
  return records;
}

/** Separate opt-in wire contract. The v1 constant, parser and bytes remain unchanged. */
export const METADATA_INDEX_SCHEMA_V2 = "l9.metadata-index/v2" as const;
export const LEGACY_ALIAS_SCHEMA = "l9.namespace-alias/v1" as const;

export interface MetadataIndexHeaderV2 {
  schema: typeof METADATA_INDEX_SCHEMA_V2;
  kind: "header";
  repository_id: string;
  producer_version: string;
  policy_contract: typeof TRACKED_POLICY_SCHEMA;
  /** Frozen v1 claims only; never current records, aliases, or current-content proof. */
  legacy_identity_claims?: MetadataIndexLegacyIdentityClaimsV2;
}

export interface MetadataIndexRecordV2 {
  schema: typeof METADATA_INDEX_SCHEMA_V2;
  path: string;
  path_bytes_base64: string;
  carrier: "central_manifest" | "inventory_only";
  artifact_type: "unknown";
  content_kind: "Unknown";
  content_hash: null;
  content_hash_scope: "not_inspected";
  git: {
    mode: TrackedGitEntry["mode"];
    object_type: TrackedGitEntry["object_type"];
    object_oid: string;
    object_format: TrackedGitSnapshot["object_format"];
  };
  metadata: {
    id: string;
    repository_id: string;
    legacy_alias: { schema: typeof LEGACY_ALIAS_SCHEMA; id: string };
  };
}

export interface TrackedCoverageReceipt {
  schema: typeof TRACKED_COVERAGE_SCHEMA;
  policy_contract: typeof TRACKED_POLICY_SCHEMA;
  producer_version: string;
  repository_id: string;
  snapshot: {
    revision: string;
    tree_oid: string;
    object_format: TrackedGitSnapshot["object_format"];
  };
  population: "tracked_tree_leaves";
  subject_content_reads: false;
  source_mutation: "never";
  host_materializability: "not_assessed";
  authority_inspection: "not_performed";
  index: { schema: typeof METADATA_INDEX_SCHEMA_V2; sha256: string };
  entries: Array<
    TrackedCarrierDecision & { id: string; content_hash: null; content_hash_scope: "not_inspected" }
  >;
  alias_ambiguities: LegacyTrackedAliasGroup[];
  totals: { tree_leaves: number; indexed: number; protected: number; unsupported: number };
  closure: "exact_set_verified";
}

export interface TrackedMetadataCompilation {
  header: MetadataIndexHeaderV2;
  records: MetadataIndexRecordV2[];
  bytes: string;
  sha256: string;
  carrierDecisions: TrackedCarrierDecision[];
  coverage: TrackedCoverageReceipt;
  coverageBytes: string;
}

export interface CompileTrackedMetadataInput {
  snapshot: TrackedGitSnapshot;
  producerVersion: string;
  /** Optional pre-resolved decisions must prove exact evidence and policy equality. */
  decisions?: readonly TrackedCarrierDecision[];
  /** Supplied only by the shared migration/replay plan, not a workflow override. */
  legacyIdentityClaims?: MetadataIndexLegacyIdentityClaimsV2;
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  location: string,
): asserts value is Record<string, unknown> {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new Error(`${location} must have exactly the keys ${keys.join(", ")}`);
  }
}

function assertGitOid(oid: string, format: TrackedGitSnapshot["object_format"]): void {
  if (format !== "sha1" && format !== "sha256")
    throw new Error("unsupported tracked object format");
  if (
    typeof oid !== "string" ||
    !(format === "sha1" ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/).test(oid)
  ) {
    throw new Error("tracked object identity does not match object format");
  }
}

function assertTrackedSnapshot(snapshot: TrackedGitSnapshot): void {
  assertPortableRepositoryIdentity(snapshot.repository_id);
  assertGitOid(snapshot.revision, snapshot.object_format);
  assertGitOid(snapshot.tree_oid, snapshot.object_format);
  const seen = new Set<string>();
  for (const entry of snapshot.entries) {
    exactKeys(
      entry,
      ["path", "path_bytes_base64", "mode", "object_type", "object_oid"],
      "tracked census entry",
    );
    assertTrackedPathSpelling(entry);
    assertGitOid(entry.object_oid, snapshot.object_format);
    if (seen.has(entry.path_bytes_base64)) throw new Error("duplicate tracked census path");
    seen.add(entry.path_bytes_base64);
  }
}

/** Counts are informational. Equality is established on raw paths and all Git evidence. */
export function assertTrackedDecisionCoverage(
  snapshot: TrackedGitSnapshot,
  decisions: readonly TrackedCarrierDecision[],
): void {
  assertTrackedSnapshot(snapshot);
  const expected = new Map(snapshot.entries.map((entry) => [entry.path_bytes_base64, entry]));
  const seen = new Set<string>();
  for (const item of decisions) {
    exactKeys(
      item,
      [
        "path",
        "path_bytes_base64",
        "mode",
        "object_type",
        "object_oid",
        "carrier",
        "disposition",
        "reason",
      ],
      "tracked decision",
    );
    if (seen.has(item.path_bytes_base64)) throw new Error("duplicate tracked decision path");
    seen.add(item.path_bytes_base64);
    const entry = expected.get(item.path_bytes_base64);
    if (!entry) throw new Error("extra tracked decision path");
    if (
      item.path !== entry.path ||
      item.mode !== entry.mode ||
      item.object_type !== entry.object_type ||
      item.object_oid !== entry.object_oid
    ) {
      throw new Error("tracked decision evidence mismatch");
    }
    const policy = resolveTrackedCarrierDecision(entry);
    if (
      item.carrier !== policy.carrier ||
      item.disposition !== policy.disposition ||
      item.reason !== policy.reason
    ) {
      throw new Error("unjustified tracked decision exception or carrier");
    }
  }
  if (seen.size !== expected.size) throw new Error("missing tracked decision path");
}

function legacyAlias(
  repositoryId: string,
  sourcePath: string,
): MetadataIndexRecordV2["metadata"]["legacy_alias"] {
  return {
    schema: LEGACY_ALIAS_SCHEMA,
    id: resolveNamespace(sourcePath, { namespace: repositoryId }, "unknown").idStem,
  };
}

function validateV2Record(value: MetadataIndexRecordV2): void {
  exactKeys(
    value,
    [
      "schema",
      "path",
      "path_bytes_base64",
      "carrier",
      "artifact_type",
      "content_kind",
      "content_hash",
      "content_hash_scope",
      "git",
      "metadata",
    ],
    "v2 metadata record",
  );
  if (
    value.schema !== METADATA_INDEX_SCHEMA_V2 ||
    value.artifact_type !== "unknown" ||
    value.content_kind !== "Unknown" ||
    value.content_hash !== null ||
    value.content_hash_scope !== "not_inspected"
  )
    throw new Error("unsupported v2 metadata evidence contract");
  exactKeys(value.git, ["mode", "object_type", "object_oid", "object_format"], "v2 Git provenance");
  exactKeys(value.metadata, ["id", "repository_id", "legacy_alias"], "v2 metadata identity");
  exactKeys(value.metadata.legacy_alias, ["schema", "id"], "v2 legacy alias");
  assertGitOid(value.git.object_oid, value.git.object_format);
  const entry: TrackedGitEntry = {
    path: value.path,
    path_bytes_base64: value.path_bytes_base64,
    mode: value.git.mode,
    object_type: value.git.object_type,
    object_oid: value.git.object_oid,
  };
  const policy = resolveTrackedCarrierDecision(entry);
  if (policy.disposition !== "indexed" || value.carrier !== policy.carrier)
    throw new Error("v2 record cannot represent protected/unsupported entry or divergent carrier");
  if (
    value.metadata.id !== trackedPathIdentity(value.metadata.repository_id, value.path_bytes_base64)
  )
    throw new Error("v2 canonical identity mismatch");
  if (
    canonicalJson(value.metadata.legacy_alias) !==
    canonicalJson(legacyAlias(value.metadata.repository_id, value.path))
  )
    throw new Error("v2 legacy alias projection mismatch");
}

function validatedV2Records(records: readonly MetadataIndexRecordV2[]): MetadataIndexRecordV2[] {
  const seen = new Set<string>();
  const sorted = [...records].sort(compareTrackedPaths);
  let repositoryId: string | undefined;
  let objectFormat: string | undefined;
  for (const record of sorted) {
    validateV2Record(record);
    if (seen.has(record.path_bytes_base64)) throw new Error("duplicate v2 metadata index path");
    seen.add(record.path_bytes_base64);
    repositoryId ??= record.metadata.repository_id;
    objectFormat ??= record.git.object_format;
    if (repositoryId !== record.metadata.repository_id || objectFormat !== record.git.object_format)
      throw new Error("v2 metadata index must bind one repository and object format");
  }
  return sorted;
}

function assertV2Header(header: MetadataIndexHeaderV2): void {
  const historical =
    isPlainObject(header) && Object.prototype.hasOwnProperty.call(header, "legacy_identity_claims");
  exactKeys(
    header,
    [
      "schema",
      "kind",
      "repository_id",
      "producer_version",
      "policy_contract",
      ...(historical ? ["legacy_identity_claims"] : []),
    ],
    "v2 index header",
  );
  if (
    header.schema !== METADATA_INDEX_SCHEMA_V2 ||
    header.kind !== "header" ||
    header.policy_contract !== TRACKED_POLICY_SCHEMA ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(header.producer_version)
  )
    throw new Error("unsupported v2 index header contract");
  assertPortableRepositoryIdentity(header.repository_id);
  if (historical) assertLegacyIdentityClaims(header.legacy_identity_claims, header.repository_id);
}

export function serializeMetadataIndexV2(
  records: readonly MetadataIndexRecordV2[],
  header: MetadataIndexHeaderV2,
): string {
  assertV2Header(header);
  const sorted = validatedV2Records(records);
  if (sorted.some((record) => record.metadata.repository_id !== header.repository_id))
    throw new Error("v2 record repository differs from header");
  return `${[header, ...sorted].map(canonicalJson).join("\n")}\n`;
}

export function parseMetadataIndexV2(bytes: string): MetadataIndexRecordV2[] {
  if (bytes === "") throw new Error("v2 metadata index requires a versioned header");
  if (!bytes.endsWith("\n")) throw new Error("v2 metadata index must end with a newline");
  const [header, ...records] = bytes
    .slice(0, -1)
    .split("\n")
    .map((line) => JSON.parse(line)) as [MetadataIndexHeaderV2, ...MetadataIndexRecordV2[]];
  if (serializeMetadataIndexV2(records, header) !== bytes)
    throw new Error("v2 metadata index must use canonical JSON and raw-byte path order");
  return records;
}

export type VersionedMetadataIndex =
  | { schema: typeof METADATA_INDEX_SCHEMA; records: MetadataIndexRecord[] }
  | {
      schema: typeof METADATA_INDEX_SCHEMA_V2;
      header: MetadataIndexHeaderV2;
      records: MetadataIndexRecordV2[];
    };

/** v1 admits empty JSONL; v2 always requires its explicit header. */
export function readVersionedMetadataIndex(bytes: string): VersionedMetadataIndex {
  if (bytes === "") {
    return { schema: METADATA_INDEX_SCHEMA, records: [] };
  }
  if (!bytes.endsWith("\n")) throw new Error("metadata index must end with a newline");
  const schemas = new Set(
    bytes
      .slice(0, -1)
      .split("\n")
      .map((line) => {
        const value: unknown = JSON.parse(line);
        if (!isPlainObject(value)) throw new Error("metadata index record must be an object");
        return value.schema;
      }),
  );
  if (schemas.size !== 1) throw new Error("mixed metadata index versions are forbidden");
  if (schemas.has(METADATA_INDEX_SCHEMA))
    return { schema: METADATA_INDEX_SCHEMA, records: parseMetadataIndex(bytes) };
  if (schemas.has(METADATA_INDEX_SCHEMA_V2))
    return {
      schema: METADATA_INDEX_SCHEMA_V2,
      header: JSON.parse(bytes.split("\n")[0]) as MetadataIndexHeaderV2,
      records: parseMetadataIndexV2(bytes),
    };
  throw new Error("unsupported metadata index version");
}

function trackedMetadataRecord(
  entry: TrackedCarrierDecision,
  snapshot: TrackedGitSnapshot,
): MetadataIndexRecordV2 {
  if (entry.path === null || entry.carrier === "hard_skip")
    throw new Error("indexed entry lacks safe representable path");
  return {
    schema: METADATA_INDEX_SCHEMA_V2,
    path: entry.path,
    path_bytes_base64: entry.path_bytes_base64,
    carrier: entry.carrier,
    artifact_type: "unknown",
    content_kind: "Unknown",
    content_hash: null,
    content_hash_scope: "not_inspected",
    git: {
      mode: entry.mode,
      object_type: entry.object_type,
      object_oid: entry.object_oid,
      object_format: snapshot.object_format,
    },
    metadata: {
      id: trackedPathIdentity(snapshot.repository_id, entry.path_bytes_base64),
      repository_id: snapshot.repository_id,
      legacy_alias: legacyAlias(snapshot.repository_id, entry.path),
    },
  };
}

function trackedMetadataHeader(input: CompileTrackedMetadataInput): MetadataIndexHeaderV2 {
  const { snapshot } = input;
  const header: MetadataIndexHeaderV2 = {
    schema: METADATA_INDEX_SCHEMA_V2,
    kind: "header",
    repository_id: snapshot.repository_id,
    producer_version: input.producerVersion,
    policy_contract: TRACKED_POLICY_SCHEMA,
  };
  if (input.legacyIdentityClaims !== undefined) {
    assertLegacyIdentityClaims(input.legacyIdentityClaims, snapshot.repository_id);
    header.legacy_identity_claims = freezeHistoricalClaims(input.legacyIdentityClaims);
  }
  return header;
}

function trackedAliasAmbiguities(
  records: readonly MetadataIndexRecordV2[],
): LegacyTrackedAliasGroup[] {
  const byAlias = new Map<string, string[]>();
  for (const record of records) {
    const alias = record.metadata.legacy_alias.id;
    byAlias.set(alias, [...(byAlias.get(alias) ?? []), record.metadata.id]);
  }
  return [...byAlias.entries()]
    .filter(([, ids]) => ids.length > 1)
    .sort(([a], [b]) => compareCodePoints(a, b))
    .map(([alias, ids]) => ({ schema: LEGACY_ALIAS_SCHEMA, alias, ids }));
}

export function compileTrackedMetadataIndex(
  input: CompileTrackedMetadataInput,
): TrackedMetadataCompilation {
  const { snapshot } = input;
  if (
    typeof input.producerVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(input.producerVersion)
  )
    throw new Error("explicit producer version required");
  const decisions = [...(input.decisions ?? resolveTrackedCarrierDecisions(snapshot.entries))].sort(
    compareTrackedPaths,
  );
  assertTrackedDecisionCoverage(snapshot, decisions);
  const records = decisions
    .filter((entry) => entry.disposition === "indexed")
    .map((entry) => trackedMetadataRecord(entry, snapshot));
  const header = trackedMetadataHeader(input);
  const bytes = serializeMetadataIndexV2(records, header);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const alias_ambiguities = trackedAliasAmbiguities(records);
  const coverage: TrackedCoverageReceipt = {
    schema: TRACKED_COVERAGE_SCHEMA,
    policy_contract: TRACKED_POLICY_SCHEMA,
    producer_version: input.producerVersion,
    repository_id: snapshot.repository_id,
    snapshot: {
      revision: snapshot.revision,
      tree_oid: snapshot.tree_oid,
      object_format: snapshot.object_format,
    },
    population: "tracked_tree_leaves",
    subject_content_reads: false,
    source_mutation: "never",
    authority_inspection: "not_performed",
    host_materializability: "not_assessed",
    index: { schema: METADATA_INDEX_SCHEMA_V2, sha256 },
    entries: decisions.map((entry) => ({
      ...entry,
      id: trackedPathIdentity(snapshot.repository_id, entry.path_bytes_base64),
      content_hash: null,
      content_hash_scope: "not_inspected",
    })),
    alias_ambiguities,
    totals: {
      tree_leaves: snapshot.entries.length,
      indexed: records.length,
      protected: decisions.filter((entry) => entry.disposition === "protected").length,
      unsupported: decisions.filter((entry) => entry.disposition === "unsupported").length,
    },
    closure: "exact_set_verified",
  };
  assertTrackedIndexCoverage(snapshot, decisions, records);
  return {
    header,
    records,
    bytes,
    sha256,
    carrierDecisions: decisions,
    coverage,
    coverageBytes: `${canonicalJson(coverage)}\n`,
  };
}

/** Bind materialization to the census and reject missing/extra/evidence-swapped records. */
export function assertTrackedIndexCoverage(
  snapshot: TrackedGitSnapshot,
  decisions: readonly TrackedCarrierDecision[],
  records: readonly MetadataIndexRecordV2[],
): void {
  assertTrackedDecisionCoverage(snapshot, decisions);
  validatedV2Records(records);
  const indexed = new Map(
    decisions
      .filter((entry) => entry.disposition === "indexed")
      .map((entry) => [entry.path_bytes_base64, entry]),
  );
  const seen = new Set<string>();
  for (const record of records) {
    const expected = indexed.get(record.path_bytes_base64);
    if (!expected) throw new Error("extra tracked index record");
    if (seen.has(record.path_bytes_base64)) throw new Error("duplicate tracked index record");
    seen.add(record.path_bytes_base64);
    if (
      record.metadata.repository_id !== snapshot.repository_id ||
      record.git.object_format !== snapshot.object_format ||
      record.path !== expected.path ||
      record.git.mode !== expected.mode ||
      record.git.object_type !== expected.object_type ||
      record.git.object_oid !== expected.object_oid ||
      record.carrier !== expected.carrier
    )
      throw new Error("tracked index evidence mismatch");
  }
  if (seen.size !== indexed.size) throw new Error("missing tracked index record");
}

/** Receipt-only verification reconstructs the declared population; an external census binds its truth. */
export function parseTrackedCoverage(
  bytes: string,
  snapshot: TrackedGitSnapshot,
  records: readonly MetadataIndexRecordV2[],
  header?: MetadataIndexHeaderV2,
): TrackedCoverageReceipt {
  const value: unknown = JSON.parse(bytes);
  exactKeys(
    value,
    [
      "schema",
      "policy_contract",
      "producer_version",
      "repository_id",
      "snapshot",
      "population",
      "subject_content_reads",
      "source_mutation",
      "host_materializability",
      "authority_inspection",
      "index",
      "entries",
      "alias_ambiguities",
      "totals",
      "closure",
    ],
    "tracked coverage receipt",
  );
  const receipt = value as unknown as TrackedCoverageReceipt;
  const compiled = compileTrackedMetadataIndex({
    snapshot,
    producerVersion: receipt.producer_version,
    ...(header?.legacy_identity_claims
      ? { legacyIdentityClaims: header.legacy_identity_claims }
      : {}),
  });
  assertTrackedIndexCoverage(snapshot, compiled.carrierDecisions, records);
  if (
    serializeMetadataIndexV2(records, header ?? compiled.header) !== compiled.bytes ||
    compiled.coverageBytes !== bytes
  )
    throw new Error("tracked coverage receipt evidence/canonical closure mismatch");
  return receipt;
}

/** Legacy unscoped rebuilds may repair corrupt v1, never implicitly replace versioned stores. */
export function assertLegacyMetadataIndexWrite(bytes: string): void {
  // A damaged or reformatted record can split the marker across lines, which the
  // per-line pass below cannot see; scan the whole byte sequence as well.
  for (const match of bytes.matchAll(/"schema"\s*:\s*"(l9\.metadata-index\/[^"\r\n]+)"/g)) {
    if (match[1] !== METADATA_INDEX_SCHEMA) {
      throw new Error(
        `legacy metadata operation cannot downgrade active ${match[1]}; use explicit versioned workflow`,
      );
    }
  }
  for (const line of bytes.split("\n")) {
    let schema: unknown;
    try {
      const value: unknown = JSON.parse(line);
      if (isPlainObject(value)) schema = value.schema;
    } catch {
      // Preserve corrupt-v1 rebuild behavior, but retain an explicit version marker even in a damaged record.
      schema = /"schema"\s*:\s*"(l9\.metadata-index\/[^"\r\n]+)"/.exec(line)?.[1];
    }
    if (
      typeof schema === "string" &&
      schema.startsWith("l9.metadata-index/") &&
      schema !== METADATA_INDEX_SCHEMA
    ) {
      throw new Error(
        `legacy metadata operation cannot downgrade active ${schema}; use explicit versioned workflow`,
      );
    }
  }
}

export interface TrackedMetadataIndexBase {
  exists: boolean;
  unmergeableReason?: string;
  sha256?: string;
  bytes?: string;
  index?: VersionedMetadataIndex;
}

interface MetadataIndexDirectoryObservation {
  path: string;
  descriptor: number;
  stat: fs.Stats;
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Check names against held directory descriptors, not against a prior existence probe. */
function assertMetadataIndexDirectories(
  directories: readonly MetadataIndexDirectoryObservation[],
): void {
  for (const directory of directories) {
    const named = fs.lstatSync(directory.path);
    const held = fs.fstatSync(directory.descriptor);
    if (
      named.isSymbolicLink() ||
      !named.isDirectory() ||
      !held.isDirectory() ||
      !sameFileIdentity(named, directory.stat) ||
      !sameFileIdentity(held, directory.stat)
    ) {
      throw new Error(
        "metadata index parent changed during inspection; ancestry must remain real directories",
      );
    }
  }
}

/**
 * Linux permits directory-relative opens through a held /proc descriptor. Elsewhere
 * Node has no portable openat: parent identities are checked before and after the
 * read, but a hostile transient parent swap-and-restore is not an atomic boundary.
 * Do not fall back to pathname traversal if Linux's descriptor namespace is absent.
 */
function metadataIndexChildPath(parent: MetadataIndexDirectoryObservation, name: string): string {
  return process.platform === "linux"
    ? `/proc/self/fd/${parent.descriptor}/${name}`
    : path.join(parent.path, name);
}

function openMetadataIndexEntry(target: string, directory: boolean): number {
  try {
    // NONBLOCK prevents a substituted FIFO from hanging before fstat can refuse it.
    return fs.openSync(
      target,
      fs.constants.O_RDONLY |
        fs.constants.O_NOFOLLOW |
        fs.constants.O_NONBLOCK |
        (directory ? fs.constants.O_DIRECTORY : 0),
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "ENOTDIR") {
      throw new Error(
        directory
          ? "metadata index ancestry must be a real directory"
          : "metadata index target must be a regular file",
      );
    }
    throw error;
  }
}

/** Optional paths are absent only when their direct open fails with ENOENT. */
function openOptionalMetadataIndexEntry(target: string, directory: boolean): number | undefined {
  try {
    return openMetadataIndexEntry(target, directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function ownMetadataIndexDirectory(
  namedPath: string,
  descriptor: number,
  directories: MetadataIndexDirectoryObservation[],
): MetadataIndexDirectoryObservation {
  let stat: fs.Stats;
  try {
    stat = fs.fstatSync(descriptor);
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
  const directory = { path: namedPath, descriptor, stat };
  directories.push(directory);
  if (!stat.isDirectory()) throw new Error("metadata index ancestry must be a real directory");
  return directory;
}

function observeMetadataIndexDirectories(
  root: string,
  directories: MetadataIndexDirectoryObservation[],
): boolean {
  const filesystemRoot = path.parse(root).root;
  let parent = ownMetadataIndexDirectory(
    filesystemRoot,
    openMetadataIndexEntry(filesystemRoot, true),
    directories,
  );
  if (process.platform === "linux") {
    // Establish the descriptor namespace outside the optional-path ENOENT catches.
    const pinned = fs.statSync(`/proc/self/fd/${parent.descriptor}`);
    if (!pinned.isDirectory() || !sameFileIdentity(pinned, parent.stat)) {
      throw new Error("metadata index directory descriptor namespace is unavailable");
    }
  }
  for (const segment of root.slice(filesystemRoot.length).split(path.sep).filter(Boolean)) {
    parent = ownMetadataIndexDirectory(
      path.join(parent.path, segment),
      openMetadataIndexEntry(metadataIndexChildPath(parent, segment), true),
      directories,
    );
  }
  const descriptor = openOptionalMetadataIndexEntry(metadataIndexChildPath(parent, ".l9"), true);
  if (descriptor === undefined) {
    assertMetadataIndexDirectories(directories);
    return false;
  }
  ownMetadataIndexDirectory(path.join(parent.path, ".l9"), descriptor, directories);
  assertMetadataIndexDirectories(directories);
  return true;
}

function assertMetadataIndexTarget(
  directories: readonly MetadataIndexDirectoryObservation[],
  target: string,
  opened: fs.Stats,
): void {
  assertMetadataIndexDirectories(directories);
  const named = fs.lstatSync(target);
  if (named.isSymbolicLink() || !named.isFile() || !sameFileIdentity(named, opened)) {
    throw new Error("metadata index target changed during inspection");
  }
}

function assertMetadataIndexRead(before: fs.Stats, after: fs.Stats, raw: Buffer): void {
  if (
    !after.isFile() ||
    !sameFileIdentity(after, before) ||
    raw.length !== before.size ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs
  ) {
    throw new Error("metadata index target changed during inspection");
  }
}

/**
 * Single producer-owned byte observation for tracked bases and legacy admission.
 * Only open's ENOENT admits absence; links (including dangling links) and special
 * entries are refused. Hash the same FD bytes that the caller classifies. Parsing
 * stays with the version owner so legacy corrupt-v1 repair remains compatible.
 */
export function readMetadataIndexBaseBytes(
  rootInput: string,
): { exists: false } | { exists: true; raw: Buffer; sha256: string } {
  const root = path.resolve(rootInput);
  const directories: MetadataIndexDirectoryObservation[] = [];
  let descriptor: number | undefined;
  try {
    if (!observeMetadataIndexDirectories(root, directories)) return { exists: false };
    const parent = directories.at(-1)!;
    descriptor = openOptionalMetadataIndexEntry(
      metadataIndexChildPath(parent, "metadata-index.jsonl"),
      false,
    );
    if (descriptor === undefined) {
      assertMetadataIndexDirectories(directories);
      return { exists: false };
    }
    const before = fs.fstatSync(descriptor);
    if (!before.isFile()) throw new Error("metadata index target must be a regular file");
    const target = path.join(parent.path, "metadata-index.jsonl");
    assertMetadataIndexTarget(directories, target, before);
    const raw = fs.readFileSync(descriptor);
    assertMetadataIndexRead(before, fs.fstatSync(descriptor), raw);
    assertMetadataIndexTarget(directories, target, before);
    return { exists: true, raw, sha256: createHash("sha256").update(raw).digest("hex") };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    for (const directory of directories.reverse()) fs.closeSync(directory.descriptor);
  }
}

/** Read only the active managed index, never a subject. Dangling symlinks count as unsafe. */
export function readTrackedMetadataIndexBase(rootInput: string): TrackedMetadataIndexBase {
  const base = readMetadataIndexBaseBytes(rootInput);
  if (!base.exists) return { exists: false };
  const bytes = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(base.raw);
  return { exists: true, bytes, sha256: base.sha256, index: readVersionedMetadataIndex(bytes) };
}

export const METADATA_INDEX_MIGRATION_SCHEMA_V2 = "l9.metadata-index-migration/v2" as const;

export interface MetadataIndexLegacyRecordV2 {
  path: string;
  path_bytes_base64: string;
  canonical_id: string;
  legacy_metadata_id: unknown;
  legacy_id_state: "present" | "absent";
  legacy_content_hash_claim: string;
  legacy_content_hash_scope: "legacy_v1_claim_not_revalidated";
  snapshot_presence: "tracked" | "absent_from_snapshot";
}

/** Historical/unverified claims in the one active header; deliberately no target hash. */
export interface MetadataIndexLegacyIdentityClaimsV2 {
  source_index: { schema: typeof METADATA_INDEX_SCHEMA; sha256: string };
  snapshot_at_migration: {
    revision: string;
    tree_oid: string;
    object_format: TrackedGitSnapshot["object_format"];
  };
  legacy_records: MetadataIndexLegacyRecordV2[];
}

/** External evidence binds the final index bytes without introducing a self-reference. */
export interface MetadataIndexMigrationEvidenceV2 {
  schema: typeof METADATA_INDEX_MIGRATION_SCHEMA_V2;
  repository_id: string;
  snapshot: {
    revision: string;
    tree_oid: string;
    object_format: TrackedGitSnapshot["object_format"];
  };
  source_index: { schema: typeof METADATA_INDEX_SCHEMA; sha256: string };
  target_index: { schema: typeof METADATA_INDEX_SCHEMA_V2; sha256: string };
  legacy_records: MetadataIndexLegacyRecordV2[];
}

function assertLegacyIdentityClaims(
  value: unknown,
  repositoryId: string,
): asserts value is MetadataIndexLegacyIdentityClaimsV2 {
  exactKeys(
    value,
    ["source_index", "snapshot_at_migration", "legacy_records"],
    "v2 historical identity claims",
  );
  exactKeys(value.source_index, ["schema", "sha256"], "historical source index");
  if (value.source_index.schema !== METADATA_INDEX_SCHEMA)
    throw new Error("historical claims require a v1 source index");
  assertContentHash(value.source_index.sha256 as string, "historical source index bytes");
  exactKeys(
    value.snapshot_at_migration,
    ["revision", "tree_oid", "object_format"],
    "historical migration snapshot",
  );
  const snapshot =
    value.snapshot_at_migration as MetadataIndexLegacyIdentityClaimsV2["snapshot_at_migration"];
  assertGitOid(snapshot.revision, snapshot.object_format);
  assertGitOid(snapshot.tree_oid, snapshot.object_format);
  if (!Array.isArray(value.legacy_records))
    throw new Error("historical legacy_records must be an array");
  let previous: MetadataIndexLegacyRecordV2 | undefined;
  for (const item of value.legacy_records) {
    exactKeys(
      item,
      [
        "path",
        "path_bytes_base64",
        "canonical_id",
        "legacy_metadata_id",
        "legacy_id_state",
        "legacy_content_hash_claim",
        "legacy_content_hash_scope",
        "snapshot_presence",
      ],
      "historical legacy record",
    );
    const record = item as unknown as MetadataIndexLegacyRecordV2;
    if (typeof record.path !== "string") throw new Error("historical path must be a v1 path");
    normalizeRelativePath(record.path);
    assertRecordPath(record.path);
    const raw = Buffer.from(record.path, "utf8");
    if (
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw) !== record.path ||
      raw.toString("base64") !== record.path_bytes_base64
    )
      throw new Error("historical raw path spelling mismatch");
    if (record.canonical_id !== trackedPathIdentity(repositoryId, record.path_bytes_base64))
      throw new Error("historical canonical identity mismatch");
    if (previous && compareTrackedPaths(previous, record) >= 0)
      throw new Error("historical records require unique canonical raw path order");
    previous = record;
    if (record.legacy_id_state !== "present" && record.legacy_id_state !== "absent")
      throw new Error("unsupported historical legacy ID state");
    if (record.legacy_id_state === "absent" && record.legacy_metadata_id !== null)
      throw new Error("absent historical legacy ID must be null");
    if (typeof record.legacy_metadata_id === "string") {
      try {
        assertPortableRepositoryIdentity(record.legacy_metadata_id);
      } catch {
        throw new Error("historical legacy ID must be a nonempty safe exact UTF-8 string");
      }
    }
    canonicalJson(record.legacy_metadata_id);
    assertContentHash(record.legacy_content_hash_claim, record.path);
    if (record.legacy_content_hash_scope !== "legacy_v1_claim_not_revalidated")
      throw new Error("unsupported historical content hash scope");
    if (
      record.snapshot_presence !== "tracked" &&
      record.snapshot_presence !== "absent_from_snapshot"
    )
      throw new Error("unsupported historical snapshot presence");
  }
  canonicalJson(value);
}

function freezeHistoricalClaims(
  claims: MetadataIndexLegacyIdentityClaimsV2,
): MetadataIndexLegacyIdentityClaimsV2 {
  const copy = JSON.parse(canonicalJson(claims)) as MetadataIndexLegacyIdentityClaimsV2;
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(copy);
  return copy;
}

/** Compile before the target: preserve all prior claims, even absent/protected paths. */
export function compileMetadataIndexLegacyIdentityClaims(
  base: VersionedMetadataIndex,
  sourceSha256: string,
  snapshot: TrackedGitSnapshot,
): MetadataIndexLegacyIdentityClaimsV2 {
  if (base.schema !== METADATA_INDEX_SCHEMA)
    throw new Error("migration claims require a v1 source index");
  assertTrackedSnapshot(snapshot);
  assertContentHash(sourceSha256, "legacy index bytes");
  if (
    createHash("sha256").update(serializeMetadataIndex(base.records)).digest("hex") !== sourceSha256
  )
    throw new Error("migration source hash must bind actual prior active index bytes");
  const tracked = new Set(snapshot.entries.map((entry) => entry.path_bytes_base64));
  const legacy_records = base.records
    .map((record) => {
      const raw = Buffer.from(record.path, "utf8").toString("base64");
      return {
        path: record.path,
        path_bytes_base64: raw,
        canonical_id: trackedPathIdentity(snapshot.repository_id, raw),
        legacy_metadata_id: Object.prototype.hasOwnProperty.call(record.metadata, "id")
          ? record.metadata.id
          : null,
        legacy_id_state: Object.prototype.hasOwnProperty.call(record.metadata, "id")
          ? ("present" as const)
          : ("absent" as const),
        legacy_content_hash_claim: record.content_hash,
        legacy_content_hash_scope: "legacy_v1_claim_not_revalidated" as const,
        snapshot_presence: tracked.has(raw)
          ? ("tracked" as const)
          : ("absent_from_snapshot" as const),
      };
    })
    .sort(compareTrackedPaths);
  const claims: MetadataIndexLegacyIdentityClaimsV2 = {
    source_index: { schema: METADATA_INDEX_SCHEMA, sha256: sourceSha256 },
    snapshot_at_migration: {
      revision: snapshot.revision,
      tree_oid: snapshot.tree_oid,
      object_format: snapshot.object_format,
    },
    legacy_records,
  };
  assertLegacyIdentityClaims(claims, snapshot.repository_id);
  return freezeHistoricalClaims(claims);
}

/** Complete external evidence is emitted only after final target serialization. */
export function compileMetadataIndexMigrationEvidence(
  base: VersionedMetadataIndex,
  sourceSha256: string,
  target: TrackedMetadataCompilation,
  snapshot: TrackedGitSnapshot,
): MetadataIndexMigrationEvidenceV2 {
  const claims =
    base.schema === METADATA_INDEX_SCHEMA
      ? compileMetadataIndexLegacyIdentityClaims(base, sourceSha256, snapshot)
      : base.header.legacy_identity_claims;
  if (!claims) throw new Error("migration evidence requires retained historical claims");
  assertLegacyIdentityClaims(claims, snapshot.repository_id);
  if (canonicalJson(claims) !== canonicalJson(target.header.legacy_identity_claims))
    throw new Error("migration evidence historical retention mismatch");
  if (
    serializeMetadataIndexV2(target.records, target.header) !== target.bytes ||
    createHash("sha256").update(target.bytes).digest("hex") !== target.sha256
  )
    throw new Error("migration evidence target hash must bind final serialized index bytes");
  const evidence: MetadataIndexMigrationEvidenceV2 = {
    schema: METADATA_INDEX_MIGRATION_SCHEMA_V2,
    repository_id: snapshot.repository_id,
    snapshot: claims.snapshot_at_migration,
    source_index: claims.source_index,
    target_index: { schema: METADATA_INDEX_SCHEMA_V2, sha256: target.sha256 },
    legacy_records: claims.legacy_records,
  };
  canonicalJson(evidence);
  return evidence;
}

/** Retention is historical, never an override of the deterministic active alias projection. */
export function metadataIndexMigrationAliasProblem(
  base: VersionedMetadataIndex,
  target: TrackedMetadataCompilation,
): string | null {
  try {
    serializeMetadataIndexV2(target.records, target.header);
    if (base.schema === METADATA_INDEX_SCHEMA_V2) {
      if (base.header.legacy_identity_claims)
        assertLegacyIdentityClaims(base.header.legacy_identity_claims, base.header.repository_id);
      const oldClaims = base.header.legacy_identity_claims;
      const newClaims = target.header.legacy_identity_claims;
      if (
        (oldClaims === undefined) !== (newClaims === undefined) ||
        (oldClaims !== undefined && canonicalJson(oldClaims) !== canonicalJson(newClaims))
      )
        throw new Error("active v2 historical claims must remain unchanged");
    } else {
      const sourceSha256 = createHash("sha256")
        .update(serializeMetadataIndex(base.records))
        .digest("hex");
      const snapshot: TrackedGitSnapshot = {
        repository_id: target.header.repository_id,
        ...target.coverage.snapshot,
        entries: target.carrierDecisions.map(
          ({ path, path_bytes_base64, mode, object_type, object_oid }) => ({
            path,
            path_bytes_base64,
            mode,
            object_type,
            object_oid,
          }),
        ),
      };
      const expected = compileMetadataIndexLegacyIdentityClaims(base, sourceSha256, snapshot);
      if (
        !target.header.legacy_identity_claims ||
        canonicalJson(expected) !== canonicalJson(target.header.legacy_identity_claims)
      )
        throw new Error("historical block must retain every known v1 ID and record claim");
    }
    return null;
  } catch (error) {
    return `TRACKED_MIGRATION_ALIAS_LOSS: ${error instanceof Error ? error.message : String(error)}`;
  }
}
