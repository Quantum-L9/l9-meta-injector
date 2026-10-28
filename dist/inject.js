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
exports.managedCarrierFreeBody = managedCarrierFreeBody;
exports.injectFileAsync = injectFileAsync;
exports.injectFile = injectFile;
// inject.ts — Filetype-aware metadata injection. Five-way reconciliation.
// Markdown → YAML frontmatter. Code/config → comment-wrapped block (line or
// block comment), placed after any shebang. Comment-less formats (JSON), .txt/.text,
// and unknown text → a `<file>.l9meta.yaml` sidecar (the file itself is untouched). Binary/media
// are skipped. Body is preserved verbatim; the injected block carries sentinels so a
// re-run replaces it instead of duplicating. Writes <file>.inject.log on any mutation.
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const schema_1 = require("./schema");
const normalize_meta_1 = require("./normalize_meta");
const extract_1 = require("./extract");
const encoding_1 = require("./encoding");
const reconcile_fields_1 = require("./reconcile_fields");
const llm_1 = require("./llm");
const meta_schema_1 = require("./meta_schema");
const frontmatter_patch_1 = require("./frontmatter_patch");
const comment_1 = require("./comment");
const yaml_serialize_1 = require("./yaml_serialize");
const durable_write_1 = require("./durable_write");
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
/**
 * Body bytes that identity hashes describe: the file with the L9 managed
 * carrier removed. Frontmatter uses the body after the fences; comment
 * strategies use `stripInjectedBlock`; sidecar and skip-binary use the raw
 * text. An unsafe frontmatter document is returned unchanged so inventory
 * can still hash it; `injectFile` refuses that case separately.
 */
