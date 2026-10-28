"use strict";
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
exports.toSnakeStem = toSnakeStem;
exports.resolveNamespace = resolveNamespace;
// namespace.ts — Deterministic path → namespace + sharing_scope + primitive_folder
const path = __importStar(require("node:path"));
const comment_1 = require("./comment");
const SHARED_SIGNALS = new Set(["_shared", "shared", "core", "common", "universal"]);
const PRIVATE_SIGNALS = new Set(["l9", "plastos", "legal", "ops", "private"]);
function matchGlob(filePath, glob) {
    const norm = filePath.replace(/\\/g, "/");
    // Escape EVERY regex metacharacter first, then re-introduce glob wildcards.
    // Previously only "." was escaped, so a glob containing "[", "(", "+", "\\", …
    // reached RegExp and could throw (DoS) or backtrack (ReDoS) — finding SEC-002.
    const pat = glob
        .replace(/[.*+?^${}()|[\]\\]/g, String.raw `\$&`) // escape all metachars (including the "*" re-added next)
        .replace(/\\\*\\\*/g, "DSTAR") // "**" (now "\*\*") → cross-segment placeholder
        .replace(/\\\*/g, "[^/]*") // "*"  (now "\*")   → single-segment wildcard
        .replace(/DSTAR/g, ".*");
    try {
        return new RegExp(`(^|/)${pat}($|/)`).test(norm);
    }
    catch {
        return false; // a malformed glob never matches, rather than throwing
    }
}
function deriveSharingScope(filePath) {
    // Shared/private-scope signal words are a *prose taxonomy* convention (a namespace-wide
    // "this primitive is shared" folder like `_shared/` or `l9/`) — the exact same restriction
    // classify.ts already applies to its own path-pattern taxonomy heuristics (see the comment
    // at classify.ts's FRONTMATTER_EXTS check): they must not be applied to code/config files.
    // Without this guard, a generic English word like "core" or "common" used as an internal
    // implementation-detail folder name (e.g. a legacy tool's own `core/` module, unrelated to
    // any namespace-sharing convention) silently flips sharing_scope for arbitrary source files,
    // which the assurance gate (verify.ts checkSharingScope) then reports as a false violation.
    if (!comment_1.FRONTMATTER_EXTS.has(path.extname(filePath).toLowerCase()))
        return "agnostic";
    const parts = filePath.replace(/\\/g, "/").toLowerCase().split("/");
    if (parts.some((p) => SHARED_SIGNALS.has(p)))
        return "shared";
    if (parts.some((p) => PRIVATE_SIGNALS.has(p)))
        return "private";
    return "agnostic";
}
function derivePrimitiveFolder(filePath) {
    const base = path.basename(filePath).toLowerCase();
    const dot = /\.(skill|playbook|kernel|context|prompt|doctrine|test|script)\./.exec(base);
    if (dot)
        return dot[1];
    const norm = filePath.replace(/\\/g, "/").toLowerCase();
    // A leading slash makes a top-level folder (`skills/x.md`) match the same way a
    // nested one (`repo/skills/x.md`) does. `includes("/skills/")` misses the first.
    const bounded = `/${norm.replace(/^\/+/, "")}`;
    const segMap = {
        skills: "skill", playbooks: "playbook", kernels: "kernel", contexts: "context",
        prompts: "prompt", doctrines: "doctrine", tests: "test", scripts: "script",
    };
    for (const [seg, prim] of Object.entries(segMap)) {
        if (bounded.includes(`/${seg}/`))
            return prim;
    }
    if (/^prompt-/i.test(path.basename(filePath)))
        return "prompt";
    return "unknown";
}
/**
 * Represent every non-ASCII code point as the ASCII token `u<lowercase hex>`, set off
 * by `_` (ADR-071). The code point is lower-cased first, so case folding matches the
 * ASCII rules (`É` and `é` are one token); a lower-case form that is ASCII stays a
 * plain character.
 */
function encodeNonAscii(value) {
    let encoded = "";
    for (const char of value) {
        if (char.charCodeAt(0) < 0x80) {
            encoded += char;
            continue;
        }
        for (const folded of char.toLowerCase()) {
            const codePoint = folded.codePointAt(0) ?? 0;
            encoded += codePoint < 0x80 ? folded : `_u${codePoint.toString(16)}_`;
        }
    }
    return encoded;
}
/**
 * Identity segment rules. ASCII follows the {@link toSnakeStem} character rules, without
 * stripping an extension. Non-ASCII is represented instead of erased (ADR-071, amending
 * ADR-054 item 1): the segment is NFC-normalised so composed and decomposed spellings
 * agree, whitespace stays a separator, and each remaining non-ASCII code point becomes an
 * ASCII token, so ids keep to `[a-z0-9_]` and ASCII-only segments are unchanged.
 */
function snakeSegment(value) {
    const separated = value.normalize("NFC").replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[-\s]+/g, "_");
    return encodeNonAscii(separated)
        .replace(/[^a-z0-9_]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}
/**
 * Path identity. The final extension is kept behind `__`, which {@link snakeSegment}
 * cannot emit because it collapses underscore runs. Files that differ only by
 * extension therefore stay distinct, and `file.md` stays distinct from an
 * extensionless `file_md`. An absolute input uses the basename, matching
 * `stableSourcePath`.
 */
function identityStem(filePath) {
    const posix = filePath.replace(/\\/g, "/");
    const target = path.posix.isAbsolute(posix) ? path.posix.basename(posix) : posix;
    const baseName = path.posix.basename(target);
    const extWithDot = path.posix.extname(baseName);
    const ext = extWithDot.startsWith(".") ? extWithDot.slice(1).toLowerCase() : "";
    const withoutExt = ext ? target.slice(0, -extWithDot.length) : target;
    const body = withoutExt.split("/").map(snakeSegment).filter(Boolean).join("_");
    const extStem = ext ? snakeSegment(ext) : "";
    return extStem ? `${body}__${extStem}` : body;
}
function toSnakeStem(filename) {
    const stem = path.basename(filename, path.extname(filename))
        .replace(/^Prompt-/i, "")
        .replace(/\.[a-z]+$/i, "");
    return stem.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[-\s]+/g, "_")
        .replace(/[^a-z0-9_]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}
function resolveNamespace(filePath, cfg, typeHint) {
    const norm = filePath.replace(/\\/g, "/");
    let namespace = cfg.namespace ?? "l9";
    if (cfg.namespaceGlobs) {
        for (const e of cfg.namespaceGlobs) {
            if (matchGlob(norm, e.glob)) {
                namespace = e.namespace;
                break;
            }
        }
    }
    const sharingScope = deriveSharingScope(filePath);
    // Folder derivation wins; when the path yields no primitive folder, fall back to the
    // resolved artifact_type so the id reads e.g. l9.source.app rather than l9.unknown.app.
    let primitiveFolder = derivePrimitiveFolder(filePath);
    if (primitiveFolder === "unknown" && typeHint && typeHint !== "unknown")
        primitiveFolder = typeHint;
    const stem = identityStem(filePath);
    return { namespace, sharingScope, primitiveFolder, idStem: `${namespace}.${primitiveFolder}.${stem}` };
}
//# sourceMappingURL=namespace.js.map