"use strict";
/**
 * Canonical operation and repository-authority contracts.
 *
 * This module is deliberately independent from the mutation engine. It locks the
 * public vocabulary used by the CLI, composite Action, future check/apply
 * orchestration, and consumer authority files without creating a second runtime.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.META_AUTHORITY_SCHEMA = exports.LEGACY_OPERATION_ALIASES = exports.OPERATION_MODES = void 0;
exports.resolveOperationMode = resolveOperationMode;
exports.operationRequiresAuthority = operationRequiresAuthority;
exports.isSupportedAuthoritySchema = isSupportedAuthoritySchema;
exports.isSafeAuthorityPathPattern = isSafeAuthorityPathPattern;
exports.isAuthorityConfig = isAuthorityConfig;
exports.assertAuthorityForOperation = assertAuthorityForOperation;
exports.OPERATION_MODES = ["inventory", "check", "apply", "skills"];
exports.LEGACY_OPERATION_ALIASES = {
    pipeline: "apply",
};
exports.META_AUTHORITY_SCHEMA = "l9.meta-authority/v1";
function resolveOperationMode(input) {
    const requested = input.trim();
    if (exports.OPERATION_MODES.includes(requested)) {
        return { requested, mode: requested };
    }
    if (requested in exports.LEGACY_OPERATION_ALIASES) {
        const alias = requested;
        return {
            requested,
            mode: exports.LEGACY_OPERATION_ALIASES[alias],
            deprecatedAlias: alias,
            warning: `operation mode '${alias}' is deprecated; use '${exports.LEGACY_OPERATION_ALIASES[alias]}'`,
        };
    }
    throw new Error(`unsupported operation mode '${requested || "<empty>"}'; expected one of ${exports.OPERATION_MODES.join(", ")}`);
}
function operationRequiresAuthority(mode) {
    return mode === "check" || mode === "apply";
}
function isSupportedAuthoritySchema(schema) {
    return schema === exports.META_AUTHORITY_SCHEMA;
}
function isStringArray(value) {
    return Array.isArray(value)
        && value.every((item) => typeof item === "string" && item.trim().length > 0)
        && new Set(value).size === value.length;
}
/**
 * Authority globs are security-sensitive repository-relative POSIX patterns.
 * They are intentionally positive-only: negation and path normalization tricks
 * are rejected rather than interpreted.
 */
function isSafeAuthorityPathPattern(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 512)
        return false;
    if (value.trim() !== value)
        return false;
    if (value.startsWith("/") || value.startsWith("./") || value.startsWith("!"))
        return false;
    if (value.includes("\\") || value.includes("//") || /[\u0000-\u001F\u007F]/.test(value))
        return false;
    const segments = value.split("/");
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
function hasOnlyKeys(value, allowed) {
    const allowedSet = new Set(allowed);
    return Object.keys(value).every((key) => allowedSet.has(key));
}
function isAuthorityConfig(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const candidate = value;
    if (!hasOnlyKeys(candidate, [
        "schema", "writer", "default_carrier", "legacy_writers", "inline_allow", "validation_commands",
    ]))
        return false;
    if (!isSupportedAuthoritySchema(candidate.schema))
        return false;
    if (typeof candidate.writer !== "object" || candidate.writer === null || Array.isArray(candidate.writer))
        return false;
    const writer = candidate.writer;
    if (!hasOnlyKeys(writer, ["repository", "ref"]))
        return false;
    if (typeof writer.repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(writer.repository))
        return false;
    if (typeof writer.ref !== "string" || writer.ref.trim().length === 0)
        return false;
    if (candidate.default_carrier !== "central_manifest" && candidate.default_carrier !== "inline_managed")
        return false;
    if (candidate.legacy_writers !== "forbidden" && candidate.legacy_writers !== "migration_only")
        return false;
    if (!isStringArray(candidate.inline_allow) || !candidate.inline_allow.every(isSafeAuthorityPathPattern))
        return false;
    if (candidate.validation_commands !== undefined && !isStringArray(candidate.validation_commands))
        return false;
    return true;
}
function assertAuthorityForOperation(mode, authority) {
    if (authority !== undefined && !isAuthorityConfig(authority)) {
        throw new Error("invalid repository metadata authority configuration");
    }
    if (operationRequiresAuthority(mode) && authority === undefined) {
        throw new Error(`operation mode '${mode}' requires .l9/meta-authority.yaml`);
    }
    return authority;
}
//# sourceMappingURL=operation_contracts.js.map