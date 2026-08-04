"use strict";
/**
 * Deterministic metadata-carrier policy.
 *
 * Carrier selection is deliberately separate from file discovery and mutation.
 * Every discovered path receives one policy decision before later workstreams
 * decide how to materialize a central manifest or an inline managed patch.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INLINE_MANAGED_ARTIFACT_TYPES = exports.CARRIER_PRECEDENCE = void 0;
exports.resolveCarrierDecision = resolveCarrierDecision;
exports.resolveCarrierDecisions = resolveCarrierDecisions;
exports.assertCarrierDecisionCoverage = assertCarrierDecisionCoverage;
exports.CARRIER_PRECEDENCE = [
    "hard_skip",
    "inventory_only",
    "central_manifest",
    "inline_managed",
];
exports.INLINE_MANAGED_ARTIFACT_TYPES = new Set([
    "prompt",
    "skill",
    "playbook",
    "kernel",
    "context",
    "doctrine",
]);
const HARD_SKIP_PREFIXES = [
    ".git/",
    ".l9/",
    "node_modules/",
    "__pycache__/",
];
const INVENTORY_ONLY_PREFIXES = [
    "dist/",
    "build/",
    "coverage/",
    "vendor/",
    "third_party/",
    "third-party/",
    ".venv/",
    "venv/",
];
const CENTRAL_MANIFEST_PREFIXES = [
    ".github/",
    ".devcontainer/",
    ".husky/",
    ".githooks/",
    "src/",
    "lib/",
    "app/",
    "packages/",
    "tests/",
    "test/",
    "__tests__/",
    "scripts/",
    "bin/",
    "tools/",
    "infra/",
    "infrastructure/",
    "terraform/",
    "pulumi/",
    "k8s/",
    "kubernetes/",
    "helm/",
];
const GENERATED_SUFFIXES = [
    ".l9meta.yaml",
    ".inject.log",
];
const INVENTORY_ONLY_BASENAMES = new Set([
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
    "poetry.lock",
    "pdm.lock",
    "pipfile.lock",
    "composer.lock",
    "cargo.lock",
    "go.sum",
]);
const CENTRAL_MANIFEST_BASENAMES = new Set([
    "package.json",
    "tsconfig.json",
    "jsconfig.json",
    "deno.json",
    "deno.jsonc",
    "pyproject.toml",
    "setup.cfg",
    "setup.py",
    "requirements.txt",
    "dockerfile",
    "compose.yaml",
    "compose.yml",
    "docker-compose.yaml",
    "docker-compose.yml",
    "makefile",
    "gnumakefile",
    ".editorconfig",
    ".gitignore",
    ".gitattributes",
    ".npmignore",
    ".dockerignore",
    "codeowners",
]);
const CENTRAL_MANIFEST_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".rb", ".php", ".java", ".kt", ".kts", ".scala",
    ".go", ".rs", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs",
    ".swift", ".dart", ".lua", ".r", ".jl", ".pl", ".pm",
    ".sh", ".bash", ".zsh", ".fish", ".ps1",
    ".json", ".jsonc", ".json5", ".geojson", ".csv", ".tsv",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties",
    ".xml", ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".sql", ".proto", ".graphql", ".gql",
    ".tf", ".tfvars", ".hcl",
]);
const CENTRAL_MANIFEST_ARTIFACT_TYPES = new Set([
    "source",
    "test",
    "script",
]);
function normalizeRelativePath(value) {
    if (value.includes("\u0000"))
        throw new Error("carrier path contains NUL");
    if (value.includes("\\"))
        throw new Error(`carrier path must use POSIX separators: ${value}`);
    if (value.startsWith("/") || value.startsWith("./")) {
        throw new Error(`carrier path must be canonical repository-relative POSIX: ${value}`);
    }
    if (value.includes("//"))
        throw new Error(`carrier path contains an empty segment: ${value}`);
    const segments = value.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error(`carrier path contains a non-canonical segment: ${value}`);
    }
    const normalized = segments.join("/");
    if (!normalized)
        throw new Error("carrier path must identify a repository entry");
    return normalized;
}
function posixBasename(value) {
    const index = value.lastIndexOf("/");
    return index === -1 ? value : value.slice(index + 1);
}
function posixExtname(value) {
    const base = posixBasename(value);
    const index = base.lastIndexOf(".");
    return index <= 0 ? "" : base.slice(index);
}
function globToRegExp(pattern) {
    let source = "^";
    for (let index = 0; index < pattern.length; index++) {
        const char = pattern[index];
        if (char === "*" && pattern[index + 1] === "*") {
            if (pattern[index + 2] === "/") {
                source += "(?:.*/)?";
                index += 2;
            }
            else {
                source += ".*";
                index += 1;
            }
            continue;
        }
        if (char === "*") {
            source += "[^/]*";
            continue;
        }
        if (char === "?") {
            source += "[^/]";
            continue;
        }
        source += char.replace(/[|\\{}()[\]^$+?.]/g, String.raw `\$&`);
    }
    source += "$";
    return new RegExp(source);
}
function matchesInlineAllow(relativePath, patterns) {
    for (const pattern of patterns) {
        if (globToRegExp(pattern).test(relativePath))
            return pattern;
    }
    return undefined;
}
function startsWithAny(relativePath, prefixes) {
    return prefixes.find((prefix) => relativePath.startsWith(prefix));
}
function decision(pathName, carrier, reason, authorityRule) {
    return { path: pathName, carrier, reason, authorityRule };
}
/** Protected/generated/binary surfaces that carry no metadata at all. */
function hardSkipDecision(relativePath, lowerPath, subject) {
    const hardPrefix = startsWithAny(lowerPath, HARD_SKIP_PREFIXES);
    if (hardPrefix) {
        return decision(relativePath, "hard_skip", "protected internal, dependency, or generated namespace", hardPrefix);
    }
    const generatedSuffix = GENERATED_SUFFIXES.find((suffix) => lowerPath.endsWith(suffix));
    if (generatedSuffix) {
        return decision(relativePath, "hard_skip", "injector-generated metadata artifact", generatedSuffix);
    }
    if (subject.strategy === "skip-binary") {
        return decision(relativePath, "hard_skip", "binary or media content has no metadata carrier", "strategy:skip-binary");
    }
    return null;
}
/** Generated/vendored surfaces that are inventoried but never annotated. */
function inventoryOnlyDecision(relativePath, lowerPath, basename) {
    const inventoryPrefix = startsWithAny(lowerPath, INVENTORY_ONLY_PREFIXES);
    if (inventoryPrefix) {
        return decision(relativePath, "inventory_only", "generated, vendored, or environment-managed content", inventoryPrefix);
    }
    if (INVENTORY_ONLY_BASENAMES.has(basename)) {
        return decision(relativePath, "inventory_only", "dependency lock state is inventoried but never annotated", basename);
    }
    if (basename.endsWith(".min.js") || basename.endsWith(".min.css") || basename.endsWith(".map")) {
        return decision(relativePath, "inventory_only", "generated distribution artifact", "generated-distribution-suffix");
    }
    return null;
}
/** Structured/executable/non-prose surfaces routed through the central manifest. */
function centralManifestDecision(relativePath, lowerPath, basename, extension, subject) {
    const centralPrefix = startsWithAny(lowerPath, CENTRAL_MANIFEST_PREFIXES);
    if (centralPrefix) {
        return decision(relativePath, "central_manifest", "source, test, automation, or infrastructure surface", centralPrefix);
    }
    if (CENTRAL_MANIFEST_ARTIFACT_TYPES.has(subject.artifactType)) {
        return decision(relativePath, "central_manifest", `artifact type '${subject.artifactType}' is never an inline carrier`, `artifact:${subject.artifactType}`);
    }
    if (CENTRAL_MANIFEST_BASENAMES.has(basename) || CENTRAL_MANIFEST_EXTENSIONS.has(extension)) {
        return decision(relativePath, "central_manifest", "structured, executable, or configuration format", basename || extension);
    }
    if (subject.strategy === "line-comment" || subject.strategy === "block-comment" || subject.strategy === "sidecar") {
        return decision(relativePath, "central_manifest", "non-prose formats use the central manifest by default", `strategy:${subject.strategy}`);
    }
    return null;
}
/** Final tier: inline_allow eligibility, else the repository default carrier. */
function inlineOrDefaultDecision(relativePath, basename, subject, authority, mode) {
    const inlinePattern = matchesInlineAllow(relativePath, authority.inline_allow);
    const inlineEligible = exports.INLINE_MANAGED_ARTIFACT_TYPES.has(subject.artifactType);
    if (inlinePattern && inlineEligible) {
        return decision(relativePath, "inline_managed", mode === "skills" && basename === "skill.md"
            ? "explicitly authorized managed skill entrypoint"
            : "explicitly authorized L9-managed prose artifact", `inline_allow:${inlinePattern}`);
    }
    if (inlinePattern && !inlineEligible) {
        return decision(relativePath, "central_manifest", `inline_allow cannot override ineligible artifact type '${subject.artifactType}'`, `inline_allow:${inlinePattern}`);
    }
    return decision(relativePath, "central_manifest", authority.default_carrier === "inline_managed"
        ? "inline_managed requires an explicit safe inline_allow match"
        : "repository default carrier is central_manifest", `default_carrier:${authority.default_carrier}`);
}
function resolveCarrierDecision(subject, authority, mode) {
    const relativePath = normalizeRelativePath(subject.path);
    const lowerPath = relativePath.toLowerCase();
    const basename = posixBasename(lowerPath);
    const extension = posixExtname(lowerPath);
    // Ordered decision tiers — first non-null wins (order is load-bearing).
    return (hardSkipDecision(relativePath, lowerPath, subject) ??
        inventoryOnlyDecision(relativePath, lowerPath, basename) ??
        centralManifestDecision(relativePath, lowerPath, basename, extension, subject) ??
        inlineOrDefaultDecision(relativePath, basename, subject, authority, mode));
}
function resolveCarrierDecisions(input) {
    const seen = new Set();
    const decisions = input.subjects.map((subject) => {
        const result = resolveCarrierDecision(subject, input.authority, input.mode);
        if (seen.has(result.path))
            throw new Error(`duplicate carrier subject path: ${result.path}`);
        seen.add(result.path);
        return result;
    });
    return decisions.sort((left, right) => left.path.localeCompare(right.path));
}
function assertCarrierDecisionCoverage(subjects, decisions) {
    const expected = new Set(subjects.map((subject) => normalizeRelativePath(subject.path)));
    const actual = new Set();
    for (const item of decisions) {
        const normalized = normalizeRelativePath(item.path);
        if (actual.has(normalized))
            throw new Error(`duplicate carrier decision path: ${normalized}`);
        actual.add(normalized);
        if (!exports.CARRIER_PRECEDENCE.includes(item.carrier)) {
            throw new Error(`unsupported carrier decision '${String(item.carrier)}' for ${normalized}`);
        }
    }
    const missing = [...expected].filter((item) => !actual.has(item));
    const extra = [...actual].filter((item) => !expected.has(item));
    if (missing.length || extra.length) {
        throw new Error(`carrier decision coverage mismatch; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`);
    }
}
//# sourceMappingURL=mutation_policy.js.map