/**
 * Canonical operation and repository-authority contracts.
 *
 * This module is deliberately independent from the mutation engine. It locks the
 * public vocabulary used by the CLI, composite Action, future check/apply
 * orchestration, and consumer authority files without creating a second runtime.
 */
import type { DiscoverySummary } from "./discovery_contracts";
export declare const OPERATION_MODES: readonly ["inventory", "check", "apply", "skills"];
export type OperationMode = (typeof OPERATION_MODES)[number];
export declare const LEGACY_OPERATION_ALIASES: {
    readonly pipeline: "apply";
};
export type LegacyOperationMode = keyof typeof LEGACY_OPERATION_ALIASES;
export interface OperationModeResolution {
    requested: string;
    mode: OperationMode;
    deprecatedAlias?: LegacyOperationMode;
    warning?: string;
}
export declare const META_AUTHORITY_SCHEMA: "l9.meta-authority/v1";
export type MetaAuthoritySchema = typeof META_AUTHORITY_SCHEMA;
export type MetadataCarrier = "hard_skip" | "inventory_only" | "central_manifest" | "inline_managed";
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
export type AuthorityConflictCode = "META_AUTHORITY_FILE_MISSING" | "META_AUTHORITY_SCHEMA_UNSUPPORTED" | "META_AUTHORITY_CONFIG_INVALID" | "META_AUTHORITY_SCAN_INCOMPLETE" | "META_AUTHORITY_WRITER_MISMATCH" | "META_AUTHORITY_CONFLICT" | "META_LEGACY_METADATA_PRESENT";
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
export type AuthorityNoticeCode = "META_LEGACY_METADATA_PRESENT" | "META_LEGACY_WRITER_MIGRATION";
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
export declare function resolveOperationMode(input: string): OperationModeResolution;
export declare function operationRequiresAuthority(mode: OperationMode): boolean;
export declare function isSupportedAuthoritySchema(schema: unknown): schema is MetaAuthoritySchema;
/**
 * Authority globs are security-sensitive repository-relative POSIX patterns.
 * They are intentionally positive-only: negation and path normalization tricks
 * are rejected rather than interpreted.
 */
export declare function isSafeAuthorityPathPattern(value: unknown): value is string;
export declare function isAuthorityConfig(value: unknown): value is AuthorityConfig;
export declare function assertAuthorityForOperation(mode: OperationMode, authority: AuthorityConfig | undefined): AuthorityConfig | undefined;
