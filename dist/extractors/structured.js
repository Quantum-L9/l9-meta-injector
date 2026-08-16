"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contractInvariantsExtractor = exports.serviceSpecExtractor = exports.manifestExtractor = void 0;
const common_1 = require("./common");
// ───────────────────────────── manifest/v1 ─────────────────────────────
/** Dependency names worth reporting as a framework or server declaration. */
const FRAMEWORK_DEPENDENCIES = new Set([
    "fastapi",
    "django",
    "flask",
    "starlette",
    "express",
    "next",
    "nestjs",
    "axum",
    "actix-web",
    "rocket",
]);
const SERVER_DEPENDENCIES = new Set(["uvicorn", "gunicorn", "hypercorn", "daphne", "waitress"]);
function pyprojectAssertions(lines) {
    const drafts = [];
    let section = "";
    let sawPoetry = false;
    let sawBuildBackend = false;
    lines.forEach((line, index) => {
        const bare = (0, common_1.stripComment)(line).trim();
        const sectionMatch = /^\[([^\]]+)\]$/.exec(bare);
        if (sectionMatch) {
            section = sectionMatch[1];
            if (section === "tool.poetry")
                sawPoetry = true;
            return;
        }
        const pair = /^([A-Za-z0-9_.\-]+)\s*=\s*(.+)$/.exec(bare);
        if (!pair)
            return;
        const key = pair[1];
        const rawValue = pair[2].trim();
        const value = (0, common_1.unquote)(rawValue);
        if ((section === "tool.poetry" || section === "project") && key === "name") {
            drafts.push((0, common_1.declared)("package.name", value, index, line));
            return;
        }
        if (section === "build-system" && key === "build-backend") {
            sawBuildBackend = true;
            // `poetry.core.masonry.api` names the packaging system in use.
            const system = value.split(".")[0];
            drafts.push((0, common_1.declared)("package.build_backend", value, index, line));
            if (system)
                drafts.push((0, common_1.declared)("package.packaging_system", system, index, line));
            return;
        }
        if (section.endsWith("dependencies") || section === "tool.poetry.dependencies") {
            if (key === "python") {
                drafts.push((0, common_1.declared)("package.python_constraint", value, index, line));
                return;
            }
            const name = key.toLowerCase();
            drafts.push((0, common_1.declared)("package.dependency", name, index, line, "medium"));
            if (FRAMEWORK_DEPENDENCIES.has(name)) {
                drafts.push((0, common_1.declared)("package.framework", name, index, line));
            }
            if (SERVER_DEPENDENCIES.has(name)) {
                drafts.push((0, common_1.declared)("package.server", name, index, line));
            }
        }
    });
    // `[tool.poetry]` alone is a packaging declaration even without a build-system.
    if (sawPoetry && !sawBuildBackend) {
        const index = lines.findIndex((line) => (0, common_1.stripComment)(line).trim() === "[tool.poetry]");
        if (index >= 0)
            drafts.push((0, common_1.declared)("package.packaging_system", "poetry", index, lines[index]));
    }
    return drafts;
}
function packageJsonAssertions(lines) {
    const drafts = [];
    let section = "";
    lines.forEach((line, index) => {
        const bare = (0, common_1.stripComment)(line);
        const sectionMatch = /^\s*"(dependencies|devDependencies|peerDependencies)"\s*:\s*\{/.exec(bare);
        if (sectionMatch) {
            section = sectionMatch[1];
            return;
        }
        if (/^\s*\}/.test(bare))
            section = "";
        const entry = /^\s*"([^"]+)"\s*:\s*"([^"]*)"/.exec(bare);
        if (!entry)
            return;
        const [, key, value] = entry;
        if (section === "") {
            if (key === "name")
                drafts.push((0, common_1.declared)("package.name", value, index, line));
            if (key === "version")
                drafts.push((0, common_1.declared)("package.version", value, index, line));
            return;
        }
        if (section === "dependencies") {
            const name = key.toLowerCase();
            drafts.push((0, common_1.declared)("package.dependency", name, index, line, "medium"));
            if (FRAMEWORK_DEPENDENCIES.has(name)) {
                drafts.push((0, common_1.declared)("package.framework", name, index, line));
            }
            if (SERVER_DEPENDENCIES.has(name)) {
                drafts.push((0, common_1.declared)("package.server", name, index, line));
            }
        }
    });
    return drafts;
}
function cargoAssertions(lines) {
    const drafts = [];
    let section = "";
    lines.forEach((line, index) => {
        const bare = (0, common_1.stripComment)(line).trim();
        const sectionMatch = /^\[([^\]]+)\]$/.exec(bare);
        if (sectionMatch) {
            section = sectionMatch[1];
            return;
        }
        const pair = /^([A-Za-z0-9_.\-]+)\s*=\s*(.+)$/.exec(bare);
        if (!pair)
            return;
        const value = (0, common_1.unquote)(pair[2].trim());
        if (section === "package" && pair[1] === "name") {
            drafts.push((0, common_1.declared)("package.name", value, index, line));
            drafts.push((0, common_1.declared)("package.packaging_system", "cargo", index, line));
        }
        if (section === "dependencies") {
            const name = pair[1].toLowerCase();
            drafts.push((0, common_1.declared)("package.dependency", name, index, line, "medium"));
            if (FRAMEWORK_DEPENDENCIES.has(name)) {
                drafts.push((0, common_1.declared)("package.framework", name, index, line));
            }
        }
    });
    return drafts;
}
exports.manifestExtractor = {
    id: "manifest/v1",
    version: "1.0.0",
    matches(sourcePath) {
        return ((0, common_1.basenameIs)(sourcePath, "pyproject.toml") ||
            (0, common_1.basenameIs)(sourcePath, "package.json") ||
            (0, common_1.basenameIs)(sourcePath, "Cargo.toml"));
    },
    extract(input) {
        const lines = (0, common_1.toLines)(input.content);
        if ((0, common_1.basenameIs)(input.sourcePath, "pyproject.toml"))
            return pyprojectAssertions(lines);
        if ((0, common_1.basenameIs)(input.sourcePath, "package.json"))
            return packageJsonAssertions(lines);
        return cargoAssertions(lines);
    },
};
// ───────────────────────────── service-spec/v1 ─────────────────────────────
exports.serviceSpecExtractor = {
    id: "service-spec/v1",
    version: "1.0.0",
    matches(sourcePath) {
        return (0, common_1.basenameIs)(sourcePath, "spec.yaml") || (0, common_1.basenameIs)(sourcePath, "spec.yml");
    },
    extract(input) {
        const drafts = [];
        const lines = (0, common_1.toLines)(input.content);
        let block = null;
        lines.forEach((line, index) => {
            const pair = (0, common_1.keyValue)(line);
            if (!pair)
                return;
            if (pair.indent === 0) {
                if (pair.key === "service")
                    block = "service";
                else if (pair.key === "actions")
                    block = "actions";
                else
                    block = null;
                return;
            }
            if (block === "service") {
                if (pair.key === "name" && pair.value) {
                    drafts.push((0, common_1.declared)("service.name", pair.value, index, line));
                }
                if (pair.key === "version" && pair.value) {
                    drafts.push((0, common_1.declared)("service.version", pair.value, index, line));
                }
                return;
            }
            if (block === "actions" && pair.key === "name" && pair.value) {
                // A list item under `actions:` names one action the spec declares.
                if (/^\s*-\s+/.test((0, common_1.stripComment)(line))) {
                    drafts.push((0, common_1.declared)("service.action", pair.value, index, line));
                }
            }
        });
        return drafts;
    },
};
// ─────────────────────── contract-invariants/v1 ───────────────────────
/**
 * Invariant vocabulary this profile recognizes.
 *
 * Each entry names a canonical predicate object and the phrases that evidence
 * it. The extractor reports only that the contract file states the invariant —
 * never that the repository upholds it.
 */
