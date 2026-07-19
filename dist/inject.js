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
exports.injectFileAsync = injectFileAsync;
exports.injectFile = injectFile;
// inject.ts — Filetype-aware metadata injection. Five-way reconciliation.
// Markdown → YAML frontmatter. Code/config → comment-wrapped block (line or
// block comment), placed after any shebang. Comment-less formats (JSON), .txt/.text,
// and unknown text → a `<file>.l9meta.yaml` sidecar (the file itself is untouched). Binary/media
// are skipped. Body is preserved verbatim; the injected block carries sentinels so a
// re-run replaces it instead of duplicating. Writes <file>.inject.log on any mutation.
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const schema_1 = require("./schema");
const normalize_meta_1 = require("./normalize_meta");
const extract_1 = require("./extract");
const reconcile_fields_1 = require("./reconcile_fields");
const llm_1 = require("./llm");
const meta_schema_1 = require("./meta_schema");
const comment_1 = require("./comment");
// Parse the inner YAML of an existing injected header into a plain object.
// Delegates to the canonical parser (meta_schema.ts) so all parsing rules —
// quoted-string escaping, inline lists, depth guards — are applied consistently.
// Returns {} on malformed input rather than throwing, to keep injection safe.
function parseExistingMeta(fm) {
    if (!fm)
        return {};
    const inner = fm.replace(/^---\s*\n/, "").replace(/\n?---\s*$/, "");
    try {
        const obj = (0, meta_schema_1.parseCanonicalYaml)(inner);
        // Normalize the typed BaseHeader fields (numbers/booleans) so the reconcile edge
        // compares against buildMeta's output like-for-like, not string-vs-number (ICC-005).
        return typeof obj === "object" && obj !== null ? (0, schema_1.normalizeMetaRecord)(obj) : {};
    }
    catch {
        return {};
    }
}
// Read the file and derive the clean body + any prior metadata, per strategy.
function readForInjection(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    const spec = (0, comment_1.resolveStrategy)(filePath, raw);
    if (spec.strategy === "yaml-frontmatter") {
        const { frontMatter } = (0, extract_1.splitContent)(raw);
        const cleanBody = (0, extract_1.stripExistingFrontMatter)(raw);
        return { raw, spec, cleanBody, originalBodyHash: (0, extract_1.contentHash)(cleanBody), existingMeta: parseExistingMeta(frontMatter) };
    }
    if (spec.strategy === "line-comment" || spec.strategy === "block-comment") {
        const cleanBody = (0, comment_1.stripInjectedBlock)(raw, spec);
        const existingYaml = (0, comment_1.extractInjectedYaml)(raw, spec);
        return { raw, spec, cleanBody, originalBodyHash: (0, extract_1.contentHash)(cleanBody), existingMeta: parseExistingMeta(existingYaml) };
    }
    // sidecar (and skip-binary, which callers guard against): file body is untouched.
    let existingMeta = {};
    const sidecar = (0, comment_1.sidecarPathFor)(filePath);
    if (fs.existsSync(sidecar))
        existingMeta = parseExistingMeta(fs.readFileSync(sidecar, "utf8"));
    return { raw, spec, cleanBody: raw, originalBodyHash: (0, extract_1.contentHash)(raw), existingMeta };
}
// Build the final content for the resolved strategy.
function buildInjection(filePath, finalMeta, ctx) {
    const yamlFm = (0, normalize_meta_1.serializeToYamlFrontMatter)(finalMeta);
    if (ctx.spec.strategy === "yaml-frontmatter") {
        const newContent = yamlFm + "\n\n" + ctx.cleanBody.replace(/^\n+/, "");
        const postBodyHash = (0, extract_1.contentHash)(newContent.slice(yamlFm.length + 2).replace(/^\n+/, ""));
        return { targetPath: filePath, newContent, addedLines: yamlFm, postBodyHash, strategy: ctx.spec.strategy };
    }
    if (ctx.spec.strategy === "line-comment" || ctx.spec.strategy === "block-comment") {
        const block = (0, comment_1.yamlToBlock)((0, comment_1.frontMatterInner)(yamlFm), ctx.spec);
        const newContent = (0, comment_1.applyCommentInjection)(ctx.cleanBody, block);
        const postBodyHash = (0, extract_1.contentHash)((0, comment_1.stripInjectedBlock)(newContent, ctx.spec));
        return { targetPath: filePath, newContent, addedLines: block, postBodyHash, strategy: ctx.spec.strategy };
    }
    // sidecar: source file is left byte-for-byte; metadata goes to <file>.l9meta.yaml
    const sidecar = (0, comment_1.sidecarPathFor)(filePath);
    return {
        targetPath: sidecar, newContent: yamlFm + "\n", addedLines: yamlFm,
        postBodyHash: ctx.originalBodyHash, sidecarPath: sidecar, strategy: ctx.spec.strategy,
    };
}
function writeInjection(filePath, built, diffs, opts) {
    const out = {};
    if (opts.dryRun) {
        fs.mkdirSync(opts.outDir, { recursive: true });
        out.dryRunDiffPath = path.join(opts.outDir, path.basename(filePath) + ".diff");
        const added = built.addedLines.split("\n").map((l) => `+ ${l}`).join("\n");
        const tgt = built.sidecarPath ? built.sidecarPath : filePath;
        fs.writeFileSync(out.dryRunDiffPath, `--- ${filePath}\n+++ ${tgt} (${built.strategy})\n${added}\n`, "utf8");
        if (opts.verbose)
            process.stderr.write(`[dry-run] ${out.dryRunDiffPath}\n`);
    }
    else {
        fs.writeFileSync(built.targetPath, built.newContent, "utf8");
        if (opts.writeInjectLog && diffs.some((d) => d.action !== "keep")) {
            out.injectLogPath = filePath + ".inject.log";
            fs.writeFileSync(out.injectLogPath, (0, reconcile_fields_1.diffsToLogYaml)(filePath, diffs, new Date().toISOString()), "utf8");
        }
        if (opts.verbose)
            process.stderr.write(`[inject:${built.strategy}] ${built.targetPath}\n`);
    }
    return out;
}
function record(filePath, ctx, built, finalMeta, opts, paths) {
    return {
        sourcePath: filePath,
        originalBodyHash: ctx.originalBodyHash,
        postInjectionBodyHash: built.postBodyHash,
        bodyPreserved: built.postBodyHash === ctx.originalBodyHash,
        headerInjected: !opts.dryRun,
        injectionStrategy: built.strategy,
        sidecarPath: built.sidecarPath,
        dryRunDiffPath: paths.dryRunDiffPath,
        injectLogPath: paths.injectLogPath,
        meta: finalMeta,
    };
}
async function injectFileAsync(filePath, meta, opts, metrics) {
    const ctx = readForInjection(filePath);
    // Widen the typed producer (NormalizedMeta) onto the shared reconcile-edge record
    // type instead of the untyped Object.fromEntries clone (ICC-005). reconcile reads
    // incoming without mutating it, so an alias is safe.
    const incomingMeta = (0, schema_1.asRecord)(meta);
    const { merged, diffs } = (0, llm_1.getAdapter)().classify
        ? await (0, reconcile_fields_1.reconcileFieldsAsync)(ctx.existingMeta, incomingMeta, metrics)
        : (0, reconcile_fields_1.reconcileFields)(ctx.existingMeta, incomingMeta);
    const finalMeta = { ...meta, ...merged };
    const built = buildInjection(filePath, finalMeta, ctx);
    const paths = writeInjection(filePath, built, diffs, opts);
    return record(filePath, ctx, built, finalMeta, opts, paths);
}
function injectFile(filePath, meta, opts) {
    const ctx = readForInjection(filePath);
    const { merged, diffs } = (0, reconcile_fields_1.reconcileFields)(ctx.existingMeta, (0, schema_1.asRecord)(meta));
    const finalMeta = { ...meta, ...merged };
    const built = buildInjection(filePath, finalMeta, ctx);
    const paths = writeInjection(filePath, built, diffs, opts);
    return record(filePath, ctx, built, finalMeta, opts, paths);
}
//# sourceMappingURL=inject.js.map