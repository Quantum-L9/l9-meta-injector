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
exports.authorityFreeCarrierTier = authorityFreeCarrierTier;
exports.resolveCarrierDecision = resolveCarrierDecision;
exports.resolveCarrierDecisions = resolveCarrierDecisions;
exports.assertCarrierDecisionCoverage = assertCarrierDecisionCoverage;
exports.resolveTrackedCarrierDecision = resolveTrackedCarrierDecision;
exports.assertTrackedPathSpelling = assertTrackedPathSpelling;
exports.trackedIndexPathProblem = trackedIndexPathProblem;
exports.resolveTrackedCarrierDecisions = resolveTrackedCarrierDecisions;
const ordering_1 = require("./ordering");
const glob_1 = require("./glob");
const namespace_1 = require("./namespace");
const comment_1 = require("./comment");
const hidden_control_1 = require("./hidden_control");
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
    "generated/",
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
    ".normalize.log.yaml",
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
function matchesInlineAllow(relativePath, patterns) {
    for (const pattern of patterns) {
        if ((0, glob_1.globToRegExp)(pattern).test(relativePath))
            return pattern;
    }
    return undefined;
}
function startsWithAny(relativePath, prefixes) {
    return prefixes.find((prefix) => relativePath.startsWith(prefix));
}
function protectedSegment(relativePath, prefixes) {
    const segments = relativePath.split("/");
    return prefixes.find((prefix) => segments.includes(prefix.slice(0, -1)));
}
function decision(pathName, carrier, reason, authorityRule) {
    return { path: pathName, carrier, reason, authorityRule };
}
/** Protected/generated/binary surfaces that carry no metadata at all. */
function hardSkipDecision(relativePath, lowerPath, subject) {
    const hardPrefix = protectedSegment(lowerPath, HARD_SKIP_PREFIXES);
    if (hardPrefix) {
        return decision(relativePath, "hard_skip", "protected internal, dependency, or generated namespace", hardPrefix);
    }
    const basename = posixBasename(lowerPath);
    if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) {
        return decision(relativePath, "hard_skip", "secret environment files are never metadata carriers", "secret-environment");
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
    const inventoryPrefix = protectedSegment(lowerPath, INVENTORY_ONLY_PREFIXES);
    if (inventoryPrefix) {
        return decision(relativePath, "inventory_only", "generated, vendored, or environment-managed content", inventoryPrefix);
    }
    if (INVENTORY_ONLY_BASENAMES.has(basename) || basename.endsWith(".lock")) {
        return decision(relativePath, "inventory_only", "dependency lock state is inventoried but never annotated", basename);
    }
    if (basename.endsWith(".min.js") || basename.endsWith(".min.css") || basename.endsWith(".map") || basename.includes(".generated.")) {
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
        return decision(relativePath, "central_manifest", `artifact type '${subject.artifactType}' uses the central manifest by default`, `artifact:${subject.artifactType}`);
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
    const commentEligible = (subject.strategy === "line-comment" || subject.strategy === "block-comment")
        && (0, comment_1.hasCommentCarrierFamily)(relativePath, subject.strategy);
    const inlineEligible = commentEligible || (subject.strategy === "yaml-frontmatter" && exports.INLINE_MANAGED_ARTIFACT_TYPES.has(subject.artifactType));
    // A file whose existing frontmatter cannot be rewritten byte-safely is never an inline
    // carrier, no matter how eligible it otherwise is. Its bytes are preserved and its
    // metadata is carried centrally. The reason travels with the decision so an operator
    // can see exactly which file, and which frontmatter limitation, caused the fallback.
    const block = subject.inlineCarrierBlock;
    if (block) {
        const decided = decision(relativePath, "central_manifest", `existing frontmatter is outside the inline-patchable subset (${block.code}); source bytes are preserved`, `frontmatter_unsupported:${block.code}`);
        // A malformed header that an explicit inline_allow authorization asked us to rewrite
        // is the one case the repository's own policy cannot be satisfied safely.
        if (block.malformed && inlinePattern && inlineEligible)
            decided.unsatisfiedInlineAuthorization = true;
        return decided;
    }
    if (inlinePattern && inlineEligible) {
        return decision(relativePath, "inline_managed", mode === "skills" && basename === "skill.md"
            ? "explicitly authorized managed skill entrypoint"
            : commentEligible
                ? "explicitly authorized format-safe comment carrier"
                : "explicitly authorized L9-managed prose artifact", `inline_allow:${inlinePattern}`);
    }
    if (inlinePattern && !inlineEligible) {
        return decision(relativePath, "central_manifest", `inline_allow cannot override an unsafe format or ineligible artifact type '${subject.artifactType}'`, `inline_allow:${inlinePattern}`);
    }
    return decision(relativePath, "central_manifest", authority.default_carrier === "inline_managed"
        ? "inline_managed requires an explicit safe inline_allow match"
        : "repository default carrier is central_manifest", `default_carrier:${authority.default_carrier}`);
}
/**
 * The first two carrier tiers, without reading repository authority.
 * `hard_skip` carries no metadata. `inventory_only` is inventoried and never annotated.
 * Not a public export: `src/public/advanced.ts` does not re-export it.
 */
function authorityFreeCarrierTier(input) {
    const relativePath = normalizeRelativePath(input.path);
    const lowerPath = relativePath.toLowerCase();
    const basename = posixBasename(lowerPath);
    const subject = { path: relativePath, artifactType: "source", strategy: input.strategy };
    return hardSkipDecision(relativePath, lowerPath, subject)
        ?? inventoryOnlyDecision(relativePath, lowerPath, basename);
}
function resolveCarrierDecision(subject, authority, mode) {
    const relativePath = normalizeRelativePath(subject.path);
    const lowerPath = relativePath.toLowerCase();
    const basename = posixBasename(lowerPath);
    const extension = posixExtname(lowerPath);
    // Protected tiers always outrank both repository allow and exclude patterns.
    const protectedDecision = hardSkipDecision(relativePath, lowerPath, subject)
        ?? inventoryOnlyDecision(relativePath, lowerPath, basename);
    if (protectedDecision)
        return protectedDecision;
    const excluded = matchesInlineAllow(relativePath, authority.inline_exclude ?? []);
    if (excluded)
        return decision(relativePath, "central_manifest", "explicit inline_exclude preserves source bytes", `inline_exclude:${excluded}`);
    const byteSensitive = lowerPath.split("/").find((segment) => ["fixture", "fixtures", "__fixtures__", "golden_tests", "datasets", "__snapshots__"].includes(segment));
    if (byteSensitive)
        return decision(relativePath, "central_manifest", "byte-sensitive fixture, golden, or dataset payload is never an inline carrier", `byte-sensitive:${byteSensitive}`);
    if (basename === "skill.md" && mode !== "skills") {
        return decision(relativePath, "central_manifest", "SKILL.md is protected outside skills mode", "protected-skill-entrypoint");
    }
    if (relativePath.split("/").some((segment) => segment.startsWith(".")) && !(0, hidden_control_1.explicitHiddenControlPattern)(relativePath, authority.inline_allow)) {
        return decision(relativePath, "central_manifest", "hidden control requires an inline_allow pattern naming a supported control", "hidden-control-not-explicit");
    }
    // Explicit safe authorization precedes the unchanged central defaults, not protection.
    if (matchesInlineAllow(relativePath, authority.inline_allow) || subject.inlineCarrierBlock) {
        return inlineOrDefaultDecision(relativePath, basename, subject, authority, mode);
    }
    return centralManifestDecision(relativePath, lowerPath, basename, extension, subject)
        ?? inlineOrDefaultDecision(relativePath, basename, subject, authority, mode);
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
    return decisions.sort((left, right) => (0, ordering_1.compareCodePoints)(left.path, right.path));
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
/** Exact Git facts are a separate input domain: discovery never grants write permission. */
function resolveTrackedCarrierDecision(entry) {
    assertTrackedPathSpelling(entry);
    const result = (carrier, disposition, reason) => ({ ...entry, carrier, disposition, reason });
    const name = entry.path;
    // Exact protected paths have priority even if their mode is unsupported.
    if (name === ".l9/metadata-index.jsonl")
        return result("hard_skip", "protected", "protected_self");
    if (name === "GIT_TREE_MANIFEST.json")
        return result("hard_skip", "protected", "protected_manifest");
    const lower = name?.toLowerCase();
    if (lower?.split("/").includes(".git"))
        return result("hard_skip", "protected", "protected_git_internal");
    if (lower && isTrackedSecretPath(lower))
        return result("hard_skip", "protected", "protected_secret");
    if (trackedIndexPathProblem(entry) !== null)
        return result("hard_skip", "unsupported", "unsupported_path");
    if (!((entry.mode === "100644" || entry.mode === "100755" || entry.mode === "120000") && entry.object_type === "blob")
        && !(entry.mode === "160000" && entry.object_type === "commit")) {
        return result("hard_skip", "unsupported", "unsupported_git_entry");
    }
    if (entry.mode === "120000")
        return result("inventory_only", "indexed", "link_as_link");
    if (entry.mode === "160000")
        return result("inventory_only", "indexed", "gitlink_as_reference");
    const basename = posixBasename(lower ?? "");
    const extension = posixExtname(lower ?? "");
    if (startsWithAny(lower ?? "", [...INVENTORY_ONLY_PREFIXES, "node_modules/", "__pycache__/"])
        || INVENTORY_ONLY_BASENAMES.has(basename)
        || GENERATED_SUFFIXES.some((suffix) => lower?.endsWith(suffix))
        || /\.(?:min\.(?:js|css)|map)$/.test(basename)
        || TRACKED_BINARY_NAME_HINTS.has(extension)) {
        return result("inventory_only", "indexed", "name_hint_inventory");
    }
    return result("central_manifest", "indexed", "index_only");
}
const TRACKED_BINARY_NAME_HINTS = new Set([
    ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".pdf", ".mp3", ".mp4", ".woff", ".woff2", ".exe", ".dll", ".so", ".bin", ".wasm",
]);
function isTrackedSecretPath(lower) {
    const parts = lower.split("/");
    return parts.some((part) => part === ".ssh" || part === ".gnupg" || part === "secrets" || part === ".secrets")
        || parts.some((part) => (part === ".env" || part.startsWith(".env.")) && !/\.(?:example|sample|template)$/.test(part))
        || /(?:^|\/)(?:credentials(?:\.[^/]*)?|id_(?:rsa|dsa|ecdsa|ed25519))(?:$|\/)/.test(lower)
        || /\.(?:pem|key|p12|pfx|keystore)$/.test(lower);
}
/** Spelling/evidence disagreements are corruption, not justified representation exceptions. */
function assertTrackedPathSpelling(entry) {
    const bytes = (0, namespace_1.decodeTrackedPathBytes)(entry.path_bytes_base64);
    let decoded;
    try {
        decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    }
    catch {
        decoded = null;
    }
    if (entry.path !== decoded)
        throw new Error("tracked path spelling does not match exact path bytes");
}
/** Unsupported path bytes stay in the external receipt, never vanish from coverage. */
function trackedIndexPathProblem(entry) {
    const value = entry.path;
    if (value === null)
        return "invalid_utf8";
    if (!value || value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value) || value.startsWith("/")
        || /^[A-Za-z]:/.test(value) || [...value].length > 4096)
        return "unsafe_portable_path";
    if (value.split("/").some((segment) => !segment || segment === "." || segment === ".."))
        return "noncanonical_path";
    return null;
}
function resolveTrackedCarrierDecisions(entries) {
    const seen = new Set();
    return entries.map((entry) => {
        if (seen.has(entry.path_bytes_base64))
            throw new Error("duplicate tracked census path");
        seen.add(entry.path_bytes_base64);
        return resolveTrackedCarrierDecision(entry);
    }).sort(namespace_1.compareTrackedPaths);
}
//# sourceMappingURL=mutation_policy.js.map