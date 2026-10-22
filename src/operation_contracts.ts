/**
 * Canonical operation and repository-authority contracts.
 *
 * This module is deliberately independent from the mutation engine. It locks the
 * public vocabulary used by the CLI, composite Action, future check/apply
 * orchestration, and consumer authority files without creating a second runtime.
 */

import type { DiscoverySummary } from "./discovery_contracts";

export const OPERATION_MODES = ["inventory", "check", "apply", "skills"] as const;
export type OperationMode = (typeof OPERATION_MODES)[number];

export const LEGACY_OPERATION_ALIASES = {
  pipeline: "apply",
} as const;
export type LegacyOperationMode = keyof typeof LEGACY_OPERATION_ALIASES;

export interface OperationModeResolution {
  requested: string;
  mode: OperationMode;
  deprecatedAlias?: LegacyOperationMode;
  warning?: string;
}

export const META_AUTHORITY_SCHEMA = "l9.meta-authority/v1" as const;
export const META_AUTHORITY_SCHEMA_V2 = "l9.meta-authority/v2" as const;
export type MetaAuthoritySchema =
  | typeof META_AUTHORITY_SCHEMA
  | typeof META_AUTHORITY_SCHEMA_V2;

export const SEMANTIC_LEDGER_ID_RE = /^l9\.[a-z0-9-]+\/[a-z0-9-]+@[0-9]+$/;
export const SEMANTIC_LEDGER_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
export const SEMANTIC_REVISION_RE = /^[0-9a-f]{40}$/;
export const PRODUCT_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
export const PRODUCT_OWNER_RE = /^[^/\s]+\/[^/\s]+$/;

export const REQUIRED_SEMANTIC_LEDGERS = [
  "l9.authority-model/global@1",
  "l9.artifact-model/global@1",
  "l9.vocabulary/global@1",
  "l9.identity-model/global@1",
  "l9.product-kinds/global@1",
] as const;

export type ProductKindDeclaration = "node" | "dependency" | "Unknown";
export type SemanticAdmissionState = "candidate" | "admitted" | "Unknown";

export interface SemanticFoundationBinding {
  repository: string;
  revision: string;
  release: string;
  admission: SemanticAdmissionState;
  ledgers: Record<string, string>;
}

export interface ProductDeclaration {
  id: string;
  owner: string;
  kind: ProductKindDeclaration;
  archetype: string;
}

export type HeaderIdentitySource = "semantic_binding" | "operator" | "folder";

export interface HeaderIdentityRequest {
  authority?: string;
  namespace?: string;
  unboundNamespaceDefault?: string;
  /** Inventory may stamp Unknown when unbound; pipeline/CLI require an operator value. Default true. */
  requireAuthorityWhenUnbound?: boolean;
}

export interface HeaderIdentityResolution {
  authority: string;
  namespace: string;
  source: HeaderIdentitySource;
  conflicts: AuthorityConflict[];
}

export type MetadataCarrier =
  | "hard_skip"
  | "inventory_only"
  | "central_manifest"
  | "inline_managed";

export type AuthorityLegacyPolicy = "forbidden" | "migration_only";

export interface AuthorityWriter {
  repository: string;
  ref: string;
}

export interface AuthorityConfig {
  schema: MetaAuthoritySchema;
  writer: AuthorityWriter;
  default_carrier: "central_manifest" | "inline_managed";
  legacy_writers: AuthorityLegacyPolicy;
  inline_allow: string[];
  validation_commands?: string[];
  semantic_foundation?: SemanticFoundationBinding;
  product?: ProductDeclaration;
}

export type AuthorityConflictCode =
  | "META_AUTHORITY_FILE_MISSING"
  | "META_AUTHORITY_SCHEMA_UNSUPPORTED"
  | "META_AUTHORITY_CONFIG_INVALID"
  | "META_AUTHORITY_SCAN_INCOMPLETE"
  | "META_AUTHORITY_WRITER_MISMATCH"
  | "META_AUTHORITY_CONFLICT"
  | "META_LEGACY_METADATA_PRESENT"
  | "META_SEMANTIC_BINDING_INVALID"
  | "META_AUTHORITY_IDENTITY_MISMATCH";

export interface AuthorityConflict {
  code: AuthorityConflictCode;
  message: string;
  path?: string;
  evidence?: string[];
}

/**
 * Non-blocking authority findings.
 *
 * A repository that once carried L9 metadata keeps that text in its history and in its
 * prose. That is evidence, not a competing authority: it is reported here so adoption
 * never depends on an operator deleting historical markers from their own sources.
 * `META_LEGACY_WRITER_MIGRATION` is the `migration_only` allowance for a dormant legacy
 * writer artifact — recorded, visible, and deliberately not a conflict.
 */
export type AuthorityNoticeCode =
  | "META_LEGACY_METADATA_PRESENT"
  | "META_LEGACY_WRITER_MIGRATION";