function managedCarrierFreeBody(filePath, raw) {
    const spec = (0, comment_1.resolveStrategy)(filePath, raw);
    if (spec.strategy === "yaml-frontmatter") {
        const inspected = (0, frontmatter_patch_1.inspectFrontMatterDocument)(raw);
        return inspected.safe ? inspected.body : raw;
    }
    if (spec.strategy === "line-comment" || spec.strategy === "block-comment") {
        return (0, comment_1.stripInjectedBlock)(raw, spec);
    }
    return raw;
}
// Read the file and derive the clean body + any prior metadata, per strategy.
function readForInjection(filePath) {
    // Injection rewrites the whole file, so eligibility is decided over the whole
    // file. Decoding non-UTF-8 bytes here would substitute replacement characters
    // and then write them back, silently destroying the original encoding; a
    // filetype that "looks textual" is not evidence that its bytes are UTF-8.
    const encoding = (0, encoding_1.probeFileEncoding)(filePath);
    if (encoding.status !== "utf8") {
        throw new Error(`UNSUPPORTED_ENCODING: ${filePath}: ${encoding.reason}`);
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const spec = (0, comment_1.resolveStrategy)(filePath, raw);
    if (spec.strategy === "yaml-frontmatter") {
        const inspected = (0, frontmatter_patch_1.inspectFrontMatterDocument)(raw);
        if (!inspected.safe) {
            throw new Error(`FRONTMATTER_UNSAFE: ${filePath}: ${inspected.issue?.code ?? "unknown"}: ${inspected.issue?.message ?? "unsafe header"}`);
        }
        const cleanBody = managedCarrierFreeBody(filePath, raw);
        return {
            raw,
            spec,
            cleanBody,
            originalBodyHash: (0, extract_1.contentHash)(cleanBody),
            // Opaque values join reconciliation as their verbatim text (RC-004); they still
            // never enter `inspected.meta` (ADR-035).
            existingMeta: (0, schema_1.normalizeMetaRecord)((0, frontmatter_patch_1.frontMatterReconciliationView)(raw, inspected)),
        };
    }
    if (spec.strategy === "line-comment" || spec.strategy === "block-comment") {
        const cleanBody = managedCarrierFreeBody(filePath, raw);
        const existingYaml = (0, comment_1.extractInjectedYaml)(raw, spec);
        return { raw, spec, cleanBody, originalBodyHash: (0, extract_1.contentHash)(cleanBody), existingMeta: parseExistingMeta(existingYaml) };
    }
    // sidecar (and skip-binary, which callers guard against): file body is untouched.
    let existingMeta = {};
    const sidecar = (0, comment_1.sidecarPathFor)(filePath);
    if (fs.existsSync(sidecar))
        existingMeta = parseExistingMeta(fs.readFileSync(sidecar, "utf8"));
    const cleanBody = managedCarrierFreeBody(filePath, raw);
    return { raw, spec, cleanBody, originalBodyHash: (0, extract_1.contentHash)(cleanBody), existingMeta };
}
// Build the final content for the resolved strategy.
function buildInjection(filePath, finalMeta, ctx) {
    const yamlFm = (0, normalize_meta_1.serializeToYamlFrontMatter)(finalMeta);
    if (ctx.spec.strategy === "yaml-frontmatter") {
        const patched = (0, frontmatter_patch_1.patchManagedFrontMatter)(ctx.raw, (0, schema_1.asRecord)(finalMeta));
        if (!patched.safe) {
            throw new Error(`FRONTMATTER_UNSAFE: ${filePath}: ${patched.issue?.code ?? "unknown"}: ${patched.issue?.message ?? "unsafe header"}`);
        }
        return {
            targetPath: filePath,
            newContent: patched.content,
            addedLines: yamlFm,
            postBodyHash: (0, extract_1.contentHash)(patched.body),
            strategy: ctx.spec.strategy,
        };
    }
    if (ctx.spec.strategy === "line-comment" || ctx.spec.strategy === "block-comment") {
        // The block adopts the file's own line-ending convention and sits after any
        // BOM, so the only bytes that change are the block's (DATA-002).
        const newline = (0, comment_1.detectNewlineConvention)(ctx.cleanBody);
        // Values are escaped for this carrier so none can end or invalidate the host
        // comment (ADR-057); benign values serialize exactly as in `yamlFm`.
        const inner = (0, yaml_serialize_1.serializeYamlObject)((0, schema_1.asRecord)(finalMeta), { fences: false, forbidden: (0, comment_1.carrierForbiddenSequences)(ctx.spec) });
        const block = (0, comment_1.yamlToBlock)(inner, ctx.spec, newline);
        const newContent = (0, comment_1.applyCommentInjection)(ctx.cleanBody, block, newline, ctx.spec);
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
/** Mirrored dry-run path. Refuses a source_path that would leave outDir. */
function containedDiffPath(outDir, sourcePath) {
    const posix = sourcePath.split(path.sep).join("/");
    const segments = posix.split("/");
    if (!posix || posix === "." || posix.startsWith("/") || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
        throw new Error(`dry-run diff escapes output directory: ${sourcePath}`);
    }
    const leaf = segments[segments.length - 1];
    segments[segments.length - 1] = `${leaf}.diff`;
    const diffPath = path.resolve(outDir, ...segments);
    const root = path.resolve(outDir);
    const relative = path.relative(root, diffPath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`dry-run diff escapes output directory: ${sourcePath}`);
    }
    return diffPath;
}
function writeInjection(filePath, built, diffs, opts, sourcePath) {
    // Capture target state before any write. This keeps the plan truthful in both
    // read-only check mode and future apply mode, where reading after the write
    // would incorrectly report wouldChange=false.
    const targetExists = fs.existsSync(built.targetPath);
    const actualContent = targetExists ? fs.readFileSync(built.targetPath, "utf8") : undefined;
    const out = {
        targetExists,
        wouldChange: actualContent !== built.newContent,
        expectedContentHash: (0, extract_1.contentHash)(built.newContent),
        actualContentHash: actualContent === undefined ? undefined : (0, extract_1.contentHash)(actualContent),
    };
    if (opts.dryRun) {
        if (opts.writeDryRunDiff !== false) {
            out.dryRunDiffPath = containedDiffPath(opts.outDir, sourcePath);
            fs.mkdirSync(path.dirname(out.dryRunDiffPath), { recursive: true });
            const added = built.addedLines.split("\n").map((l) => `+ ${l}`).join("\n");
            const tgt = built.sidecarPath ? built.sidecarPath : filePath;
            fs.writeFileSync(out.dryRunDiffPath, `--- ${filePath}\n+++ ${tgt} (${built.strategy})\n${added}\n`, "utf8");
            if (opts.verbose)
                process.stderr.write(`[dry-run] ${out.dryRunDiffPath}\n`);
        }
    }
    else {
        // Staged beside the target and renamed in: the source is never truncated
        // mid-write, and a hard link to it elsewhere keeps its old bytes. A target
        // whose bytes already equal the rendering is left alone (ADR-060): replacing
        // it would change nothing but its inode, mtime and birthtime, which is how an
        // annotation used to describe its own previous write instead of the file.
        if (out.wouldChange)
            (0, durable_write_1.replaceFileAtomically)(built.targetPath, built.newContent);
        if (opts.writeInjectLog && diffs.some((d) => d.action !== "keep")) {
            out.injectLogPath = filePath + ".inject.log";
            (0, durable_write_1.replaceFileAtomically)(out.injectLogPath, (0, reconcile_fields_1.diffsToLogYaml)(filePath, diffs, new Date().toISOString()));
        }
        if (opts.verbose)
            process.stderr.write(`[inject:${built.strategy}] ${built.targetPath}\n`);
    }
    return out;
}
function record(filePath, ctx, built, finalMeta, opts, paths) {
    return {
        sourcePath: filePath,
        targetPath: built.targetPath,
        targetExists: paths.targetExists,
        wouldChange: paths.wouldChange,
        expectedContentHash: paths.expectedContentHash,
        actualContentHash: paths.actualContentHash,
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
function finalizeInjectionMeta(meta, merged, reconcileExisting) {
    if (reconcileExisting === false)
        return meta;
    return { ...meta, ...merged };
}
async function injectFileAsync(filePath, meta, opts, metrics) {
    const ctx = readForInjection(filePath);
    // Widen the typed producer (NormalizedMeta) onto the shared reconcile-edge record
    // type instead of the untyped Object.fromEntries clone (ICC-005). reconcile reads
    // incoming without mutating it, so an alias is safe.
    const incomingMeta = (0, schema_1.asRecord)(meta);
    const skipReconcile = opts.reconcileExisting === false;
    const { merged, diffs } = skipReconcile
        ? { merged: incomingMeta, diffs: [] }
        : (0, llm_1.getAdapter)().classify
            ? await (0, reconcile_fields_1.reconcileFieldsAsync)(ctx.existingMeta, incomingMeta, metrics)
            : (0, reconcile_fields_1.reconcileFields)(ctx.existingMeta, incomingMeta);
    const finalMeta = finalizeInjectionMeta(meta, merged, opts.reconcileExisting !== false);
    const built = buildInjection(filePath, finalMeta, ctx);
    const paths = writeInjection(filePath, built, diffs, opts, finalMeta.source_path);
    return record(filePath, ctx, built, finalMeta, opts, paths);
}
function injectFile(filePath, meta, opts) {
    const ctx = readForInjection(filePath);
    const incomingMeta = (0, schema_1.asRecord)(meta);
    const skipReconcile = opts.reconcileExisting === false;
    const { merged, diffs } = skipReconcile
        ? { merged: incomingMeta, diffs: [] }
        : (0, reconcile_fields_1.reconcileFields)(ctx.existingMeta, incomingMeta);
    const finalMeta = finalizeInjectionMeta(meta, merged, opts.reconcileExisting !== false);
    const built = buildInjection(filePath, finalMeta, ctx);
    const paths = writeInjection(filePath, built, diffs, opts, finalMeta.source_path);
    return record(filePath, ctx, built, finalMeta, opts, paths);
}
//# sourceMappingURL=inject.js.map