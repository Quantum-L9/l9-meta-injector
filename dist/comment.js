"use strict";
// comment.ts — Filetype-aware injection strategy.
// The injector must annotate ANY text filetype without corrupting it. Markdown/txt
// take YAML frontmatter; source/config take a comment-wrapped block (line or block
// comment) placed after any shebang; comment-less formats (JSON) and unknown text
// get a sidecar file; binary/media files are skipped. Body is preserved verbatim —
// the injected block is delimited by sentinels so it can be detected and replaced.
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
exports.FRONTMATTER_EXTS = void 0;
exports.isProbablyBinary = isProbablyBinary;
exports.resolveStrategy = resolveStrategy;
exports.sidecarPathFor = sidecarPathFor;
exports.frontMatterInner = frontMatterInner;
exports.yamlToBlock = yamlToBlock;
exports.stripInjectedBlock = stripInjectedBlock;
exports.hasInjectedBlock = hasInjectedBlock;
exports.extractInjectedYaml = extractInjectedYaml;
exports.applyCommentInjection = applyCommentInjection;
const path = __importStar(require("path"));
// Sentinels used to locate a previously-injected block for idempotent re-injection.
const START = ">>> l9:meta >>>";
const END = "<<< l9:meta <<<";
const BLOCK_START = "l9:meta:start";
const BLOCK_END = "l9:meta:end";
exports.FRONTMATTER_EXTS = new Set([".md", ".markdown", ".mdx", ".txt", ".text", ".rst"]);
const LINE_COMMENT = {
    ".ts": "//", ".tsx": "//", ".js": "//", ".jsx": "//", ".mjs": "//", ".cjs": "//",
    ".java": "//", ".c": "//", ".h": "//", ".cpp": "//", ".hpp": "//", ".cc": "//", ".hh": "//",
    ".cs": "//", ".go": "//", ".rs": "//", ".swift": "//", ".kt": "//", ".kts": "//",
    ".scala": "//", ".php": "//", ".dart": "//", ".groovy": "//", ".proto": "//",
    ".sol": "//", ".zig": "//", ".v": "//", ".d": "//",
    ".py": "#", ".rb": "#", ".sh": "#", ".bash": "#", ".zsh": "#", ".fish": "#",
    ".pl": "#", ".pm": "#", ".r": "#", ".jl": "#", ".yaml": "#", ".yml": "#",
    ".toml": "#", ".ini": "#", ".cfg": "#", ".conf": "#", ".properties": "#",
    ".tf": "#", ".tfvars": "#", ".env": "#", ".mk": "#", ".ps1": "#", ".psm1": "#",
    ".nim": "#", ".ex": "#", ".exs": "#", ".gd": "#", ".coffee": "#", ".dockerfile": "#",
    ".sql": "--", ".lua": "--", ".hs": "--", ".elm": "--", ".adb": "--", ".ads": "--",
    ".lisp": ";", ".clj": ";", ".cljs": ";", ".cljc": ";", ".el": ";", ".scm": ";",
    ".asm": ";", ".s": ";",
    ".tex": "%", ".erl": "%", ".m": "%",
};
// Files with no extension (or dotfiles whose whole name is the "extension").
const BASENAME_LINE_COMMENT = {
    "dockerfile": "#", "makefile": "#", "gnumakefile": "#", "rakefile": "#",
    "gemfile": "#", "vagrantfile": "#", "brewfile": "#", "procfile": "#",
    ".gitignore": "#", ".npmignore": "#", ".dockerignore": "#", ".gitattributes": "#",
    ".env": "#", ".bashrc": "#", ".zshrc": "#", ".profile": "#", ".editorconfig": "#",
};
const BLOCK_COMMENT = {
    ".html": { open: "<!--", close: "-->" }, ".htm": { open: "<!--", close: "-->" },
    ".xml": { open: "<!--", close: "-->" }, ".xhtml": { open: "<!--", close: "-->" },
    ".svg": { open: "<!--", close: "-->" }, ".vue": { open: "<!--", close: "-->" },
    ".xsl": { open: "<!--", close: "-->" }, ".xslt": { open: "<!--", close: "-->" },
    ".css": { open: "/*", close: "*/" }, ".scss": { open: "/*", close: "*/" },
    ".sass": { open: "/*", close: "*/" }, ".less": { open: "/*", close: "*/" },
};
// Structured formats with no comment syntax → sidecar (file body must stay parseable).
const SIDECAR_EXTS = new Set([".json", ".jsonc", ".json5", ".geojson", ".csv", ".tsv", ".lock"]);
// Known binary / media extensions → skip (never inspected as text).
const BINARY_EXTS = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tif", ".tiff",
    ".pdf", ".mp3", ".mp4", ".wav", ".flac", ".ogg", ".mov", ".avi", ".mkv", ".webm",
    ".zip", ".gz", ".bz2", ".xz", ".tar", ".7z", ".rar",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".exe", ".dll", ".so", ".dylib", ".class", ".o", ".a", ".lib", ".wasm", ".bin", ".dat",
]);
/** Heuristic: a NUL byte in the first 8 KB means the file is not UTF-8 text. */
function isProbablyBinary(raw) {
    const n = Math.min(raw.length, 8192);
    for (let i = 0; i < n; i++)
        if (raw.charCodeAt(i) === 0)
            return true;
    return false;
}
function resolveStrategy(filePath, raw) {
    const ext = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath).toLowerCase();
    if (BINARY_EXTS.has(ext))
        return { strategy: "skip-binary" };
    if (isProbablyBinary(raw))
        return { strategy: "skip-binary" };
    // .txt/.text are text but not prose-frontmatter carriers: their metadata rides
    // in a sidecar (matches scanFiles, which reports headerConvention="none" for them).
    if (exports.FRONTMATTER_EXTS.has(ext) && ext !== ".txt" && ext !== ".text")
        return { strategy: "yaml-frontmatter" };
    const linePrefix = LINE_COMMENT[ext] ?? BASENAME_LINE_COMMENT[base];
    if (linePrefix)
        return { strategy: "line-comment", linePrefix };
    const block = BLOCK_COMMENT[ext];
    if (block)
        return { strategy: "block-comment", blockOpen: block.open, blockClose: block.close };
    if (SIDECAR_EXTS.has(ext))
        return { strategy: "sidecar" };
    // Unknown text extension: sidecar is the only universally safe option.
    return { strategy: "sidecar" };
}
function sidecarPathFor(filePath) {
    return filePath + ".l9meta.yaml";
}
/** Strip the `---` fences from a serialized frontmatter block, leaving inner YAML lines. */
function frontMatterInner(yamlFrontMatter) {
    return yamlFrontMatter.replace(/^---\r?\n/, "").replace(/\r?\n---\s*$/, "");
}
function esc(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Wrap inner YAML in the comment style for this spec. Returns the block (no trailing newline). */
function yamlToBlock(yamlInner, spec) {
    const lines = yamlInner.split("\n");
    if (spec.strategy === "line-comment") {
        const p = spec.linePrefix;
        const out = [`${p} ${START}`, ...lines.map((l) => (l === "" ? p : `${p} ${l}`)), `${p} ${END}`];
        return out.join("\n");
    }
    if (spec.strategy === "block-comment") {
        return [`${spec.blockOpen} ${BLOCK_START}`, ...lines, `${BLOCK_END} ${spec.blockClose}`].join("\n");
    }
    throw new Error(`yamlToBlock: unsupported strategy ${spec.strategy}`);
}
/** Regex matching an existing injected block (+ one trailing newline) for this spec. */
function blockRegex(spec) {
    if (spec.strategy === "line-comment") {
        const p = esc(spec.linePrefix);
        return new RegExp(`${p} ${esc(START)}[\\s\\S]*?${p} ${esc(END)}\\r?\\n?`);
    }
    if (spec.strategy === "block-comment") {
        const o = esc(spec.blockOpen);
        const c = esc(spec.blockClose);
        return new RegExp(`${o} ${esc(BLOCK_START)}[\\s\\S]*?${esc(BLOCK_END)} ${c}\\r?\\n?`);
    }
    return null;
}
/** Remove a previously-injected comment block, returning the clean body verbatim. */
function stripInjectedBlock(raw, spec) {
    const re = blockRegex(spec);
    if (!re)
        return raw;
    return raw.replace(re, "");
}
/** Detect whether a comment-injected block is present. */
function hasInjectedBlock(raw, spec) {
    const re = blockRegex(spec);
    return re ? re.test(raw) : false;
}
/** Extract the inner YAML from an existing comment block (comment prefixes removed), or null. */
function extractInjectedYaml(raw, spec) {
    const re = blockRegex(spec);
    if (!re)
        return null;
    const m = raw.match(re);
    if (!m)
        return null;
    const body = m[0];
    if (spec.strategy === "line-comment") {
        const p = spec.linePrefix;
        return body.split("\n")
            .filter((l) => !l.includes(START) && !l.includes(END) && l.trimStart().startsWith(p))
            .map((l) => l.replace(new RegExp(`^\\s*${esc(p)} ?`), ""))
            .join("\n").trim();
    }
    // block-comment
    return body.split("\n")
        .filter((l) => !l.includes(BLOCK_START) && !l.includes(BLOCK_END))
        .join("\n").trim();
}
/**
 * Assemble the injected file for comment strategies, preserving cleanBody verbatim
 * and keeping a shebang (`#!...`) on line 1. Recoverable via stripInjectedBlock.
 */
function applyCommentInjection(cleanBody, block) {
    if (cleanBody.startsWith("#!")) {
        const nl = cleanBody.indexOf("\n");
        if (nl === -1)
            return `${cleanBody}\n${block}\n`;
        const shebang = cleanBody.slice(0, nl);
        const rest = cleanBody.slice(nl + 1);
        return `${shebang}\n${block}\n${rest}`;
    }
    return `${block}\n${cleanBody}`;
}
//# sourceMappingURL=comment.js.map