export interface AuthorityNotice {
  code: AuthorityNoticeCode;
  message: string;
  path?: string;
  evidence?: string[];
}

export interface CarrierDecision {
  path: string;
  carrier: MetadataCarrier;
  reason: string;
  authorityRule?: string;
  /**
   * The repository explicitly authorized inline metadata for this path, but its existing
   * frontmatter is malformed and cannot be rewritten without destroying bytes the
   * injector is required to preserve. The operation holds rather than guessing.
   */
  unsatisfiedInlineAuthorization?: boolean;
}

export type CheckDriftKind = "missing" | "stale" | "extra" | "conflict" | "unsupported";

export interface CheckDrift {
  path: string;
  kind: CheckDriftKind;
  message: string;
  expectedHash?: string;
  actualHash?: string;
}

export interface CheckResult {
  passed: boolean;
  repositoryMutated: false;
  scanned: number;
  planned: number;
  drift: CheckDrift[];
  authorityConflicts: AuthorityConflict[];
  /** Non-blocking authority findings, preserved so evidence is never silently dropped. */
  authorityNotices: AuthorityNotice[];
  carrierDecisions: CarrierDecision[];
  discovery: DiscoverySummary;
}


export interface ApplyTransactionSummary {
  transactionId: string | null;
  plannedWrites: number;
  committedWrites: number;
  rolledBack: boolean;
  recoveredTransactions: string[];
  finalizedTransactions: string[];
}

export interface ApplyResult {
  passed: boolean;
  repositoryMutated: boolean;
  scanned: number;
  planned: number;
  changed: number;
  inlineChanged: string[];
  metadataIndexChanged: boolean;
  authorityConflicts: AuthorityConflict[];
  /** Non-blocking authority findings, preserved so evidence is never silently dropped. */
  authorityNotices: AuthorityNotice[];
  carrierDecisions: CarrierDecision[];
  discovery: DiscoverySummary;
  transaction: ApplyTransactionSummary;
}

export interface OperationResult {
  mode: OperationMode;
  passed: boolean;
  authorityRequired: boolean;
  authorityResolved: boolean;
  repositoryMutated: boolean;
  warnings: string[];
  check?: CheckResult;
  apply?: ApplyResult;
}

export function resolveOperationMode(input: string): OperationModeResolution {
  const requested = input.trim();
  if ((OPERATION_MODES as readonly string[]).includes(requested)) {
    return { requested, mode: requested as OperationMode };
  }
  if (requested in LEGACY_OPERATION_ALIASES) {
    const alias = requested as LegacyOperationMode;
    return {
      requested,
      mode: LEGACY_OPERATION_ALIASES[alias],
      deprecatedAlias: alias,
      warning: `operation mode '${alias}' is deprecated; use '${LEGACY_OPERATION_ALIASES[alias]}'`,
    };
  }
  throw new Error(
    `unsupported operation mode '${requested || "<empty>"}'; expected one of ${OPERATION_MODES.join(", ")}`,
  );
}

export function operationRequiresAuthority(mode: OperationMode): boolean {
  return mode === "check" || mode === "apply" || mode === "skills";
}

export function isSupportedAuthoritySchema(schema: unknown): schema is MetaAuthoritySchema {
  return schema === META_AUTHORITY_SCHEMA || schema === META_AUTHORITY_SCHEMA_V2;
}

export function isProductKindDeclaration(value: unknown): value is ProductKindDeclaration {
  return value === "node" || value === "dependency" || value === "Unknown";
}

export function kindBoundLedgerId(kind: ProductKindDeclaration): string | undefined {
  if (kind === "dependency") return "l9.dependency-archetypes/global@1";
  if (kind === "node") return "l9.node-archetypes/global@1";
  return undefined;
}

export function archetypePrefixForKind(kind: ProductKindDeclaration): string | undefined {
  if (kind === "dependency") return "l9.dependency-archetype/";
  if (kind === "node") return "l9.node-archetype/";
  return undefined;
}

export function isSemanticFoundationBinding(value: unknown): value is SemanticFoundationBinding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, ["repository", "revision", "release", "admission", "ledgers"])) return false;
  if (typeof candidate.repository !== "string" || !PRODUCT_OWNER_RE.test(candidate.repository)) return false;
  if (typeof candidate.revision !== "string" || !SEMANTIC_REVISION_RE.test(candidate.revision)) return false;
  if (typeof candidate.release !== "string" || candidate.release.trim().length === 0) return false;
  if (candidate.admission !== "candidate" && candidate.admission !== "admitted" && candidate.admission !== "Unknown") {
    return false;
  }
  if (typeof candidate.ledgers !== "object" || candidate.ledgers === null || Array.isArray(candidate.ledgers)) {
    return false;
  }
  const ledgers = candidate.ledgers as Record<string, unknown>;
  const keys = Object.keys(ledgers);
  if (keys.length === 0) return false;
  for (const key of keys) {
    if (!SEMANTIC_LEDGER_ID_RE.test(key)) return false;
    const digest = ledgers[key];
    if (typeof digest !== "string" || !SEMANTIC_LEDGER_DIGEST_RE.test(digest)) return false;
  }
  return true;
}

