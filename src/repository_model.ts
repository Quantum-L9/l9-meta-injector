// repository_model.ts — Repository Model Packet (`l9.repository-model`) egress.
//
// Converts repository observations that this package already owns (inventory +
// classification evidence) into a deterministic, evidence-preserving packet that the
// l9-constellation-topology Repository Model consumer accepts without translation.
//
// Boundaries this module holds:
//   - No runtime dependency on the topology implementation, Python, or the network.
//     The wire contract is mirrored here from the bound consumer revision.
//   - Machine-specific absolute paths never participate in portable semantic identity.
//   - Capabilities and relationships are emitted only where repository evidence
//     supports them; absence stays absent and is reported as a diagnostic.
//   - Unknowns are preserved as explicit values and diagnostics, never silently
//     upgraded into certainty.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { InventoryRecord, InventoryResult, inventoryTree } from "./inventory";
import { compareCodePoints } from "./ordering";
import { InterpretationResult, interpretRepository } from "./interpretation";
import { defaultExtractors } from "./extractors";
import { UNKNOWN } from "./schema";

/** Re-exported so packet consumers keep one ordering import site. */
export { compareCodePoints } from "./ordering";

export const REPOSITORY_MODEL_PACKET_TYPE = "l9.repository-model";
export const REPOSITORY_MODEL_PACKET_VERSION = "1.1.0";
export const REPOSITORY_MODEL_PRODUCER_NAME = "l9-meta-injector.repository-model";

/** Profile identity for the observation policy this producer applies. */
const PROFILE_ID = "meta-injector-inventory-observation";
const PROFILE_VERSION = "1.0.0";
const OBSERVATION_STAGE = "meta-injector-inventory";
const RECEIPT_PACKET_TYPE = "l9.validation-receipt";
const RECEIPT_PACKET_VERSION = "1.0.0";
const RECEIPT_RELATIVE_PATH = "receipts/validation-receipt.json";
const PACKET_RELATIVE_PATH = "packet.json";
const MANIFEST_RELATIVE_PATH = "manifest.json";
const MANIFEST_VERSION = "1.0.0";
const JSON_MEDIA_TYPE = "application/json";
const SHA_PREFIX = "sha256:";

/**
 * Default emission timestamp. Mirrors the inventory default so a packet is
 * byte-deterministic unless the caller deliberately supplies a real clock value.
 * Timestamps never participate in semantic identity (the consumer strips them).
 */
const DEFAULT_GENERATED_AT = "1970-01-01T00:00:00.000Z";

// ───────────────────────────── canonical form ─────────────────────────────
// Mirrors the bound consumer's canonical_data / canonical_json / semantic_hash rules:
// object keys sorted by code point, no separator whitespace, absent fields omitted,
// and a fixed set of volatile keys removed before hashing.

export type CanonicalValue = string | number | boolean | null | CanonicalValue[] | { [key: string]: CanonicalValue };

const VOLATILE_KEYS: ReadonlySet<string> = new Set([
  "created_at", "checked_at", "generated_at", "committed_at", "frozen_at",
  "run_id", "stage_id", "trace_id", "workflow_id",
  "artifact_hash", "semantic_hash", "packet_id", "receipt_id",
]);


function canonicalize(value: unknown): CanonicalValue {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(source).sort(compareCodePoints)) {
      const item = source[key];
      if (item === undefined) continue; // an absent field, not a null one
      out[key] = canonicalize(item);
    }
    return out;
  }
  if (typeof value === "number") {
    // The consumer rejects NaN/Infinity, and float repr differs between runtimes.
    // Keeping the packet integer-only removes that divergence class entirely.
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`repository-model: only finite integer numbers are canonical, got ${String(value)}`);
    }
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  throw new Error(`repository-model: unsupported canonical value of type ${typeof value}`);
}

