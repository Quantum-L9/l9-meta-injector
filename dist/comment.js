"use strict";
// comment.ts — Filetype-aware injection strategy.
// The injector must annotate ANY text filetype without corrupting it. Markdown
// takes YAML frontmatter; source/config take a comment-wrapped block (line or block
// comment) placed at the carrier position — the first byte after every mandatory
// prologue (BOM, shebang, encoding cookie, XML declaration, bare `<?php` line,
// `@charset` line, Dockerfile parser directives); a file whose language leaves no
// inert position, comment-less formats (JSON), .txt/.text, and unknown text get a
// sidecar file; binary/media files are skipped. Body is preserved verbatim — the
// injected block is delimited by sentinels and recognised only at the carrier
// position (or the legacy byte-0 position), so it can be detected and replaced (ADR-057).
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
exports.FRONTMATTER_EXTS = exports.PROSE_EXTS = void 0;
exports.isProbablyBinary = isProbablyBinary;
exports.resolveStrategy = resolveStrategy;
exports.sidecarPathFor = sidecarPathFor;
exports.frontMatterInner = frontMatterInner;
exports.detectNewlineConvention = detectNewlineConvention;
exports.yamlToBlock = yamlToBlock;
exports.stripInjectedBlock = stripInjectedBlock;
exports.hasInjectedBlock = hasInjectedBlock;
exports.extractInjectedYaml = extractInjectedYaml;
exports.applyCommentInjection = applyCommentInjection;
const path = __importStar(require("node:path"));
const archive_formats_1 = require("./archive_formats");
// Sentinels used to locate a previously-injected block for idempotent re-injection.
const START = ">>> l9:meta >>>";
const END = "<<< l9:meta <<<";
const BLOCK_START = "l9:meta:start";
const BLOCK_END = "l9:meta:end";
exports.PROSE_EXTS = new Set([".md", ".markdown", ".mdx", ".txt", ".text", ".rst"]);
exports.FRONTMATTER_EXTS = new Set([".md", ".markdown"]);
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
    // CodeQL: .ql is QL source ('//' comments); .qls is a query suite (YAML).
    ".ql": "//", ".qls": "#",
    // Sass indented syntax: '/*' comments are indentation-scoped, '//' lines are silent.
    ".sass": "//",
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
    "codeowners": "#",
};
const BLOCK_COMMENT = {
    ".html": { open: "<!--", close: "-->" }, ".htm": { open: "<!--", close: "-->" },
    ".xml": { open: "<!--", close: "-->" }, ".xhtml": { open: "<!--", close: "-->" },
    ".svg": { open: "<!--", close: "-->" }, ".vue": { open: "<!--", close: "-->" },
    ".xsl": { open: "<!--", close: "-->" }, ".xslt": { open: "<!--", close: "-->" },
    ".css": { open: "/*", close: "*/" }, ".scss": { open: "/*", close: "*/" },
    ".less": { open: "/*", close: "*/" },
};
// Mandatory prologues per extension / extension-less basename (ADR-057).
const PROLOGUE_BY_EXT = {
    ".xml": "xml-declaration", ".svg": "xml-declaration", ".xsl": "xml-declaration",
    ".xslt": "xml-declaration", ".xhtml": "xml-declaration",
    ".php": "php-open-tag",
    ".py": "encoding-cookie", ".pyw": "encoding-cookie", ".rb": "encoding-cookie",
    ".css": "css-charset", ".scss": "css-charset", ".less": "css-charset",
    ".dockerfile": "dockerfile-directives",
};
const PROLOGUE_BY_BASENAME = { "dockerfile": "dockerfile-directives" };
// Delimiters written before ADR-057 corrected the table; recognised for one repair.
const LEGACY_CARRIER_BY_EXT = {
    ".ql": { strategy: "line-comment", linePrefix: "#" },
    ".sass": { strategy: "block-comment", blockOpen: "/*", blockClose: "*/" },
};
// Structured formats with no comment syntax → sidecar (file body must stay parseable).
const SIDECAR_EXTS = new Set([".json", ".jsonc", ".json5", ".geojson", ".csv", ".tsv", ".lock"]);
// Known binary / media extensions → skip (never inspected as text).
const BINARY_EXTS = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tif", ".tiff",
    ".pdf", ".mp3", ".mp4", ".wav", ".flac", ".ogg", ".mov", ".avi", ".mkv", ".webm",
    // Every archive extension the package recognizes, expandable or not (one owner).
    ...archive_formats_1.ARCHIVE_EXTENSIONS,
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".exe", ".dll", ".so", ".dylib", ".class", ".o", ".a", ".lib", ".wasm", ".bin", ".dat",
    // Bytecode / ephemeral noise — skip entirely (no sidecar, no inventory inject).
    ".pyc", ".pyo", ".pyd", ".log",
]);
/** Heuristic: a NUL byte in the first 8 KB means the file is not UTF-8 text. */
function isProbablyBinary(raw) {
    const n = Math.min(raw.length, 8192);
    for (let i = 0; i < n; i++)
        if (raw.codePointAt(i) === 0)
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
    if (exports.FRONTMATTER_EXTS.has(ext))
        return { strategy: "yaml-frontmatter" };
    const linePrefix = LINE_COMMENT[ext] ?? BASENAME_LINE_COMMENT[base];
    if (linePrefix)
        return withCarrierPosition({ strategy: "line-comment", linePrefix }, ext, base, raw);
    const block = BLOCK_COMMENT[ext];
    if (block)
        return withCarrierPosition({ strategy: "block-comment", blockOpen: block.open, blockClose: block.close }, ext, base, raw);
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
    return s.replace(/[.*+?^${}()|[\]\\]/g, String.raw `\$&`);
}
/**
 * The newline convention a text body already uses: whichever the first line
 * ending is. A file with no line ending yet is treated as LF. The injected block
 * adopts the file's convention so a CRLF source does not come back with LF
 * inside its header and CRLF everywhere else.
 */
