export const UNKNOWN = "Unknown" as const;
export type Unknown = typeof UNKNOWN;

export type ArtifactType =
  | "skill" | "playbook" | "kernel" | "context" | "prompt"
  | "doctrine" | "test" | "script" | "source" | "unknown";

export type McpPrimitive = "tool" | "resource" | "prompt" | "none";

export type ArtifactFamily =
  | "auditor" | "compiler" | "meta_kernel_forge" | "builder"
  | "planner" | "research" | "domain_agent" | "legal" | "Unknown";

export type SharingScope = "private" | "shared" | "agnostic";

export interface PrimitiveTaxonomyEntry {
  type: ArtifactType;
  meaning: string;
  callable: boolean;
  mcpPrimitive: McpPrimitive;
  injectable: boolean;
}

export const PRIMITIVE_TAXONOMY: Record<string, PrimitiveTaxonomyEntry> = {
  skill:    { type: "skill",    meaning: "atomic capability",               callable: true,  mcpPrimitive: "tool",     injectable: true  },
  playbook: { type: "playbook", meaning: "multi-step orchestration",        callable: true,  mcpPrimitive: "tool",     injectable: true  },
  kernel:   { type: "kernel",   meaning: "sandboxed execution or rule set", callable: true,  mcpPrimitive: "tool",     injectable: true  },
  context:  { type: "context",  meaning: "retrievable knowledge",           callable: true,  mcpPrimitive: "resource", injectable: true  },
  prompt:   { type: "prompt",   meaning: "parameterized prompt contract",   callable: true,  mcpPrimitive: "prompt",   injectable: true  },
  doctrine: { type: "doctrine", meaning: "governance artifact",             callable: false, mcpPrimitive: "none",     injectable: true  },
  test:     { type: "test",     meaning: "test artifact",                   callable: false, mcpPrimitive: "none",     injectable: false },
  script:   { type: "script",   meaning: "script artifact",                 callable: false, mcpPrimitive: "none",     injectable: false },
  source:   { type: "source",   meaning: "source or config file",           callable: false, mcpPrimitive: "resource", injectable: true  },
  unknown:  { type: "unknown",  meaning: "unclassified",                    callable: false, mcpPrimitive: "none",     injectable: false },
};

export interface ExtractedFields {
  role: string | Unknown;
  objective: string | Unknown;
  constraints: string[] | Unknown;
  validationGates: string[] | Unknown;
  stopConditions: string[] | Unknown;
  phaseModel: string[] | Unknown;
  inputVariables: string[] | Unknown;
  outputFormat: string | Unknown;
  modelTarget: string | Unknown;
}

export type HeaderConvention = "full-yaml" | "bare-yaml" | "prose-table" | "none";
export type BodyStructure = "sections" | "flat" | "table-driven" | "unknown";

export interface ScanEntry {
  sourcePath: string;
  fileName: string;
  sizeBytes: number;
  headerConvention: HeaderConvention;
  bodyStructure: BodyStructure;
  hasExistingFrontMatter: boolean;
}

export interface ClassifyResult {
  artifactType: ArtifactType;
  family: ArtifactFamily;
  signals: string[];
  confidence: "high" | "medium" | "low";
}

export interface BaseHeader {
  id: string;
  title: string;
  artifact_type: ArtifactType;
  mcp_primitive: McpPrimitive;
  callable: boolean;
  retrievable: boolean;
  injectable: boolean;
  namespace: string;
  sharing_scope: SharingScope;
  source_path: string;
  content_hash: string;
  token_cost_estimate: number;
  authority: string;
  created_or_detected_at: string;
}

export interface ExecutableRetrievalMeta extends BaseHeader {
  family: ArtifactFamily;
  description: string | Unknown;
  activation_signals: string[] | Unknown;
  input_contract: string | Unknown;
  output_contract: string | Unknown;
  validation_gates: string[] | Unknown;
  stop_conditions: string[] | Unknown;
}

export interface PromptMeta extends ExecutableRetrievalMeta {
  role: string | Unknown;
  objective: string | Unknown;
  input_variables: string[] | Unknown;
  output_format: string | Unknown;
  model_target: string | Unknown;
  constraints: string[] | Unknown;
  phase_model: string[] | Unknown;
}

export interface DoctrineMeta extends BaseHeader {
  governs: string | Unknown;
  decision_drivers: string[] | Unknown;
  applies_to_domains: string[] | Unknown;
}

export interface ArtifactMeta extends BaseHeader {
  owner: string | Unknown;
}

