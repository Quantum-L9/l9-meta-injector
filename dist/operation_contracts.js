"use strict";
/**
 * Canonical operation and repository-authority contracts.
 *
 * This module is deliberately independent from the mutation engine. It locks the
 * public vocabulary used by the CLI, composite Action, future check/apply
 * orchestration, and consumer authority files without creating a second runtime.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_SEMANTIC_LEDGERS = exports.PRODUCT_OWNER_RE = exports.PRODUCT_ID_RE = exports.SEMANTIC_REVISION_RE = exports.SEMANTIC_LEDGER_DIGEST_RE = exports.SEMANTIC_LEDGER_ID_RE = exports.META_AUTHORITY_SCHEMA_V2 = exports.META_AUTHORITY_SCHEMA = exports.LEGACY_OPERATION_ALIASES = exports.OPERATION_MODES = void 0;
exports.resolveOperationMode = resolveOperationMode;
exports.operationRequiresAuthority = operationRequiresAuthority;
exports.isSupportedAuthoritySchema = isSupportedAuthoritySchema;
exports.isProductKindDeclaration = isProductKindDeclaration;
exports.kindBoundLedgerId = kindBoundLedgerId;
exports.archetypePrefixForKind = archetypePrefixForKind;
exports.isSemanticFoundationBinding = isSemanticFoundationBinding;
exports.isProductDeclaration = isProductDeclaration;
exports.semanticBindingErrors = semanticBindingErrors;
exports.isSafeAuthorityPathPattern = isSafeAuthorityPathPattern;
exports.isAuthorityConfig = isAuthorityConfig;
exports.assertAuthorityForOperation = assertAuthorityForOperation;
exports.OPERATION_MODES = ["inventory", "check", "apply", "skills"];
exports.LEGACY_OPERATION_ALIASES = {
    pipeline: "apply",
};
exports.META_AUTHORITY_SCHEMA = "l9.meta-authority/v1";
exports.META_AUTHORITY_SCHEMA_V2 = "l9.meta-authority/v2";
exports.SEMANTIC_LEDGER_ID_RE = /^l9\.[a-z0-9-]+\/[a-z0-9-]+@[0-9]+$/;
exports.SEMANTIC_LEDGER_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
exports.SEMANTIC_REVISION_RE = /^[0-9a-f]{40}$/;
exports.PRODUCT_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
exports.PRODUCT_OWNER_RE = /^[^/\s]+\/[^/\s]+$/;
exports.REQUIRED_SEMANTIC_LEDGERS = [
    "l9.authority-model/global@1",
    "l9.artifact-model/global@1",
    "l9.vocabulary/global@1",
    "l9.identity-model/global@1",
    "l9.product-kinds/global@1",
];
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
    return mode === "check" || mode === "apply" || mode === "skills";
}
function isSupportedAuthoritySchema(schema) {
    return schema === exports.META_AUTHORITY_SCHEMA || schema === exports.META_AUTHORITY_SCHEMA_V2;
}
function isProductKindDeclaration(value) {
    return value === "node" || value === "dependency" || value === "Unknown";
}
function kindBoundLedgerId(kind) {
    if (kind === "dependency")
        return "l9.dependency-archetypes/global@1";
    if (kind === "node")
        return "l9.node-archetypes/global@1";
    return undefined;
}
function archetypePrefixForKind(kind) {
    if (kind === "dependency")
        return "l9.dependency-archetype/";
    if (kind === "node")
        return "l9.node-archetype/";
    return undefined;
}
function isSemanticFoundationBinding(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const candidate = value;
    if (!hasOnlyKeys(candidate, ["repository", "revision", "release", "admission", "ledgers"]))
        return false;
    if (typeof candidate.repository !== "string" || !exports.PRODUCT_OWNER_RE.test(candidate.repository))
        return false;
    if (typeof candidate.revision !== "string" || !exports.SEMANTIC_REVISION_RE.test(candidate.revision))
        return false;
    if (typeof candidate.release !== "string" || candidate.release.trim().length === 0)
        return false;
    if (candidate.admission !== "candidate" && candidate.admission !== "admitted" && candidate.admission !== "Unknown") {
        return false;
    }
    if (typeof candidate.ledgers !== "object" || candidate.ledgers === null || Array.isArray(candidate.ledgers)) {
        return false;
    }
    const ledgers = candidate.ledgers;
    const keys = Object.keys(ledgers);
    if (keys.length === 0)
        return false;
    for (const key of keys) {
        if (!exports.SEMANTIC_LEDGER_ID_RE.test(key))
            return false;
        const digest = ledgers[key];
        if (typeof digest !== "string" || !exports.SEMANTIC_LEDGER_DIGEST_RE.test(digest))
            return false;
    }
    return true;
}
function isProductDeclaration(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const candidate = value;
    if (!hasOnlyKeys(candidate, ["id", "owner", "kind", "archetype"]))
        return false;
    if (typeof candidate.id !== "string" || !exports.PRODUCT_ID_RE.test(candidate.id))
        return false;
    if (typeof candidate.owner !== "string" || !exports.PRODUCT_OWNER_RE.test(candidate.owner))
        return false;
    if (!isProductKindDeclaration(candidate.kind))
        return false;
    if (typeof candidate.archetype !== "string" || candidate.archetype.trim().length === 0)
        return false;
    if (candidate.archetype !== "Unknown") {
        const prefix = archetypePrefixForKind(candidate.kind);
        if (!prefix || !candidate.archetype.startsWith(prefix))
            return false;
        if (!exports.SEMANTIC_LEDGER_ID_RE.test(candidate.archetype))
            return false;
    }
    else if (candidate.kind !== "Unknown") {
        return false;
    }
    return true;
}
function semanticBindingErrors(config) {
    const errors = [];
    if (config.schema !== exports.META_AUTHORITY_SCHEMA_V2)
        return errors;
    if (!config.semantic_foundation || !config.product) {
        errors.push("l9.meta-authority/v2 requires semantic_foundation and product");
        return errors;
    }
    const { semantic_foundation: binding, product } = config;
    for (const id of exports.REQUIRED_SEMANTIC_LEDGERS) {
        if (!(id in binding.ledgers))
            errors.push(`missing required ledger ${id}`);
    }
    const bound = kindBoundLedgerId(product.kind);
    if (bound && !(bound in binding.ledgers))
        errors.push(`missing kind-bound ledger ${bound}`);
    return errors;
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
    const v1Keys = [
        "schema", "writer", "default_carrier", "legacy_writers", "inline_allow", "validation_commands",
    ];
    const v2Keys = [...v1Keys, "semantic_foundation", "product"];
    if (!isSupportedAuthoritySchema(candidate.schema))
        return false;
    const allowed = candidate.schema === exports.META_AUTHORITY_SCHEMA_V2 ? v2Keys : v1Keys;
    if (!hasOnlyKeys(candidate, allowed))
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
    if (candidate.schema === exports.META_AUTHORITY_SCHEMA) {
        return candidate.semantic_foundation === undefined && candidate.product === undefined;
    }
    if (!isSemanticFoundationBinding(candidate.semantic_foundation))
        return false;
    if (!isProductDeclaration(candidate.product))
        return false;
    const config = candidate;
    return semanticBindingErrors(config).length === 0;
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