function detectNewlineConvention(text) {
    const lf = text.indexOf("\n");
    return lf > 0 && text[lf - 1] === "\r" ? "\r\n" : "\n";
}
/** Wrap inner YAML in the comment style for this spec. Returns the block (no trailing newline). */
function yamlToBlock(yamlInner, spec, newline = "\n") {
    const lines = yamlInner.split(/\r?\n/);
    if (spec.strategy === "line-comment") {
        const p = spec.linePrefix;
        const out = [`${p} ${START}`, ...lines.map((l) => (l === "" ? p : `${p} ${l}`)), `${p} ${END}`];
        return out.join(newline);
    }
    if (spec.strategy === "block-comment") {
        return [`${spec.blockOpen} ${BLOCK_START}`, ...lines, `${BLOCK_END} ${spec.blockClose}`].join(newline);
    }
    throw new Error(`yamlToBlock: unsupported strategy ${spec.strategy}`);
}
function lineAt(text, pos) {
    const nl = text.indexOf("\n", pos);
    if (nl === -1)
        return { content: text.slice(pos), next: text.length, terminated: false };
    const end = nl > pos && text[nl - 1] === "\r" ? nl - 1 : nl;
    return { content: text.slice(pos, end), next: nl + 1, terminated: true };
}
const BOM = "\uFEFF";
const ENCODING_COOKIE = /^[ \t\f]*#.*?coding[:=][ \t]*[-\w.]+/;
const COMMENT_OR_BLANK = /^[ \t\f]*(?:#.*)?$/;
const DOCKER_DIRECTIVE = /^#[ \t]*(?:syntax|escape|check)[ \t]*=/i;
const BARE_PHP_OPEN = /^<\?php[ \t]*$/i;
const CHARSET_LINE = /^@charset "[^"]*";[ \t]*$/;
const XML_DECL_START = /^<\?xml[ \t\r\n]/;
const REST_OF_LINE_BLANK = /^[ \t]*$/;
function carrierPosition(text, spec) {
    const start = text.startsWith(BOM) ? BOM.length : 0;
    let pos = start;
    let lastTerminated = true;
    let consumed = 0;
    const take = (line) => { pos = line.next; lastTerminated = line.terminated; consumed++; };
    if (text.startsWith("#!", pos))
        take(lineAt(text, pos));
    switch (spec?.prologue) {
        case "encoding-cookie": {
            // PEP 263: line 1, or line 2 when line 1 is blank or a comment (a shebang is one).
            const line = lineAt(text, pos);
            if (pos < text.length && ENCODING_COOKIE.test(line.content))
                take(line);
            else if (consumed === 0 && line.terminated && COMMENT_OR_BLANK.test(line.content)) {
                const second = lineAt(text, line.next);
                if (ENCODING_COOKIE.test(second.content)) {
                    take(line);
                    take(second);
                }
            }
            break;
        }
        case "php-open-tag": {
            const line = lineAt(text, pos);
            if (!BARE_PHP_OPEN.test(line.content))
                return null;
            take(line);
            break;
        }
        case "xml-declaration": {
            if (consumed > 0 || !XML_DECL_START.test(text.slice(pos, pos + 6)))
                break;
            const close = text.indexOf("?>", pos);
            if (close === -1)
                return null;
            const rest = lineAt(text, close + 2);
            if (!REST_OF_LINE_BLANK.test(rest.content))
                return null;
            take(rest);
            break;
        }
        case "css-charset": {
            if (consumed > 0 || !text.startsWith('@charset "', pos))
                break;
            const line = lineAt(text, pos);
            if (!CHARSET_LINE.test(line.content))
                return null;
            take(line);
            break;
        }
        case "dockerfile-directives": {
            for (let line = lineAt(text, pos); pos < text.length && DOCKER_DIRECTIVE.test(line.content); line = lineAt(text, pos)) {
                take(line);
            }
            break;
        }
        default:
            break;
    }
    if (consumed > 0 && !lastTerminated)
        return { offset: text.length, unterminated: true };
    return { offset: pos, unterminated: false };
}
function isCommentStrategy(spec) {
    return spec.strategy === "line-comment" || spec.strategy === "block-comment";
}
/** Fill the prologue/legacy descriptors; route to a sidecar when no inert position exists. */
function withCarrierPosition(spec, ext, base, raw) {
    const prologue = PROLOGUE_BY_EXT[ext] ?? PROLOGUE_BY_BASENAME[base];
    const legacy = LEGACY_CARRIER_BY_EXT[ext];
    const resolved = { ...spec };
    if (prologue)
        resolved.prologue = prologue;
    if (legacy)
        resolved.legacyCarrier = { ...legacy };
    // Decide on the file without its managed block (wherever it sits), so the answer
    // is the same before and after injection and for a legacy byte-0 block.
    if (prologue && carrierPosition(stripInjectedBlock(raw, resolved), resolved) === null) {
        return { strategy: "sidecar" };
    }
    return resolved;
}
/** A managed block starting exactly at `pos`, delimited per `spec`, or null. */
function blockAt(text, pos, spec) {
    let open;
    let close;
    if (spec.strategy === "line-comment") {
        open = `${spec.linePrefix} ${START}`;
        close = `${spec.linePrefix} ${END}`;
    }
    else if (spec.strategy === "block-comment") {
        open = `${spec.blockOpen} ${BLOCK_START}`;
        close = `${BLOCK_END} ${spec.blockClose}`;
    }
    else {
        return null;
    }
    const first = lineAt(text, pos);
    if (first.content.trimEnd() !== open || !first.terminated)
        return null;
    let cursor = first.next;
    while (cursor < text.length) {
        const line = lineAt(text, cursor);
        if (line.content.trimEnd() === close) {
            return { start: pos, blockEnd: cursor + line.content.length, end: line.next, delimiters: spec };
        }
        // Every line of a line-comment block is a comment; anything else is body.
        if (spec.strategy === "line-comment" && !line.content.trimStart().startsWith(spec.linePrefix))
            return null;
        cursor = line.next;
    }
    return null;
}
/**
 * The managed block at the head of `text`: at the carrier position, or at the legacy
 * byte-0 position (after a BOM) where the pre-ADR-057 writer put it in front of a
 * prologue. Sentinel text anywhere else is body (ADR-057, RC-002).
 */
