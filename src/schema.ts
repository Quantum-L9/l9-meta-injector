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

export interface FieldDiff {
  field: string;
  action: "add" | "revise" | "append-union" | "keep" | "replace";
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
  verbose: boolean;
  llmEnabled: boolean;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  normalizeFilenames: boolean;
}