export type NormalizedMeta = ExecutableRetrievalMeta | PromptMeta | DoctrineMeta | ArtifactMeta;

// The identity block every NormalizedMeta variant shares, with the runtime type
// each field must carry. Single-sourced here so coerceNormalizedMeta and the
// interfaces above cannot drift apart.
const BASE_HEADER_TYPES: ReadonlyArray<[keyof BaseHeader, "string" | "boolean" | "number"]> = [
  ["id", "string"], ["title", "string"], ["artifact_type", "string"],
  ["mcp_primitive", "string"], ["callable", "boolean"], ["retrievable", "boolean"],
  ["injectable", "boolean"], ["namespace", "string"], ["sharing_scope", "string"],
  ["source_path", "string"], ["content_hash", "string"],
  ["token_cost_estimate", "number"], ["authority", "string"],
  ["created_or_detected_at", "string"],
];

/**
 * The metadata-record shape exchanged across the reconcile edge: a typed producer
 * (buildMeta → NormalizedMeta) and the untyped consumer (reconcileFields) now name
 * the same contract instead of each side spelling `Record<string, unknown>` inline
 * (finding ICC-005). Widening a NormalizedMeta to a MetaRecord is lossless.
 */
export type MetaRecord = Record<string, unknown>;

/**
 * Widen a known object type to a generic key/value bag. Centralizes the one
 * `as unknown as Record` escape hatch so read-paths that only need to index a
 * field by name don't each hand-roll a double-cast (finding QTE-005 / CWE-704).
 */
export function asRecord(value: object): MetaRecord {
  return value as unknown as MetaRecord;
}

// BaseHeader fields buildMeta emits as a non-string type. A hand-edited or quoted
// header parses these back as strings ("12", "false"); normalizeMetaRecord coerces
// them so the reconcile edge compares like-for-like against the typed producer
// (finding ICC-005). Machine-written headers are already unquoted, so this is a
// no-op on the tool's own output — idempotency is preserved.
const NUMERIC_HEADER_FIELDS = ["token_cost_estimate"] as const;
const BOOLEAN_HEADER_FIELDS = ["callable", "retrievable", "injectable"] as const;

/**
 * Coerce the well-known typed BaseHeader fields of a parsed existing-meta record to
 * the exact runtime types buildMeta emits (numbers, booleans), leaving every other
 * key untouched. Returns a new record; never throws.
 */
export function normalizeMetaRecord(rec: MetaRecord): MetaRecord {
  const out: MetaRecord = { ...rec };
  for (const f of NUMERIC_HEADER_FIELDS) {
    const v = out[f];
    if (typeof v === "string" && /^-?\d+$/.test(v.trim())) out[f] = parseInt(v.trim(), 10);
  }
  for (const f of BOOLEAN_HEADER_FIELDS) {
    const v = out[f];
    if (v === "true") out[f] = true;
    else if (v === "false") out[f] = false;
  }
  return out;
}

/**
 * Narrow a generic key/value bag into a NormalizedMeta, validating the shared
 * BaseHeader identity block FIRST. Replaces the blind `bag as unknown as
 * NormalizedMeta` double-casts (finding QTE-005 / CWE-704): a bag whose identity
 * fields have drifted (missing, or the wrong runtime type) throws here at the
 * boundary instead of silently compiling and surfacing as a malformed header
 * downstream. Extra keys (schema-specific / inventory-specific) ride along
 * untouched — the injector serializes meta as a generic bag.
 *
 * Use this only where the bag is meant to be a full artifact header. The
 * schema-driven inventory path deliberately emits operator-defined field sets
 * that need not include the identity block, so it keeps its own documented
 * boundary adapter rather than routing through this guard.
 */
export function coerceNormalizedMeta(bag: Record<string, unknown>): NormalizedMeta {
  for (const [key, expected] of BASE_HEADER_TYPES) {
    const actual = typeof bag[key];
    if (actual !== expected) {
      throw new Error(
        `coerceNormalizedMeta: identity field '${key}' must be ${expected}, got ${bag[key] === undefined ? "undefined" : actual}`
      );
    }
  }
  return bag as unknown as NormalizedMeta;
}

/** The five reconciliation actions. Canonical home for the field-diff contract. */
export type ReconcileAction = "add" | "revise" | "append-union" | "keep" | "replace";

export interface FieldDiff {
  field: string;
  action: ReconcileAction;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
}

export interface InjectionRecord {
  sourcePath: string;
  originalBodyHash: string;
  postInjectionBodyHash: string;
  bodyPreserved: boolean;
  headerInjected: boolean;
  injectionStrategy?: string;
  sidecarPath?: string;
  dryRunDiffPath?: string;
  injectLogPath?: string;
  meta: NormalizedMeta;
}