/** Render already-canonical data. Written by hand so key order can never be re-sorted by the engine. */
function render(value: CanonicalValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => render(item)).join(",")}]`;
  const keys = Object.keys(value).sort(compareCodePoints);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${render(value[key])}`).join(",")}}`;
}

/** Canonical JSON text for any packet-shaped value. */
export function canonicalJson(value: unknown): string {
  return render(canonicalize(value));
}

function stripVolatile(value: CanonicalValue): CanonicalValue {
  if (Array.isArray(value)) return value.map((item) => stripVolatile(item));
  if (value !== null && typeof value === "object") {
    const out: Record<string, CanonicalValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = stripVolatile(item);
    }
    return out;
  }
  return value;
}

function sha256Prefixed(content: Buffer): string {
  return SHA_PREFIX + crypto.createHash("sha256").update(content).digest("hex");
}

/** Content identity of exact text, used by interpretation evidence. */
export function sha256TextPrefixed(value: string): string {
  return sha256Prefixed(Buffer.from(value, "utf8"));
}

/** Content identity of exact bytes. */
function artifactHash(content: Buffer): string {
  return sha256Prefixed(content);
}

/** Semantic identity: volatile fields removed, then canonical bytes hashed. */
export function semanticHash(value: unknown): string {
  return sha256Prefixed(Buffer.from(render(stripVolatile(canonicalize(value))), "utf8"));
}

export function stableId(prefix: string, value: unknown): string {
  return `${prefix}:${semanticHash(value).slice(SHA_PREFIX.length)}`;
}

/**
 * Stable identity of one artifact inside a repository.
 *
 * Interpretation needs this to point an assertion at the exact file that made a
 * declaration, and the packet builder needs it to emit that file's artifact
 * record. Two implementations of the same formula would eventually disagree and
 * strand every artifact-scoped assertion, so both call this one.
 *
 * `sourcePath` is the repository-relative POSIX path, or a virtual archive
 * member locator such as `Bundle.zip!/docs/a.md`. Absolute paths never
 * participate.
 */
export function repositoryModelArtifactId(repositoryId: string, sourcePath: string): string {
  return stableId("artifact", { repository_id: repositoryId, source_path: sourcePath });
}

// ───────────────────────────── contract types ─────────────────────────────

export type RepositoryModelConfidenceLevel = "low" | "medium" | "high";
export type RepositoryModelEvidenceStrength = "none" | "weak" | "corroborated" | "direct";
export type RepositoryModelDerivationMethod =
  | "declared" | "deterministic" | "cross-record" | "heuristic" | "model-assisted" | "unknown";
export type RepositoryModelAuthority = "source" | "validated-machine" | "derived" | "candidate" | "unknown";
export type RepositoryModelCompleteness = "partial" | "sufficient" | "complete";
export type RepositoryModelConflictStatus = "none" | "possible" | "confirmed";

export interface RepositoryModelConfidence {
  level: RepositoryModelConfidenceLevel;
  evidence_strength: RepositoryModelEvidenceStrength;
  derivation_method: RepositoryModelDerivationMethod;
  authority: RepositoryModelAuthority;
  completeness: RepositoryModelCompleteness;
  conflict_status: RepositoryModelConflictStatus;
}

export interface RepositoryModelSourceRef {
  source_path?: string;
  line_number?: number;
  content_hash?: string;
  source_revision?: string;
}

export type RepositoryModelEvidenceClass =
  | "observed" | "declared" | "derived" | "assisted" | "projected" | "validated" | "committed";
export type RepositoryModelEvidenceSourceType = "file" | "packet" | "inference" | "validation" | "unknown";

export interface RepositoryModelEvidenceRecord {
  evidence_id: string;
  subject_id: string;
  field?: string;
  stage: string;
  evidence_class: RepositoryModelEvidenceClass;
  source_type: RepositoryModelEvidenceSourceType;
  source_ref: RepositoryModelSourceRef;
  value: CanonicalValue;
  confidence: RepositoryModelConfidence;
  producer: string;
  producer_version: string;
  created_at: string;
}

export interface RepositoryModelArtifactRecord {
  artifact_id: string;
  repository_id: string;
  source_path: string;
  artifact_type: string;
  family?: string;
  content_hash: string;
  body_hash?: string;
  capabilities: string[];
  dependencies: string[];
  evidence_refs: string[];
  packet_ref: string;
  confidence: RepositoryModelConfidence;
}

export interface RepositoryModelRepositoryRecord {
  repository_id: string;
  name: string;
  source_revision: string;
  packet_ref: string;
  primary_role: string;
  secondary_roles: string[];
  languages: string[];
  package_managers: string[];
  entrypoints: string[];
  workflows: string[];
  adr_refs: string[];
  governance_refs: string[];
  capability_ids: string[];
  artifact_ids: string[];
  upstream_repository_ids: string[];
  downstream_repository_ids: string[];
  unresolved_dependencies: string[];
  owner_ids: string[];
  evidence_refs: string[];
  confidence: RepositoryModelConfidence;
}

export interface RepositoryModelCapabilityRecord {
  capability_id: string;
  name: string;
  description: string;
  implemented_by: string[];
  exposed_by: string[];
  validated_by: string[];
  governed_by: string[];
  evidence_refs: string[];
  confidence: RepositoryModelConfidence;
}

export type RepositoryModelEdgeType =
  | "CONTAINS" | "DEPENDS_ON" | "IMPLEMENTS" | "EXPOSES" | "VALIDATED_BY" | "GOVERNED_BY"
  | "OWNED_BY" | "DOCUMENTED_BY" | "PRODUCES" | "CONSUMES" | "DERIVED_FROM" | "SUPERSEDES"
  | "ROUTES_TO" | "PUBLISHES_TO" | "MEMBER_OF";

export interface RepositoryModelEdgeRecord {
  edge_id: string;
  source_id: string;
  target_id: string;
  edge_type: RepositoryModelEdgeType;
  direction: "outbound" | "inbound" | "bidirectional";
  properties: Record<string, CanonicalValue>;
  evidence_refs: string[];
  confidence: RepositoryModelConfidence;
}

export interface RepositoryModelDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  stage: string;
  category: string;
  subject_id?: string;
  evidence_refs?: string[];
  details?: Record<string, CanonicalValue>;
}

/**
 * A semantic claim the repository makes about itself, carried across the packet
 * boundary as first-class typed data.
 *
 * Assertions are deliberately not folded into `diagnostics`: a diagnostic
 * reports something about the observation run, while an assertion is repository
 * truth a consumer reconciles. Encoding one as the other to avoid extending the
 * contract would make semantic content unreadable without string parsing.
 *
 * Every field is required. An assertion that cannot cite an exact span in a
 * hashed source file is not emitted at all.
 */
export interface RepositoryModelAssertionRecord {
  assertion_id: string;
  subject_id: string;
  predicate: string;
  object: string;
  source_path: string;
  source_range: { start_line: number; end_line: number };
  evidence_excerpt: string;
  source_content_hash: string;
  extractor_id: string;
  evidence_class: "declared" | "observed";
  authority: RepositoryModelAuthority;
  confidence: RepositoryModelConfidenceLevel;
}

export interface RepositoryModelPayload {
  repositories: RepositoryModelRepositoryRecord[];
  artifacts: RepositoryModelArtifactRecord[];
  capabilities: RepositoryModelCapabilityRecord[];
  relationships: RepositoryModelEdgeRecord[];
  evidence: RepositoryModelEvidenceRecord[];
  diagnostics: RepositoryModelDiagnostic[];
  /** Semantic claims from the interpretation pass; empty when it did not run. */
  assertions: RepositoryModelAssertionRecord[];
}

/** Identity of the interpretation profile, present only when it ran. */
export interface RepositoryModelInterpretationProfile {
  profile_id: string;
  profile_version: string;
  profile_hash: string;
  extractor_versions: Record<string, string>;
}

export interface RepositoryModelPacket {
  packet_type: string;
  packet_version: string;
  packet_id: string;
  subject: { repository_id: string };
  source_snapshot: { revision: string; semantic_hash: string };
  validation: { status: "passed" | "failed" | "not_run" | "blocked"; receipt_ref?: string };
  producer: { name: string; version: string };
  profile: { id: string; version: string; hash: string };
  schema_hash: string;
  semantic_hash: string;
  artifact_hash?: string;
  payload_refs: Record<string, string>;
  payload: RepositoryModelPayload;
  /** Present only when the interpretation pass ran, so it binds identity only then. */
  interpretation_profile?: RepositoryModelInterpretationProfile;
}

export interface RepositoryModelValidationCheck {
  check_id: string;
  check_class: "schema" | "invariant" | "evidence" | "cross-reference";
  rule: string;
  status: "passed" | "failed" | "blocked" | "not_run";
  message: string;
  path?: string;
  evidence_refs: string[];
  details: Record<string, CanonicalValue>;
}

export interface RepositoryModelValidationReceipt {
  packet_type: string;
  packet_version: string;
  receipt_id: string;
  subject_packet_id: string;
  subject_semantic_hash: string;
  validator: { name: string; version: string };
  status: "passed" | "failed" | "not_run" | "blocked";
  schema_results: RepositoryModelValidationCheck[];
  invariant_results: RepositoryModelValidationCheck[];
  evidence_results: RepositoryModelValidationCheck[];
  cross_reference_results: RepositoryModelValidationCheck[];
  created_at: string;
  semantic_hash: string;
}

export interface RepositoryModelValidationResult {
  status: "passed" | "failed";
  checks: RepositoryModelValidationCheck[];
}

/** One archive observed inside a local source, expanded or held. */
export interface RepositoryModelArchiveInput {
  /** Source-relative POSIX path, or a virtual locator when the archive is nested. */
  sourcePath: string;
  /** `sha256:`-prefixed digest of the exact archive bytes, or the Unknown value. */
  contentHash: string;
  sizeBytes: number;
  nestedDepth: number;
  parentArchivePath: string | null;
  parentArchiveHash: string | null;
  expanded: boolean;
  memberCount: number;
  omittedMemberCount: number;
  /** Stable codes for the preflight or budget violations that held this archive. */
  holdCodes: string[];
}

/** One archive member, carried as a virtual artifact with exact provenance. */
export interface RepositoryModelArchiveMemberInput {
  /** Machine-independent locator, e.g. `Bundle.zip!/docs/a.md`. */
  virtualSourcePath: string;
  memberPath: string;
  contentHash: string;
  sizeBytes: number;
  parentArchivePath: string;
  parentArchiveHash: string;
  nestedDepth: number;
}

export interface RepositoryModelLocalSourceDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  sourcePath?: string;
}

/**
 * Provenance overlay for a packet built from a local filesystem source.
 *
 * The artifacts themselves arrive through the inventory records, exactly as
 * repository files do. This overlay adds what inventory cannot express: which
 * artifacts are archives, which are members of which archive, and the chain that
 * links a member of a nested archive back to the outermost source file.
 */
export interface RepositoryModelLocalSourceInput {
  sourceKind: "file" | "directory" | "archive";
  /** Version of the archive resource budget that produced this observation. */
  archivePolicyVersion: string;
  archives: RepositoryModelArchiveInput[];
  members: RepositoryModelArchiveMemberInput[];
  diagnostics: RepositoryModelLocalSourceDiagnostic[];
}

export interface RepositoryModelBuildInput {
  /** Inventory observation of the repository. Produced by `inventoryTree`. */
  inventory: InventoryResult;
  /** Canonical repository name, e.g. `l9-meta-injector`. */
  repositoryName: string;
  /** Explicit source revision, e.g. `git:<40-hex>`. Never inferred. */
  sourceRevision: string;
  /** Producer version recorded in the packet and in every evidence record. */
  producerVersion: string;
  /** Emission timestamp; excluded from semantic identity. */
  generatedAt?: string;
  /**
   * Result of the deterministic interpretation pass. Optional: a packet built
   * without it carries an empty assertion domain and no interpretation profile,
   * which is exactly how packets behaved before the domain existed.
   */
  interpretation?: InterpretationResult;
  /**
   * Archive provenance for a packet built from a local filesystem source.
   * Absent for an ordinary repository observation, which keeps its prior identity.
   */
  localSource?: RepositoryModelLocalSourceInput;
}

export interface RepositoryModelObservationInput {
  /** Repository root to observe. */
  root: string;
  repositoryName: string;
  sourceRevision: string;
  producerVersion: string;
  generatedAt?: string;
  /**
   * Run the deterministic interpretation pass and carry its assertions into the
   * packet. Defaults to true: observation that reads a repository and discards
   * what it declares is the behavior this seam exists to correct. Set false to
   * emit an inventory-only packet.
   */
  interpret?: boolean;
  ignore?: string[];
  omitPatterns?: string[];
  omitFile?: string;
  hashMaxBytes?: number;
}

export interface RepositoryModelEmitResult {
  bundleRoot: string;
  packetPath: string;
  receiptPath: string;
  manifestPath: string;
  packetId: string;
  semanticHash: string;
  files: { path: string; media_type: string; content_hash: string; size_bytes: number }[];
}

// ───────────────────────────── confidence ─────────────────────────────

function confidence(
  level: RepositoryModelConfidenceLevel,
  strength: RepositoryModelEvidenceStrength,
  method: RepositoryModelDerivationMethod,
  authority: RepositoryModelAuthority,
  completeness: RepositoryModelCompleteness,
): RepositoryModelConfidence {
  return {
    level, evidence_strength: strength, derivation_method: method,
    authority, completeness, conflict_status: "none",
  };
}

/**
 * Map an inventory classification score onto the consumer's decomposed confidence.
 * The thresholds are fixed so the same observation always yields the same assessment.
 * A missing content hash caps completeness at `partial` — the observation is real but
 * incomplete, and that must not be rounded up.
 */
function artifactConfidence(score: number, hashed: boolean): RepositoryModelConfidence {
  const completeness: RepositoryModelCompleteness = hashed ? "sufficient" : "partial";
  if (score >= 0.9) return confidence("high", "corroborated", "deterministic", "validated-machine", completeness);
  if (score >= 0.5) return confidence("medium", "direct", "deterministic", "validated-machine", completeness);
  return confidence("low", "weak", "heuristic", "candidate", "partial");
}

/** Facts derived deterministically from observed repository paths. */
const DERIVED_CONFIDENCE = confidence("medium", "direct", "deterministic", "validated-machine", "sufficient");

/**
 * The repository record aggregates observed artifacts but leaves role, ownership and
 * dependency direction unresolved, so it is deliberately never better than `partial`.
 */
const REPOSITORY_CONFIDENCE = confidence("medium", "direct", "deterministic", "validated-machine", "partial");

// ───────────────────────────── path-evidence derivation ─────────────────────────────

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".rs": "Rust", ".go": "Go", ".rb": "Ruby", ".java": "Java",
  ".kt": "Kotlin", ".kts": "Kotlin", ".swift": "Swift", ".cs": "C#", ".php": "PHP",
  ".c": "C", ".h": "C", ".cc": "C++", ".cpp": "C++", ".hpp": "C++",
  ".sh": "Shell", ".bash": "Shell", ".sql": "SQL",
};

const PACKAGE_MANAGER_BY_FILENAME: Readonly<Record<string, string>> = {
  "package.json": "npm", "package-lock.json": "npm", "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn",
  "requirements.txt": "pip", "poetry.lock": "poetry", "uv.lock": "uv", "Pipfile": "pipenv",
  "Cargo.toml": "cargo", "go.mod": "go", "Gemfile": "bundler",
  "pom.xml": "maven", "build.gradle": "gradle", "build.gradle.kts": "gradle",
  "composer.json": "composer",
};

/**
 * Manifests whose filename alone does not determine a package manager. `pyproject.toml` is
 * shared by Poetry, uv, PDM, Hatch and setuptools; the discriminator (`[tool.poetry]`,
 * `build-backend`, `[tool.uv]`) lives in the file body, which inventory observation does not
 * read. These are recorded as an explicit coverage gap rather than resolved to a guess.
 */
const AMBIGUOUS_PACKAGE_MANIFESTS: ReadonlySet<string> = new Set(["pyproject.toml"]);

const GOVERNANCE_FILENAMES: ReadonlySet<string> = new Set([
  "CODEOWNERS", "AGENTS.md", "CLAUDE.md", "GOVERNANCE.md", "SECURITY.md",
  "CONTRIBUTING.md", "LICENSE", "INVARIANTS.md", "CODE_OF_CONDUCT.md",
]);

const FAMILY_BY_INVENTORY_TYPE: Readonly<Record<string, string>> = {
  code: "code", test: "test", prompt: "prompt", archive: "archive",
  schema: "configuration", config: "configuration",
  spec: "documentation", documentation: "documentation",
  research_markdown: "documentation", research_pdf: "documentation",
};

function isWorkflowPath(relativePath: string): boolean {
  return /^\.github\/workflows\/[^/]+\.(ya?ml)$/.test(relativePath);
}

function isAdrPath(relativePath: string): boolean {
  if (/^docs\/(decisions|adr|adrs)\//.test(relativePath)) return relativePath.endsWith(".md");
  return /(^|\/)adr-[^/]*\.md$/.test(relativePath);
}

function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort(compareCodePoints);
}

// ───────────────────────────── builder ─────────────────────────────

/** Deterministic identity of the observation set, independent of where it was checked out. */
function snapshotSemanticHash(records: InventoryRecord[], sourceRevision: string): string {
  return semanticHash({
    source_revision: sourceRevision,
    observations: records.map((record) => ({
      relative_path: record.relative_path,
      artifact_type: record.artifact_type,
      content_hash: record.content_hash ?? UNKNOWN,
      unknowns: sortStrings(record.unknowns),
    })),
  });
}

/** Contract descriptor hash — changes whenever the emitted shape changes. */
const SCHEMA_HASH = semanticHash({
  packet_type: REPOSITORY_MODEL_PACKET_TYPE,
  packet_version: REPOSITORY_MODEL_PACKET_VERSION,
  shell: [
    "packet_type", "packet_version", "packet_id", "subject", "source_snapshot", "validation",
    "producer", "profile", "schema_hash", "semantic_hash", "artifact_hash", "payload_refs", "payload",
  ],
  payload_domains: [
    "repositories", "artifacts", "capabilities", "relationships", "evidence", "diagnostics",
    // 1.1.0 adds semantic assertions as a first-class domain.
    "assertions",
  ],
});

/** Profile hash — binds the observation policy that produced the packet. */
const PROFILE_HASH = semanticHash({
  id: PROFILE_ID,
  version: PROFILE_VERSION,
  evidence_source: "l9-meta-injector.inventory",
  artifact_scope: "files",
  folders_emitted_as_artifacts: false,
  ordering: "code-point",
  capabilities_require_evidence: true,
  relationships_require_evidence: true,
  absolute_paths_in_identity: false,
});

/**
 * Identity of the local-source observation policy.
 *
 * A local filesystem source is observed under different rules than a Git
 * checkout: archives are staged rather than extracted beside the source,
 * symlinks are recorded but never followed, and a resource budget bounds what an
 * archive may expand into. Those rules belong in packet identity, so a
 * local-source packet declares its own profile instead of borrowing the
 * repository-inventory one. Repository packets keep the identity they had.
 */
const LOCAL_SOURCE_PROFILE_ID = "meta-injector-local-source-observation";
const LOCAL_SOURCE_PROFILE_VERSION = "1.0.0";

function localSourceProfile(input: RepositoryModelLocalSourceInput): { id: string; version: string; hash: string } {
  return {
    id: LOCAL_SOURCE_PROFILE_ID,
    version: LOCAL_SOURCE_PROFILE_VERSION,
    hash: semanticHash({
      id: LOCAL_SOURCE_PROFILE_ID,
      version: LOCAL_SOURCE_PROFILE_VERSION,
      evidence_source: "l9-meta-injector.local-source",
      source_kind: input.sourceKind,
      archive_formats_expanded: ["zip"],
      archive_policy_version: input.archivePolicyVersion,
      archive_members_are_virtual_artifacts: true,
      archive_expansion_mutates_source: false,
      symlinks_followed: false,
      ordering: "code-point",
      absolute_paths_in_identity: false,
      scratch_paths_in_identity: false,
    }),
  };
}

interface EvidenceDraft {
  subjectId: string;
  field?: string;
  evidenceClass: RepositoryModelEvidenceClass;
  sourceRef: RepositoryModelSourceRef;
  value: CanonicalValue;
  confidence: RepositoryModelConfidence;
}

function makeEvidence(
  draft: EvidenceDraft,
  producerVersion: string,
  generatedAt: string,
): RepositoryModelEvidenceRecord {
  // Identity mirrors the consumer's make_evidence_record: confidence and created_at
  // are deliberately excluded so an identical observation keeps an identical id.
  const identity = {
    subject_id: draft.subjectId,
    field: draft.field ?? null,
    stage: OBSERVATION_STAGE,
    evidence_class: draft.evidenceClass,
    source_type: "file",
    source_ref: draft.sourceRef,
    value: draft.value,
    producer: REPOSITORY_MODEL_PRODUCER_NAME,
    producer_version: producerVersion,
  };
  const record: RepositoryModelEvidenceRecord = {
    evidence_id: stableId("evidence", identity),
    subject_id: draft.subjectId,
    stage: OBSERVATION_STAGE,
    evidence_class: draft.evidenceClass,
    source_type: "file",
    source_ref: draft.sourceRef,
    value: draft.value,
    confidence: draft.confidence,
    producer: REPOSITORY_MODEL_PRODUCER_NAME,
    producer_version: producerVersion,
    created_at: generatedAt,
  };
  if (draft.field !== undefined) record.field = draft.field;
  return record;
}

/**
 * Build a Repository Model Packet from an inventory observation.
 *
 * Every emitted assertion traces back to a real repository observation. Domains with
 * no supporting evidence stay empty and are reported as diagnostics rather than filled
 * with plausible-looking inference.
 */
export function buildRepositoryModelPacket(input: RepositoryModelBuildInput): RepositoryModelPacket {
  const generatedAt = input.generatedAt ?? DEFAULT_GENERATED_AT;
  const producerVersion = input.producerVersion;
  if (!input.repositoryName) throw new Error("repository-model: repositoryName is required");
  if (!input.sourceRevision) throw new Error("repository-model: sourceRevision is required and is never inferred");
  if (!producerVersion) throw new Error("repository-model: producerVersion is required");

  const repositoryId = `repo:${input.repositoryName}`;
  // Folders carry no artifact identity of their own; they are reported as a diagnostic
  // rather than silently dropped.
  const allRecords = [...input.inventory.records].sort((a, b) => compareCodePoints(a.relative_path, b.relative_path));
  const fileRecords = allRecords.filter((record) => record.artifact_type !== "folder");
  const folderCount = allRecords.length - fileRecords.length;

  const snapshotHash = snapshotSemanticHash(fileRecords, input.sourceRevision);
  const packetRef = `urn:l9:meta-injector:${input.repositoryName}:${snapshotHash}`;

  const evidence: RepositoryModelEvidenceRecord[] = [];
  const artifacts: RepositoryModelArtifactRecord[] = [];
  const relationships: RepositoryModelEdgeRecord[] = [];
  const diagnostics: RepositoryModelDiagnostic[] = [];

  const languages = new Map<string, string>();       // language -> first evidencing path
  const packageManagers = new Map<string, string>();
  const ambiguousManifests = new Map<string, string>(); // manifest filename -> first evidencing path
  const workflows: string[] = [];
  const adrRefs: string[] = [];
  const governanceRefs: string[] = [];
  let unhashedCount = 0;

  for (const record of fileRecords) {
    const relativePath = record.relative_path;
    const hashed = record.content_hash !== null;
    if (!hashed) unhashedCount++;
    const contentHash = hashed ? `${SHA_PREFIX}${record.content_hash}` : UNKNOWN;
    const artifactId = repositoryModelArtifactId(repositoryId, relativePath);
    const recordConfidence = artifactConfidence(record.classification_confidence, hashed);

    const observation = makeEvidence({
      subjectId: artifactId,
      field: "artifact_type",
      evidenceClass: "observed",
      sourceRef: {
        source_path: relativePath,
        source_revision: input.sourceRevision,
        ...(hashed ? { content_hash: contentHash } : {}),
      },
      value: {
        artifact_type: record.artifact_type,
        ...(record.evidence_excerpt !== null ? { evidence_excerpt: record.evidence_excerpt } : {}),
      },
      confidence: recordConfidence,
    }, producerVersion, generatedAt);
    evidence.push(observation);

    const artifact: RepositoryModelArtifactRecord = {
      artifact_id: artifactId,
      repository_id: repositoryId,
      source_path: relativePath,
      artifact_type: record.artifact_type,
      content_hash: contentHash,
      capabilities: [],
      dependencies: [],
      evidence_refs: [observation.evidence_id],
      packet_ref: packetRef,
      confidence: recordConfidence,
    };
    const family = FAMILY_BY_INVENTORY_TYPE[record.artifact_type];
    if (family !== undefined) artifact.family = family;
    artifacts.push(artifact);

    // CONTAINS is the one relationship the inventory directly observed: this repository
    // contains this file. Nothing beyond that is asserted.
    const edgeIdentity = { source_id: repositoryId, target_id: artifactId, edge_type: "CONTAINS" };
    relationships.push({
      edge_id: stableId("edge", edgeIdentity),
      source_id: repositoryId,
      target_id: artifactId,
      edge_type: "CONTAINS",
      direction: "outbound",
      properties: {},
      evidence_refs: [observation.evidence_id],
      confidence: recordConfidence,
    });

    // Preserve every inventory unknown as an explicit diagnostic.
    for (const unknown of sortStrings(record.unknowns)) {
      diagnostics.push({
        code: "inventory-unknown",
        severity: "warning",
        message: `Inventory recorded an unknown for ${relativePath}: ${unknown}`,
        stage: OBSERVATION_STAGE,
        category: "observation",
        subject_id: artifactId,
        evidence_refs: [observation.evidence_id],
        details: { source_path: relativePath, unknown },
      });
    }

    const extension = (record.extension ?? "").toLowerCase();
    const language = LANGUAGE_BY_EXTENSION[extension];
    if (language !== undefined && !languages.has(language)) languages.set(language, relativePath);
    const manager = PACKAGE_MANAGER_BY_FILENAME[record.file_name];
    if (manager !== undefined && !packageManagers.has(manager)) packageManagers.set(manager, relativePath);
    if (AMBIGUOUS_PACKAGE_MANIFESTS.has(record.file_name) && !ambiguousManifests.has(record.file_name)) {
      ambiguousManifests.set(record.file_name, relativePath);
    }
    if (isWorkflowPath(relativePath)) workflows.push(relativePath);
    if (isAdrPath(relativePath)) adrRefs.push(relativePath);
    if (GOVERNANCE_FILENAMES.has(record.file_name)) governanceRefs.push(relativePath);
  }

  // Archive provenance. Members already exist as artifacts because acquisition
  // reported them as inventory records; what is added here is the ancestry that
  // binds each member to the archive it came from, and each nested archive to the
  // archive that contained it, all the way back to a physical source file.
  const emittedArtifactIds = new Set(artifacts.map((artifact) => artifact.artifact_id));
  const artifactIdFor = (sourcePath: string): string =>
    repositoryModelArtifactId(repositoryId, sourcePath);

  if (input.localSource) {
    const local = input.localSource;
    // A local source is not a Git checkout, and nothing here should be read as a
    // claim that one exists. The observation states what it observed.
    diagnostics.push({
      code: "local-source-observation",
      severity: "info",
      message:
        `This packet describes a local ${local.sourceKind} source observed read-only; ` +
        "no Git repository is claimed and the source revision uses a local-source scheme.",
      stage: OBSERVATION_STAGE,
      category: "observation",
      subject_id: repositoryId,
      details: {
        source_kind: local.sourceKind,
        source_revision: input.sourceRevision,
        archive_policy_version: local.archivePolicyVersion,
        archives_observed: local.archives.length,
        archive_members_observed: local.members.length,
      },
    });

    for (const archive of [...local.archives].sort((a, b) => compareCodePoints(a.sourcePath, b.sourcePath))) {
      if (archive.expanded) continue;
      // A held archive is still an observation: its bytes were hashed, its members
      // were not claimed, and the reason is explicit rather than an absence.
      diagnostics.push({
        code: "archive-held",
        severity: "warning",
        message:
          `Archive ${archive.sourcePath} was observed and hashed but not expanded; ` +
          "none of its members are claimed as observed.",
        stage: OBSERVATION_STAGE,
        category: "observation",
        subject_id: emittedArtifactIds.has(artifactIdFor(archive.sourcePath))
          ? artifactIdFor(archive.sourcePath)
          : repositoryId,
        details: {
          source_path: archive.sourcePath,
          archive_digest: archive.contentHash,
          nested_depth: archive.nestedDepth,
          hold_codes: sortStrings(archive.holdCodes),
        },
      });
    }

    const orderedMembers = [...local.members].sort((a, b) =>
      compareCodePoints(a.virtualSourcePath, b.virtualSourcePath));
    for (const member of orderedMembers) {
      const memberArtifactId = artifactIdFor(member.virtualSourcePath);
      const archiveArtifactId = artifactIdFor(member.parentArchivePath);
      if (!emittedArtifactIds.has(memberArtifactId) || !emittedArtifactIds.has(archiveArtifactId)) {
        // An edge whose endpoints are not both emitted would not resolve, so the
        // gap is reported instead of asserted.
        diagnostics.push({
          code: "archive-provenance-unresolved",
          severity: "warning",
          message:
            `Archive member ${member.virtualSourcePath} could not be linked to ` +
            `${member.parentArchivePath}; one endpoint is not an emitted artifact.`,
          stage: OBSERVATION_STAGE,
          category: "coverage",
          subject_id: repositoryId,
          details: { member_path: member.virtualSourcePath, archive_path: member.parentArchivePath },
        });
        continue;
      }
      // Member identity is the triple the contract requires: which archive, which
      // path inside it, and which exact bytes. It deliberately excludes anything
      // about where the member was staged.
      const memberId = stableId("member", {
        parent_archive_hash: member.parentArchiveHash,
        member_path: member.memberPath,
        member_content_hash: member.contentHash,
      });
      const provenance = makeEvidence({
        subjectId: memberArtifactId,
        field: "derived_from",
        evidenceClass: "observed",
        sourceRef: {
          source_path: member.virtualSourcePath,
          source_revision: input.sourceRevision,
          content_hash: member.contentHash,
        },
        value: {
          member_id: memberId,
          member_path: member.memberPath,
          nested_depth: member.nestedDepth,
          archive_digest: member.parentArchiveHash,
          archive_source_path: member.parentArchivePath,
        },
        confidence: DERIVED_CONFIDENCE,
      }, producerVersion, generatedAt);
      evidence.push(provenance);

      const derivedIdentity = {
        source_id: memberArtifactId,
        target_id: archiveArtifactId,
        edge_type: "DERIVED_FROM",
      };
      relationships.push({
        edge_id: stableId("edge", derivedIdentity),
        source_id: memberArtifactId,
        target_id: archiveArtifactId,
        edge_type: "DERIVED_FROM",
        direction: "outbound",
        properties: {
          member_id: memberId,
          member_path: member.memberPath,
          nested_depth: member.nestedDepth,
          archive_digest: member.parentArchiveHash,
        },
        evidence_refs: [provenance.evidence_id],
        confidence: DERIVED_CONFIDENCE,
      });
    }

    for (const diagnostic of [...local.diagnostics].sort((a, b) =>
      compareCodePoints(a.code, b.code)
      || compareCodePoints(a.sourcePath ?? "", b.sourcePath ?? "")
      || compareCodePoints(a.message, b.message))) {
      const subjectId = diagnostic.sourcePath !== undefined
        && emittedArtifactIds.has(artifactIdFor(diagnostic.sourcePath))
        ? artifactIdFor(diagnostic.sourcePath)
        : repositoryId;
      diagnostics.push({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        stage: OBSERVATION_STAGE,
        category: "observation",
        subject_id: subjectId,
        details: diagnostic.sourcePath !== undefined ? { source_path: diagnostic.sourcePath } : {},
      });
    }
  }

  // Repository-level facts derived from observed paths, each with its own evidence.
  const repositoryEvidenceRefs: string[] = [];
  const addDerived = (field: string, value: string, sourcePath: string): void => {
    const record = makeEvidence({
      subjectId: repositoryId,
      field,
      evidenceClass: "derived",
      sourceRef: { source_path: sourcePath, source_revision: input.sourceRevision },
      value,
      confidence: DERIVED_CONFIDENCE,
    }, producerVersion, generatedAt);
    evidence.push(record);
    repositoryEvidenceRefs.push(record.evidence_id);
  };
  for (const language of sortStrings(languages.keys())) addDerived("languages", language, languages.get(language) as string);
  for (const manager of sortStrings(packageManagers.keys())) addDerived("package_managers", manager, packageManagers.get(manager) as string);
  for (const workflow of sortStrings(workflows)) addDerived("workflows", workflow, workflow);
  for (const adr of sortStrings(adrRefs)) addDerived("adr_refs", adr, adr);
  for (const governance of sortStrings(governanceRefs)) addDerived("governance_refs", governance, governance);

  const artifactIds = artifacts.map((artifact) => artifact.artifact_id);
  const repository: RepositoryModelRepositoryRecord = {
    repository_id: repositoryId,
    name: input.repositoryName,
    source_revision: input.sourceRevision,
    packet_ref: packetRef,
    // Role classification is not derivable from inventory evidence alone. `unknown` is
    // the contract's explicit "not established" value, and it stays that way.
    primary_role: "unknown",
    secondary_roles: [],
    languages: sortStrings(languages.keys()),
    package_managers: sortStrings(packageManagers.keys()),
    entrypoints: [],
    workflows: sortStrings(workflows),
    adr_refs: sortStrings(adrRefs),
    governance_refs: sortStrings(governanceRefs),
    capability_ids: [],
    artifact_ids: artifactIds,
    upstream_repository_ids: [],
    downstream_repository_ids: [],
    unresolved_dependencies: [],
    owner_ids: [],
    evidence_refs: repositoryEvidenceRefs,
    confidence: REPOSITORY_CONFIDENCE,
  };

  // Report — rather than invent — everything the inventory could not establish.
  const unsupported: [string, string][] = [
    ["primary_role", "Repository role is not derivable from inventory evidence; primary_role stays 'unknown'."],
    ["capabilities", "No capability evidence is available to this producer; capabilities is empty by policy."],
    ["entrypoints", "Entrypoints require package-manifest interpretation beyond inventory observation."],
    ["owner_ids", "Ownership is not observable from inventory evidence."],
    ["dependencies", "Dependency edges require manifest interpretation beyond inventory observation."],
  ];
  for (const [field, message] of unsupported) {
    diagnostics.push({
      code: "unsupported-by-evidence",
      severity: "info",
      message,
      stage: OBSERVATION_STAGE,
      category: "coverage",
      subject_id: repositoryId,
      details: { field },
    });
  }
  // A shared manifest filename is observable; the manager behind it is not.
  for (const fileName of sortStrings(ambiguousManifests.keys())) {
    const sourcePath = ambiguousManifests.get(fileName) as string;
    diagnostics.push({
      code: "unsupported-by-evidence",
      severity: "info",
      message: `${sourcePath} does not identify a package manager by filename alone; manifest interpretation is required.`,
      stage: OBSERVATION_STAGE,
      category: "coverage",
      subject_id: repositoryId,
      details: { field: "package_managers", source_path: sourcePath },
    });
  }
  if (folderCount > 0) {
    diagnostics.push({
      code: "folders-not-emitted",
      severity: "info",
      message: `${folderCount} observed directories are not emitted as artifacts; only files carry artifact identity.`,
      stage: OBSERVATION_STAGE,
      category: "coverage",
      subject_id: repositoryId,
      details: { directory_count: folderCount },
    });
  }
  if (unhashedCount > 0) {
    diagnostics.push({
      code: "content-hash-unavailable",
      severity: "warning",
      message: `${unhashedCount} observed files have no content hash; their content_hash is the explicit Unknown value.`,
      stage: OBSERVATION_STAGE,
      category: "observation",
      subject_id: repositoryId,
      details: { artifact_count: unhashedCount, placeholder: UNKNOWN },
    });
  }
  for (const skipped of sortStrings(input.inventory.skippedDirs)) {
    diagnostics.push({
      code: "directory-unreadable",
      severity: "error",
      message: `A directory could not be read during observation; its subtree is absent from this packet: ${skipped}`,
      stage: OBSERVATION_STAGE,
      category: "coverage",
      subject_id: repositoryId,
      details: { directory: skipped },
    });
  }
  if (input.inventory.omittedPaths.length > 0) {
    diagnostics.push({
      code: "paths-omitted",
      severity: "info",
      message: `${input.inventory.omittedPaths.length} paths were excluded by the omit policy and are absent from this packet.`,
      stage: OBSERVATION_STAGE,
      category: "coverage",
      subject_id: repositoryId,
      details: { omitted_count: input.inventory.omittedPaths.length },
    });
  }

  const payload: RepositoryModelPayload = {
    repositories: [repository],
    artifacts,
    capabilities: [],
    relationships: relationships.sort((a, b) => compareCodePoints(a.edge_id, b.edge_id)),
    evidence: evidence.sort((a, b) => compareCodePoints(a.evidence_id, b.evidence_id)),
    diagnostics: diagnostics.sort((a, b) =>
      compareCodePoints(a.code, b.code)
      || compareCodePoints(a.subject_id ?? "", b.subject_id ?? "")
      || compareCodePoints(a.message, b.message)),
    // Already ordered by the interpretation pass; re-sorted here so the packet's
    // ordering guarantee does not depend on the producer of the input.
    //
    // The subject each assertion arrived with is preserved. Rewriting every
    // subject to the repository — which this builder used to do — collapsed
    // "this plan declares itself WIP" into "the repository declares itself WIP",
    // which is a different and much weaker claim. Validation below refuses an
    // assertion whose subject is neither an emitted repository nor an emitted
    // artifact, so preserving the subject cannot strand one.
    assertions: [...(input.interpretation?.assertions ?? [])]
      .sort((a, b) =>
        compareCodePoints(a.source_path, b.source_path)
        || a.source_range.start_line - b.source_range.start_line
        || compareCodePoints(a.predicate, b.predicate)
        || compareCodePoints(a.object, b.object)
        || compareCodePoints(a.extractor_id, b.extractor_id)
        || compareCodePoints(a.subject_id, b.subject_id)),
  };

  const shell = {
    packet_type: REPOSITORY_MODEL_PACKET_TYPE,
    packet_version: REPOSITORY_MODEL_PACKET_VERSION,
    subject: { repository_id: repositoryId },
    source_snapshot: { revision: input.sourceRevision, semantic_hash: snapshotHash },
    producer: { name: REPOSITORY_MODEL_PRODUCER_NAME, version: producerVersion },
    profile: input.localSource
      ? localSourceProfile(input.localSource)
      : { id: PROFILE_ID, version: PROFILE_VERSION, hash: PROFILE_HASH },
    schema_hash: SCHEMA_HASH,
    payload_refs: {},
    payload,
    // Bound into semantic identity only when interpretation ran, so a packet
    // built without it keeps the identity it had before the profile existed.
    ...(input.interpretation
      ? {
          interpretation_profile: {
            profile_id: input.interpretation.profile.profile_id,
            profile_version: input.interpretation.profile.profile_version,
            profile_hash: input.interpretation.profile.profile_hash,
            extractor_versions: input.interpretation.profile.extractor_versions,
          },
        }
      : {}),
  };
  // The consumer's semantic view is exactly these fields; `validation` and the
  // identity/volatile fields are excluded on both sides.
  const packetSemanticHash = semanticHash(shell);

  return {
    ...shell,
    packet_id: `packet:${packetSemanticHash.slice(SHA_PREFIX.length)}`,
    validation: { status: "passed", receipt_ref: RECEIPT_RELATIVE_PATH },
    semantic_hash: packetSemanticHash,
    // Informational content identity of the canonical payload bytes.
    artifact_hash: artifactHash(Buffer.from(canonicalJson(payload), "utf8")),
  };
}

// ───────────────────────────── producer-side validation ─────────────────────────────

function check(
  checkId: string,
  checkClass: RepositoryModelValidationCheck["check_class"],
  rule: string,
  ok: boolean,
  message: string,
  details: Record<string, CanonicalValue> = {},
): RepositoryModelValidationCheck {
  return {
    check_id: checkId, check_class: checkClass, rule,
    status: ok ? "passed" : "failed", message, evidence_refs: [], details,
  };
}

/**
 * Validate a packet against the contract this producer is responsible for, before it
 * ever reaches a consumer. Failures are reported, never repaired silently.
 */
export function validateRepositoryModelPacket(packet: RepositoryModelPacket): RepositoryModelValidationResult {
  const checks: RepositoryModelValidationCheck[] = [];

  checks.push(check("packet-type", "schema", "packet_type_is_repository_model",
    packet.packet_type === REPOSITORY_MODEL_PACKET_TYPE,
    `packet_type is ${packet.packet_type}`));
  checks.push(check("packet-version", "schema", "packet_version_is_supported",
    packet.packet_version === REPOSITORY_MODEL_PACKET_VERSION,
    `packet_version is ${packet.packet_version}`));
  checks.push(check("source-revision", "schema", "source_revision_is_explicit",
    packet.source_snapshot.revision.length > 0,
    "source snapshot revision is present"));
  checks.push(check("payload-present", "schema", "payload_is_resolved",
    packet.payload !== undefined && packet.payload !== null,
    "payload is inline and resolved"));

  const { payload } = packet;
  const recomputed = semanticHash({
    packet_type: packet.packet_type,
    packet_version: packet.packet_version,
    subject: packet.subject,
    source_snapshot: packet.source_snapshot,
    producer: packet.producer,
    profile: packet.profile,
    schema_hash: packet.schema_hash,
    payload_refs: packet.payload_refs,
    payload,
    // Mirrors the producer: the interpretation profile participates in identity
    // exactly when it is present, and an absent one is omitted rather than
    // hashed as null, so an inventory-only packet keeps its prior identity.
    ...(packet.interpretation_profile
      ? { interpretation_profile: packet.interpretation_profile }
      : {}),
  });
  checks.push(check("semantic-hash", "invariant", "semantic_hash_is_reproducible",
    recomputed === packet.semantic_hash,
    "declared semantic hash matches recomputation",
    { declared: packet.semantic_hash, calculated: recomputed }));
  checks.push(check("packet-id", "invariant", "packet_id_is_semantically_derived",
    packet.packet_id === `packet:${packet.semantic_hash.slice(SHA_PREFIX.length)}`,
    "packet id is derived from the semantic hash"));

  const absolute = payload.artifacts.filter((a) =>
    a.source_path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(a.source_path) || a.source_path.includes("\\"));
  checks.push(check("portable-paths", "invariant", "source_paths_are_repository_relative",
    absolute.length === 0,
    "every artifact source path is a portable repository-relative POSIX path",
    { offending_count: absolute.length }));

  const orderedArtifacts = payload.artifacts.every((a, i) =>
    i === 0 || compareCodePoints(payload.artifacts[i - 1].source_path, a.source_path) < 0);
  checks.push(check("stable-ordering", "invariant", "ordering_is_explicit_and_stable",
    orderedArtifacts,
    "artifacts are ordered by repository-relative path"));

  // An assertion without a resolvable, hashed span is not evidence of anything,
  // so the producer refuses to emit one rather than letting it reach a consumer.
  const unsupportedAssertions = payload.assertions.filter((assertion) =>
    !assertion.source_path
    || !/^sha256:[a-f0-9]{64}$/.test(assertion.source_content_hash)
    || assertion.source_range.start_line < 1
    || assertion.source_range.end_line < assertion.source_range.start_line
    || assertion.evidence_excerpt.length === 0
    || !assertion.extractor_id);
  checks.push(check("assertion-evidence", "evidence", "assertions_cite_exact_sources",
    unsupportedAssertions.length === 0,
    "every assertion cites an exact source span and a hashed source file",
    { unsupported_count: unsupportedAssertions.length }));

  // An assertion may attach to the repository as a whole or to one artifact in
  // it. Both are emitted records in this packet, and an assertion pointing at
  // neither would be a claim about something the consumer cannot resolve.
  const assertionSubjects = new Set<string>([
    ...payload.repositories.map((r) => r.repository_id),
    ...payload.artifacts.map((a) => a.artifact_id),
  ]);
  const orphanAssertions = payload.assertions.filter(
    (assertion) => !assertionSubjects.has(assertion.subject_id));
  checks.push(check("assertion-subject", "cross-reference", "assertions_resolve_to_a_subject",
    orphanAssertions.length === 0,
    "every assertion attaches to a repository or an artifact in this packet",
    { orphan_count: orphanAssertions.length }));

  const evidenceIds = new Set(payload.evidence.map((e) => e.evidence_id));
  const danglingEvidence: string[] = [];
  const collect = (refs: string[]): void => {
    for (const ref of refs) if (!evidenceIds.has(ref)) danglingEvidence.push(ref);
  };
  payload.artifacts.forEach((a) => collect(a.evidence_refs));
  payload.repositories.forEach((r) => collect(r.evidence_refs));
  payload.capabilities.forEach((c) => collect(c.evidence_refs));
  payload.relationships.forEach((e) => collect(e.evidence_refs));
  checks.push(check("evidence-resolves", "evidence", "evidence_refs_resolve",
    danglingEvidence.length === 0,
    "every evidence reference resolves to an emitted evidence record",
    { dangling_count: danglingEvidence.length }));

  const preservedUnknowns = payload.artifacts.filter((a) => a.content_hash === UNKNOWN).length;
  const declaredUnknowns = payload.diagnostics
    .filter((d) => d.code === "content-hash-unavailable")
    .reduce((total, d) => total + Number(d.details?.artifact_count ?? 0), 0);
  checks.push(check("unknowns-preserved", "evidence", "unknowns_are_explicit",
    preservedUnknowns === declaredUnknowns,
    "explicit Unknown content hashes are reported as diagnostics",
    { unknown_artifacts: preservedUnknowns }));

  const artifactIds = new Set(payload.artifacts.map((a) => a.artifact_id));
  const missingArtifacts = payload.repositories
    .flatMap((r) => r.artifact_ids)
    .filter((id) => !artifactIds.has(id));
  checks.push(check("artifact-cross-reference", "cross-reference", "repository_artifact_ids_resolve",
    missingArtifacts.length === 0,
    "every repository artifact reference resolves",
    { missing_count: missingArtifacts.length }));

  const repositoryIds = new Set(payload.repositories.map((r) => r.repository_id));
  const danglingEdges = payload.relationships.filter((edge) =>
    !(repositoryIds.has(edge.source_id) || artifactIds.has(edge.source_id))
    || !(repositoryIds.has(edge.target_id) || artifactIds.has(edge.target_id)));
  checks.push(check("edge-cross-reference", "cross-reference", "relationship_endpoints_resolve",
    danglingEdges.length === 0,
    "every relationship endpoint resolves to an emitted record",
    { dangling_count: danglingEdges.length }));

  const failed = checks.filter((c) => c.status !== "passed");
  return { status: failed.length === 0 ? "passed" : "failed", checks };
}

function buildReceipt(
  packet: RepositoryModelPacket,
  result: RepositoryModelValidationResult,
  producerVersion: string,
  generatedAt: string,
): RepositoryModelValidationReceipt {
  const byClass = (checkClass: RepositoryModelValidationCheck["check_class"]): RepositoryModelValidationCheck[] =>
    result.checks.filter((c) => c.check_class === checkClass);
  const view = {
    packet_type: RECEIPT_PACKET_TYPE,
    packet_version: RECEIPT_PACKET_VERSION,
    subject_packet_id: packet.packet_id,
    subject_semantic_hash: packet.semantic_hash,
    validator: { name: REPOSITORY_MODEL_PRODUCER_NAME, version: producerVersion },
    status: result.status,
    schema_results: byClass("schema"),
    invariant_results: byClass("invariant"),
    evidence_results: byClass("evidence"),
    cross_reference_results: byClass("cross-reference"),
  };
  const digest = semanticHash(view);
  return {
    ...view,
    receipt_id: `receipt:${digest.slice(SHA_PREFIX.length)}`,
    created_at: generatedAt,
    semantic_hash: digest,
  };
}

// ───────────────────────────── emitter ─────────────────────────────

function writeCanonicalFile(absolutePath: string, value: unknown): { content_hash: string; size_bytes: number } {
  // The consumer reads canonical JSON with a single trailing newline.
  const content = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
  return { content_hash: artifactHash(content), size_bytes: content.length };
}

/**
 * Write a validated packet as a canonical packet-bundle directory:
 * `packet.json`, `receipts/validation-receipt.json`, and a hash-bound `manifest.json`.
 * Refuses to emit a packet that fails producer-side validation.
 */
export function emitRepositoryModelBundle(
  packet: RepositoryModelPacket,
  options: { outDir: string; producerVersion?: string; generatedAt?: string },
): RepositoryModelEmitResult {
  const generatedAt = options.generatedAt ?? DEFAULT_GENERATED_AT;
  const producerVersion = options.producerVersion ?? packet.producer.version;
  const result = validateRepositoryModelPacket(packet);
  if (result.status !== "passed") {
    const failures = result.checks.filter((c) => c.status !== "passed").map((c) => `${c.check_id}: ${c.message}`);
    throw new Error(`repository-model: refusing to emit a packet that failed producer validation:\n  - ${failures.join("\n  - ")}`);
  }

  const bundleRoot = path.resolve(options.outDir);
  if (fs.existsSync(bundleRoot) && fs.readdirSync(bundleRoot).length > 0) {
    throw new Error(`repository-model: packet bundles are immutable; refusing to write into a non-empty directory: ${bundleRoot}`);
  }
  fs.mkdirSync(bundleRoot, { recursive: true });

  const receipt = buildReceipt(packet, result, producerVersion, generatedAt);
  const packetPath = path.join(bundleRoot, PACKET_RELATIVE_PATH);
  const receiptPath = path.join(bundleRoot, RECEIPT_RELATIVE_PATH);
  const packetFile = writeCanonicalFile(packetPath, packet);
  const receiptFile = writeCanonicalFile(receiptPath, receipt);

  const files = [
    { path: PACKET_RELATIVE_PATH, media_type: JSON_MEDIA_TYPE, ...packetFile },
    { path: RECEIPT_RELATIVE_PATH, media_type: JSON_MEDIA_TYPE, ...receiptFile },
  ].sort((a, b) => compareCodePoints(a.path, b.path));

  const manifestPath = path.join(bundleRoot, MANIFEST_RELATIVE_PATH);
  writeCanonicalFile(manifestPath, {
    manifest_version: MANIFEST_VERSION,
    packet_id: packet.packet_id,
    packet_type: packet.packet_type,
    packet_version: packet.packet_version,
    semantic_hash: packet.semantic_hash,
    // The consumer recomputes this over the file entries alone.
    artifact_hash: semanticHash(files),
    files,
    created_at: generatedAt,
  });

  return {
    bundleRoot,
    packetPath,
    receiptPath,
    manifestPath,
    packetId: packet.packet_id,
    semanticHash: packet.semantic_hash,
    files,
  };
}

// ───────────────────────────── observation entrypoint ─────────────────────────────

/**
 * Observe a repository with the existing inventory engine and build its Repository
 * Model Packet. The observation is read-only: inventory runs in dry-run mode and its
 * own manifests are written to a temporary directory that is removed afterwards, so
 * the observed repository is never mutated.
 */
export function observeRepositoryModel(input: RepositoryModelObservationInput): RepositoryModelPacket {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "l9-repository-model-"));
  try {
    const inventory = inventoryTree({
      root: input.root,
      outDir: path.join(scratch, "inventory"),
      dryRun: true,
      injectHeaders: false,
      writeSidecars: false,
      folderSidecars: false,
      sourceSystem: "local",
      now: input.generatedAt ?? DEFAULT_GENERATED_AT,
      ...(input.ignore !== undefined ? { ignore: input.ignore } : {}),
      ...(input.omitPatterns !== undefined ? { omitPatterns: input.omitPatterns } : {}),
      ...(input.omitFile !== undefined ? { omitFile: input.omitFile } : {}),
      ...(input.hashMaxBytes !== undefined ? { hashMaxBytes: input.hashMaxBytes } : {}),
    });
    const interpretation =
      input.interpret === false
        ? undefined
        : interpretRepository({
            root: input.root,
            subjectId: `repo:${input.repositoryName}`,
            inventory,
            extractors: defaultExtractors(),
          });
    return buildRepositoryModelPacket({
      inventory,
      ...(interpretation ? { interpretation } : {}),
      repositoryName: input.repositoryName,
      sourceRevision: input.sourceRevision,
      producerVersion: input.producerVersion,
      ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
