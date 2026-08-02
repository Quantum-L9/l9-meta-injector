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
export type MetaAuthoritySchema = typeof META_AUTHORITY_SCHEMA;

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
}

export type AuthorityConflictCode =
  | "META_AUTHORITY_FILE_MISSING"
  | "META_AUTHORITY_SCHEMA_UNSUPPORTED"
  | "META_AUTHORITY_CONFIG_INVALID"
  | "META_AUTHORITY_SCAN_INCOMPLETE"
  | "META_AUTHORITY_WRITER_MISMATCH"
  | "META_AUTHORITY_CONFLICT"
  | "META_LEGACY_METADATA_PRESENT";

export interface AuthorityConflict {
  code: AuthorityConflictCode;
  message: string;
  path?: string;
  evidence?: string[];
}

export interface CarrierDecision {
  path: string;
  carrier: MetadataCarrier;
  reason: string;
  authorityRule?: string;
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
  return mode === "check" || mode === "apply";
}

export function isSupportedAuthoritySchema(schema: unknown): schema is MetaAuthoritySchema {
  return schema === META_AUTHORITY_SCHEMA;
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
  if (!hasOnlyKeys(candidate, [
    "schema", "writer", "default_carrier", "legacy_writers", "inline_allow", "validation_commands",
  ])) return false;
  if (!isSupportedAuthoritySchema(candidate.schema)) return false;
  if (typeof candidate.writer !== "object" || candidate.writer === null || Array.isArray(candidate.writer)) return false;
  const writer = candidate.writer as Record<string, unknown>;
  if (!hasOnlyKeys(writer, ["repository", "ref"])) return false;
  if (typeof writer.repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(writer.repository)) return false;
  if (typeof writer.ref !== "string" || writer.ref.trim().length === 0) return false;
  if (candidate.default_carrier !== "central_manifest" && candidate.default_carrier !== "inline_managed") return false;
  if (candidate.legacy_writers !== "forbidden" && candidate.legacy_writers !== "migration_only") return false;
  if (!isStringArray(candidate.inline_allow) || !candidate.inline_allow.every(isSafeAuthorityPathPattern)) return false;
  if (candidate.validation_commands !== undefined && !isStringArray(candidate.validation_commands)) return false;
  return true;
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