function findHeadBlock(text, spec) {
    if (!isCommentStrategy(spec))
        return null;
    const bomLength = text.startsWith(BOM) ? BOM.length : 0;
    const position = carrierPosition(text, spec);
    const offsets = position && !position.unterminated && position.offset !== bomLength
        ? [position.offset, bomLength]
        : [bomLength];
    const forms = spec.legacyCarrier ? [spec, spec.legacyCarrier] : [spec];
    for (const offset of offsets) {
        for (const form of forms) {
            const span = blockAt(text, offset, form);
            if (!span)
                continue;
            let removeFrom = span.start;
            // Insertion supplied the prologue's missing terminator and wrote no newline
            // after the block: remove that terminator again so strip(inject(x)) === x.
            if (span.end === text.length && span.end === span.blockEnd && offset > bomLength) {
                const crlf = text.slice(offset - 2, offset) === "\r\n"
                    && detectNewlineConvention(text.slice(0, offset - 2)) === "\r\n";
                removeFrom = offset - (crlf ? 2 : 1);
            }
            return { ...span, removeFrom };
        }
    }
    return null;
}
/** Remove a previously-injected comment block, returning the clean body verbatim. */
function stripInjectedBlock(raw, spec) {
    const head = findHeadBlock(raw, spec);
    return head ? raw.slice(0, head.removeFrom) + raw.slice(head.end) : raw;
}
/** Detect whether a comment-injected block is present at the carrier position. */
function hasInjectedBlock(raw, spec) {
    return findHeadBlock(raw, spec) !== null;
}
/** Extract the inner YAML from an existing comment block (comment prefixes removed), or null. */
function extractInjectedYaml(raw, spec) {
    const head = findHeadBlock(raw, spec);
    if (!head)
        return null;
    // Split on either convention: a CRLF file's block would otherwise keep a
    // trailing `\r` on every value and fail to round-trip on the next run.
    const inner = raw.slice(head.start, head.blockEnd).split(/\r?\n/).slice(1, -1);
    if (head.delimiters.strategy === "line-comment") {
        const p = head.delimiters.linePrefix;
        return inner.map((l) => l.replace(new RegExp(String.raw `^\s*${esc(p)} ?`), "")).join("\n").trim();
    }
    return inner.join("\n").trim();
}
/**
 * Assemble the injected file for comment strategies, preserving cleanBody verbatim
 * and placing the block at the carrier position: after a BOM, a shebang and the
 * spec's mandatory prologue. Recoverable via stripInjectedBlock with the same spec.
 * Without a spec only a BOM and a shebang are honoured.
 *
 * A byte-order mark stays at byte 0: the block is inserted after it, never before,
 * because a BOM in the middle of a file is no longer a BOM. Line endings around
 * the block follow `newline`, so a CRLF file keeps a single convention. When the
 * last prologue line has no terminator, one is supplied and no newline follows the
 * block, which is how strip knows to remove it again.
 */
function applyCommentInjection(cleanBody, block, newline = "\n", spec) {
    const position = carrierPosition(cleanBody, spec);
    if (!position) {
        throw new Error(`applyCommentInjection: no inert carrier position for prologue '${spec?.prologue ?? "none"}'; resolveStrategy routes such a file to a sidecar`);
    }
    if (position.unterminated)
        return `${cleanBody}${newline}${block}`;
    return `${cleanBody.slice(0, position.offset)}${block}${newline}${cleanBody.slice(position.offset)}`;
}
//# sourceMappingURL=comment.js.map