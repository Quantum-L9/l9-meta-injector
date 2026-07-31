"use strict";
// omit.ts — gitignore-style path omit for inventory/pipeline (and related CLIs).
// Built-in defaults always protect Cursor SKILL.md from mutating modes and skip
// bytecode/log noise. Operators add patterns via `.l9metaignore`, `--omit`, or
// `--omit-file`. Skills mode deliberately does NOT apply the SKILL.md protect so
// it can material-improve Cursor descriptions (see skills_pipeline.ts / ADR-017).
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILTIN_SKILL_PROTECT_PATTERNS = exports.BUILTIN_NOISE_PATTERNS = exports.L9_METAIGNORE_FILENAME = void 0;
exports.isSkillMdBasename = isSkillMdBasename;
exports.isSkillArtifactPath = isSkillArtifactPath;
exports.buildOmitMatcher = buildOmitMatcher;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
exports.L9_METAIGNORE_FILENAME = ".l9metaignore";
/** Built-in noise: never inventoriable / never injectable in any mode. */
exports.BUILTIN_NOISE_PATTERNS = [
    "__pycache__/",
    "*.pyc",
    "*.pyo",
    "*.pyd",
    "*.log",
];
/**
 * Built-in protect for inventory + pipeline: Cursor Agent Skill entrypoints.
 * Matched case-insensitively on basename (in addition to these glob patterns).
 */
exports.BUILTIN_SKILL_PROTECT_PATTERNS = [
    "**/SKILL.md",
    "**/skill.md",
];
/** True when basename is SKILL.md under any casing. */
function isSkillMdBasename(filePath) {
    return path.basename(filePath).toLowerCase() === "skill.md";
}
/** True when path looks like a skill artifact skills mode may touch. */
function isSkillArtifactPath(filePath) {
    const norm = filePath.replace(/\\/g, "/").toLowerCase();
    const base = path.basename(filePath).toLowerCase();
    if (base === "skill.md")
        return true;
    if (base.includes(".skill."))
        return true;
    if (/\/skills?\//.test(`/${norm}/`) || /(^|\/)skills?\//.test(norm))
        return true;
    return false;
}
function parseOmitFile(contents) {
    const out = [];
    for (const line of contents.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#"))
            continue;
        out.push(t);
    }
    return out;
}
function appendGlobToken(re, pattern, i) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/")
            return { re: re + "(?:.*/)?", next: i + 2 };
        return { re: re + ".*", next: i + 1 };
    }
    if (c === "*")
        return { re: re + "[^/]*", next: i };
    if (c === "?")
        return { re: re + "[^/]", next: i };
    if ("+|(){}^$.".includes(c))
        return { re: re + "\\" + c, next: i };
    return { re: re + c, next: i };
}
/**
 * Convert a single gitignore-style pattern into a RegExp that matches a
 * posix relative path. Supports `**`, `*`, trailing `/` (directory), and
 * leading `/` (root-anchored). Negation (`!`) is handled by the matcher, not here.
 */
function patternToRegExp(pattern) {
    let p = pattern.replace(/\\/g, "/");
    const dirOnly = p.endsWith("/");
    if (dirOnly)
        p = p.slice(0, -1);
    const anchored = p.startsWith("/");
    if (anchored)
        p = p.slice(1);
    let re = "";
    for (let i = 0; i < p.length; i++) {
        const step = appendGlobToken(re, p, i);
        re = step.re;
        i = step.next;
    }
    if (dirOnly)
        re = `(?:${re}|${re}/.*)`;
    if (anchored)
        return new RegExp(`^${re}$`, "i");
    return new RegExp(`(?:^|/)${re}$`, "i");
}
function compileRules(patterns) {
    const rules = [];
    for (const raw of patterns) {
        let p = raw.trim();
        if (!p || p.startsWith("#"))
            continue;
        let negate = false;
        if (p.startsWith("!")) {
            negate = true;
            p = p.slice(1);
        }
        // Directory-name shorthand from inventory --ignore: "node_modules" → "node_modules/"
        if (!/[*/?]/.test(p) && !p.includes("/")) {
            p = `${p}/`;
        }
        rules.push({ negate, re: patternToRegExp(p), raw });
    }
    return rules;
}
/**
 * Build an omit matcher from built-ins + `.l9metaignore` + optional CLI patterns.
 * Last matching rule wins (gitignore semantics), including `!` negation.
 */
function buildOmitMatcher(opts) {
    const patterns = [...exports.BUILTIN_NOISE_PATTERNS];
    if (opts.protectSkillMd !== false) {
        patterns.push(...exports.BUILTIN_SKILL_PROTECT_PATTERNS);
    }
    for (const d of opts.ignoreDirNames ?? []) {
        if (d)
            patterns.push(`${d}/`);
    }
    const metaIgnorePath = path.join(opts.root, exports.L9_METAIGNORE_FILENAME);
    if (fs.existsSync(metaIgnorePath) && fs.statSync(metaIgnorePath).isFile()) {
        try {
            patterns.push(...parseOmitFile(fs.readFileSync(metaIgnorePath, "utf8")));
        }
        catch {
            // Unreadable omit file: continue with built-ins; caller still fail-closed on mutation.
        }
    }
    if (opts.omitFile) {
        const abs = path.resolve(opts.omitFile);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
            patterns.push(...parseOmitFile(fs.readFileSync(abs, "utf8")));
        }
    }
    if (opts.patterns?.length)
        patterns.push(...opts.patterns);
    const rules = compileRules(patterns);
    const protectSkill = opts.protectSkillMd !== false;
    return {
        patterns: [...patterns],
        shouldOmit(relPath) {
            const rel = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
            if (!rel || rel === ".")
                return false;
            // Hard basename protect (case-insensitive) — belt-and-suspenders for SKILL.md.
            if (protectSkill && isSkillMdBasename(rel))
                return true;
            let omitted = false;
            for (const rule of rules) {
                if (rule.re.test(rel))
                    omitted = !rule.negate;
            }
            return omitted;
        },
    };
}
//# sourceMappingURL=omit.js.map