export interface VerifyResult {
  sourcePath: string;
  yamlValid: boolean;
  bodyPreserved: boolean;
  taxonomyValid: boolean;
  promptSchemaComplete: boolean;
  sharingScopeValid: boolean;
  issues: string[];
}

export interface PipelineConfig {
  root: string;
  glob: string;
  dryRun: boolean;
  outDir: string;
  namespace: string;
  authority: string;
  nearDupThreshold: number;
  hashPrefixLength: number;
  indexDir: string;
  /** Optional per-glob namespace overrides (e.g. `plastos/** → plastos`). */
  namespaceGlobs?: Array<{ glob: string; namespace: string }>;
  verbose: boolean;
  llmEnabled: boolean;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  normalizeFilenames: boolean;
}

// ---------------------------------------------------------------------------
// Metadata v3 — nine-plane schema
// ---------------------------------------------------------------------------

export const META_V3_SCHEMA_VERSION = 3 as const;
export type MetaV3SchemaVersion = typeof META_V3_SCHEMA_VERSION;

export type LifecycleStatus = "active" | "deprecated" | "review";

export const META_V3_PLANES = [
  "identity",
  "taxonomy",
  "placement",
  "routing",
  "provenance",
  "governance",
  "economics",
  "assurance",
  "lineage",
] as const;
export type MetaV3Plane = (typeof META_V3_PLANES)[number];

export interface IdentityPlane {
  id: string;
  title: string;
  artifact_type: ArtifactType;
  content_hash: string;
  version: string | Unknown;
}

export interface TaxonomyPlane {
  family: ArtifactFamily;
  mcp_primitive: McpPrimitive;
  callable: boolean;
  retrievable: boolean;
  injectable: boolean;
}

export interface PlacementPlane {
  namespace: string;
  source_path: string;
  output_path: string | Unknown;
  layer: string | Unknown;
  sharing_scope: SharingScope;
}

export interface RoutingPlane {
  advisory: true;
  activation_signals: string[] | Unknown;
  input_contract: string | Unknown;
  output_contract: string | Unknown;
  targets: string[] | Unknown;
}

export interface ProvenancePlane {
  created_or_detected_at: string;
  generated_by: string | Unknown;
  upstream: string[] | Unknown;
  snapshot_hash: string | Unknown;
}

export interface GovernancePlane {
  authority: string;
  status: LifecycleStatus;
  owner: string | Unknown;
  decision_drivers: string[] | Unknown;
}

export interface EconomicsPlane {
  token_cost_estimate: number;
  size_bytes: number | Unknown;
}

export interface AssurancePlane {
  validation_gates: string[] | Unknown;
  stop_conditions: string[] | Unknown;
}

export interface LineagePlane {
  schema_version: MetaV3SchemaVersion;
  supersedes: string | Unknown;
  chain: string[] | Unknown;
}

export interface MetaV3 {
  identity: IdentityPlane;
  taxonomy: TaxonomyPlane;
  placement: PlacementPlane;
  routing: RoutingPlane;
  provenance: ProvenancePlane;
  governance: GovernancePlane;
  economics: EconomicsPlane;
  assurance: AssurancePlane;
  lineage: LineagePlane;
}

// ---------------------------------------------------------------------------
// Semantic artifact classification (17 classes)
// ---------------------------------------------------------------------------

export type SemanticArtifactClass =
  | "source_module"
  | "type_definitions"
  | "test_suite"
  | "schema"
  | "configuration"
  | "documentation"
  | "contract"
  | "build_manifest"
  | "build_artifact"
  | "fixture"
  | "script"
  | "pipeline"
  | "prompt_template"
  | "skill_definition"
  | "governance_doctrine"
  | "changelog"
  | "unknown";

export type ClassConfidence = "high" | "medium" | "low";

export interface ArtifactClassification {
  artifactClass: SemanticArtifactClass;
  confidence: ClassConfidence;
  signals: string[];
}

// ---------------------------------------------------------------------------
// Canonical type guard — single authoritative isPromptMeta.
// Import this wherever artifact_type === "prompt" must be narrowed;
// do NOT redefine locally in compiler.ts, pipeline.ts, or verify.ts.
// ---------------------------------------------------------------------------
export function isPromptMeta(m: NormalizedMeta | unknown): m is PromptMeta {
  return typeof m === "object" && m !== null &&
    (m as { artifact_type?: string }).artifact_type === "prompt";
}