const INVARIANT_RULES = [
    {
        object: "gate-compatible-ingress",
        patterns: [
            /\bgate[- ]compatible\b/i,
            /\bthrough\s+(?:the\s+)?gate\b/i,
            /\bgate\s+ingress\b/i,
            /\benters?\s+through\s+gate\b/i,
        ],
    },
    {
        object: "tenant-context-immutable",
        patterns: [/\btenant[_ ]context\b[^.\n]*\bimmutable\b/i, /\bimmutable\b[^.\n]*\btenant\b/i],
    },
    {
        object: "packets-derived-not-mutated",
        patterns: [
            /\bderivation\b[^.\n]*\b(?:not|never)\b[^.\n]*\bmutat/i,
            /\bderived?\b[^.\n]*\brather\s+than\b[^.\n]*\bmutat/i,
            /\bderived?,?\s+(?:not|never)\s+mutat/i,
            /\bnever\s+mutat/i,
        ],
    },
    {
        object: "replay-is-explicit",
        patterns: [/\breplay\b[^.\n]*\bexplicit\b/i, /\bexplicit\b[^.\n]*\breplay\b/i],
    },
    {
        object: "lineage-is-reconstructable",
        patterns: [
            /\blineage\b[^.\n]*\breconstruct/i,
            /\breconstruct\w*\b[^.\n]*\blineage\b/i,
            /\blineage\b[^.\n]*\btraceable\b/i,
        ],
    },
];
exports.contractInvariantsExtractor = {
    id: "contract-invariants/v1",
    version: "1.0.0",
    matches(sourcePath) {
        return /^contracts\/.+\.(ya?ml|md)$/.test(sourcePath);
    },
    extract(input) {
        const drafts = [];
        const lines = (0, common_1.toLines)(input.content);
        // One assertion per invariant per file: the first line that evidences it.
        const claimed = new Set();
        lines.forEach((line, index) => {
            for (const rule of INVARIANT_RULES) {
                if (claimed.has(rule.object))
                    continue;
                if (rule.patterns.some((pattern) => pattern.test(line))) {
                    claimed.add(rule.object);
                    drafts.push((0, common_1.declared)("contract.invariant", rule.object, index, line));
                }
            }
        });
        if (drafts.length > 0) {
            drafts.push({
                predicate: "contract.declares_invariants",
                object: input.sourcePath,
                sourceRange: (0, common_1.spanRange)(0, Math.max(0, lines.length - 1)),
                evidenceExcerpt: `contract file stating ${drafts.length} recognized invariant(s)`,
                evidenceClass: "declared",
                authority: "source",
                confidence: "high",
            });
        }
        return drafts;
    },
};
//# sourceMappingURL=structured.js.map