export function isProductDeclaration(value: unknown): value is ProductDeclaration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, ["id", "owner", "kind", "archetype"])) return false;
  if (typeof candidate.id !== "string" || !PRODUCT_ID_RE.test(candidate.id)) return false;
  if (typeof candidate.owner !== "string" || !PRODUCT_OWNER_RE.test(candidate.owner)) return false;
  if (!isProductKindDeclaration(candidate.kind)) return false;
  if (typeof candidate.archetype !== "string" || candidate.archetype.trim().length === 0) return false;
  if (candidate.archetype !== "Unknown") {
    const prefix = archetypePrefixForKind(candidate.kind);
    if (!prefix || !candidate.archetype.startsWith(prefix)) return false;
    if (!SEMANTIC_LEDGER_ID_RE.test(candidate.archetype)) return false;
  } else if (candidate.kind !== "Unknown") {
    return false;
  }
  return true;
}

export function semanticBindingErrors(config: AuthorityConfig): string[] {
  const errors: string[] = [];
  if (config.schema !== META_AUTHORITY_SCHEMA_V2) return errors;
  if (!config.semantic_foundation || !config.product) {
    errors.push("l9.meta-authority/v2 requires semantic_foundation and product");
    return errors;
  }
  const { semantic_foundation: binding, product } = config;
  for (const id of REQUIRED_SEMANTIC_LEDGERS) {
    if (!(id in binding.ledgers)) errors.push(`missing required ledger ${id}`);
  }
  const bound = kindBoundLedgerId(product.kind);
  if (bound && !(bound in binding.ledgers)) errors.push(`missing kind-bound ledger ${bound}`);
  return errors;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string" && item.trim().length > 0)
    && new Set(value).size === value.length;
}

/**
 * Authority globs are security-sensitive repository-relative POSIX patterns.
 * They are intentionally positive-only: negation and path normalization tricks
 * are rejected rather than interpreted.
 */
export function isSafeAuthorityPathPattern(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  if (value.trim() !== value) return false;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("!")) return false;
  if (value.includes("\\") || value.includes("//") || /[\u0000-\u001F\u007F]/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

export function isAuthorityConfig(value: unknown): value is AuthorityConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const v1Keys = [
    "schema", "writer", "default_carrier", "legacy_writers", "inline_allow", "validation_commands",
  ];
  const v2Keys = [...v1Keys, "semantic_foundation", "product"];
  if (!isSupportedAuthoritySchema(candidate.schema)) return false;
  const allowed = candidate.schema === META_AUTHORITY_SCHEMA_V2 ? v2Keys : v1Keys;
  if (!hasOnlyKeys(candidate, allowed)) return false;
  if (typeof candidate.writer !== "object" || candidate.writer === null || Array.isArray(candidate.writer)) return false;
  const writer = candidate.writer as Record<string, unknown>;
  if (!hasOnlyKeys(writer, ["repository", "ref"])) return false;
  if (typeof writer.repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(writer.repository)) return false;
  if (typeof writer.ref !== "string" || writer.ref.trim().length === 0) return false;
  if (candidate.default_carrier !== "central_manifest" && candidate.default_carrier !== "inline_managed") return false;
  if (candidate.legacy_writers !== "forbidden" && candidate.legacy_writers !== "migration_only") return false;
  if (!isStringArray(candidate.inline_allow) || !candidate.inline_allow.every(isSafeAuthorityPathPattern)) return false;
  if (candidate.validation_commands !== undefined && !isStringArray(candidate.validation_commands)) return false;
  if (candidate.schema === META_AUTHORITY_SCHEMA) {
    return candidate.semantic_foundation === undefined && candidate.product === undefined;
  }
  if (!isSemanticFoundationBinding(candidate.semantic_foundation)) return false;
  if (!isProductDeclaration(candidate.product)) return false;
  const config = candidate as unknown as AuthorityConfig;
  return semanticBindingErrors(config).length === 0;
}

export function assertAuthorityForOperation(
  mode: OperationMode,
  authority: AuthorityConfig | undefined,
): AuthorityConfig | undefined {
  if (authority !== undefined && !isAuthorityConfig(authority)) {
    throw new Error("invalid repository metadata authority configuration");
  }
  if (operationRequiresAuthority(mode) && authority === undefined) {
    throw new Error(`operation mode '${mode}' requires .l9/meta-authority.yaml`);
  }
  return authority;
}
