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
exports.classifyInventory = classifyInventory;
exports.buildRecord = buildRecord;
exports.inventoryTree = inventoryTree;
// inventory.ts — Filesystem/Dropbox inventory mode.
// Non-destructive: classifies every file AND folder under a root, appends metadata
// headers to text files (reusing the filetype-aware injector), writes a metadata
// sidecar for binaries and for folders, and emits a single inventory manifest
// (JSON + CSV + MD) using the ArtifactInventory record shape. Never moves, renames,
// or deletes anything.
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const extract_1 = require("./extract");
const comment_1 = require("./comment");
const inject_1 = require("./inject");
const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".rb", ".php", ".swift", ".kt", ".kts", ".scala", ".sh", ".bash", ".zsh", ".lua", ".r", ".jl", ".pl", ".pm", ".dart", ".ex", ".exs"]);
const CONFIG_EXTS = new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties", ".env", ".lock", ".plist", ".tf", ".tfvars"]);
const ARCHIVE_EXTS = new Set([".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".jar", ".war"]);
const DOC_EXTS = new Set([".txt", ".rst", ".doc", ".docx", ".rtf", ".odt", ".pages"]);
const MIME = {
    ".md": "text/markdown", ".txt": "text/plain", ".pdf": "application/pdf",
    ".json": "application/json", ".yaml": "application/yaml", ".yml": "application/yaml",
    ".csv": "text/csv", ".html": "text/html", ".xml": "application/xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".svg": "image/svg+xml", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".zip": "application/zip",
    ".ts": "text/x-typescript", ".js": "text/javascript", ".py": "text/x-python",
};
/** Deterministic, evidence-based classification into the ArtifactInventory taxonomy. */
function classifyInventory(relPath, fileName, ext, isDir) {
    if (isDir)
        return { type: "folder", confidence: 1, evidence: "directory entry", unknowns: [] };
    const fn = fileName.toLowerCase();
    const norm = relPath.replace(/\\/g, "/").toLowerCase();
    const e = ext.toLowerCase();
    if (/\.schema\.(json|ya?ml)$/.test(fn) || fn.endsWith(".schema.json"))
        return { type: "schema", confidence: 0.92, evidence: "schema filename convention", unknowns: [] };
    if (/\.(test|spec)\.[a-z0-9]+$/.test(fn) || /(^|\/)(tests?|__tests__|spec)\//.test(norm))
        return { type: "test", confidence: 0.85, evidence: "test filename/path", unknowns: [] };
    if (/^prompt[-_]/i.test(fileName) || /(^|\/)prompts?\//.test(norm))
        return { type: "prompt", confidence: 0.85, evidence: "prompt filename/path", unknowns: [] };
    if (ARCHIVE_EXTS.has(e))
        return { type: "archive", confidence: 0.95, evidence: `archive extension ${e}`, unknowns: [] };
    if (e === ".pdf")
        return { type: "research_pdf", confidence: 0.9, evidence: "pdf document", unknowns: [] };
    if (CODE_EXTS.has(e))
        return { type: "code", confidence: 0.9, evidence: `code extension ${e}`, unknowns: [] };
    if (/(^|\/|[-_])spec([-_.]|s?\/)/.test(norm) && (e === ".md" || e === ".markdown" || e === ".yaml" || e === ".yml"))
        return { type: "spec", confidence: 0.7, evidence: "spec naming", unknowns: [] };
    if (CONFIG_EXTS.has(e))
        return { type: "config", confidence: 0.8, evidence: `config extension ${e}`, unknowns: [] };
    if (e === ".md" || e === ".markdown" || e === ".mdx") {
        if (/(^|\/)(research|notes?|papers?)\//.test(norm))
            return { type: "research_markdown", confidence: 0.75, evidence: "markdown under research/notes path", unknowns: [] };
        return { type: "documentation", confidence: 0.6, evidence: "markdown document", unknowns: [] };
    }
    if (DOC_EXTS.has(e))
        return { type: "documentation", confidence: 0.7, evidence: `document extension ${e}`, unknowns: [] };
    return { type: "unknown", confidence: 0.2, evidence: "no recognized signal", unknowns: [e ? `unrecognized_extension:${e}` : "no_extension"] };
}
function idFor(relPath) {
    return "inv-" + (0, extract_1.contentHash)(relPath).slice(0, 16);
}
function csvCell(v) {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function serializeYaml(rec) {
    const lines = ["---"];
    for (const [k, v] of Object.entries(rec)) {
        if (Array.isArray(v)) {
            if (v.length === 0)
                lines.push(`${k}: []`);
            else {
                lines.push(`${k}:`);
                v.forEach((i) => lines.push(`  - ${JSON.stringify(i)}`));
            }
        }
        else
            lines.push(`${k}: ${v === null ? "null" : JSON.stringify(v)}`);
    }
    lines.push("---");
    return lines.join("\n") + "\n";
}
function walk(root, ignore) {
    const out = [];
    function rec(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (ignore.has(e.name))
                    continue;
                out.push({ abs, isDir: true });
                rec(abs);
            }
            else if (e.isFile()) {
                out.push({ abs, isDir: false });
            }
        }
    }
    rec(root);
    return out;
}
function buildRecord(root, abs, isDir, cfg) {
    const relative = path.relative(root, abs).split(path.sep).join("/") || ".";
    const fileName = path.basename(abs);
    const ext = isDir ? "" : path.extname(abs);
    const cls = classifyInventory(relative, fileName, ext, isDir);
    let size = null, modified = null, hash = null;
    const unknowns = [...cls.unknowns];
    try {
        const st = fs.statSync(abs);
        size = isDir ? null : st.size;
        modified = st.mtime.toISOString();
        if (!isDir && size !== null && size <= cfg.hashMaxBytes) {
            hash = (0, extract_1.contentHash)(fs.readFileSync(abs, "utf8"));
        }
        else if (!isDir && size !== null) {
            unknowns.push("content_hash_skipped:file_too_large");
        }
    }
    catch (err) {
        unknowns.push(`stat_failed:${err.message}`);
    }
    const parent = path.dirname(relative);
    return {
        artifact_id: idFor(relative),
        source_system: cfg.sourceSystem,
        absolute_path: abs,
        relative_path: relative,
        file_name: fileName,
        extension: ext || null,
        artifact_type: cls.type,
        mime_type: isDir ? "inode/directory" : (MIME[ext.toLowerCase()] ?? null),
        size_bytes: size,
        modified_at: modified,
        content_hash: hash,
        parent_folder: parent === "" || parent === "." ? null : parent,
        depth: relative === "." ? 0 : relative.split("/").length,
        classification_confidence: cls.confidence,
        evidence_excerpt: cls.evidence,
        unknowns,
        created_at: cfg.now,
    };
}
/** Run a non-destructive inventory over a filesystem root. */
function inventoryTree(config) {
    const cfg = {
        sourceSystem: config.sourceSystem ?? "local",
        dryRun: config.dryRun ?? false,
        injectHeaders: config.injectHeaders ?? true,
        folderSidecars: config.folderSidecars ?? true,
        hashMaxBytes: config.hashMaxBytes ?? 50 * 1024 * 1024,
        ignore: new Set(config.ignore ?? ["node_modules", ".git"]),
        now: config.now ?? "1970-01-01T00:00:00.000Z",
    };
    const root = config.root;
    const entries = walk(root, cfg.ignore);
    const records = [];
    const typeDistribution = {};
    let files = 0, folders = 0;
    for (const { abs, isDir } of entries) {
        const rec = buildRecord(root, abs, isDir, cfg);
        records.push(rec);
        typeDistribution[rec.artifact_type] = (typeDistribution[rec.artifact_type] || 0) + 1;
        if (isDir)
            folders++;
        else
            files++;
        if (cfg.dryRun)
            continue;
        if (isDir) {
            if (cfg.folderSidecars) {
                try {
                    fs.writeFileSync(path.join(abs, ".l9meta.yaml"), serializeYaml(rec), "utf8");
                }
                catch { /* unwritable dir — recorded, skip */ }
            }
            continue;
        }
        // Files: text files get an inline header via the filetype-aware injector;
        // binaries / comment-less formats get a metadata sidecar. Body is preserved.
        const raw = safeRead(abs);
        const strategy = raw === null ? "skip-binary" : (0, comment_1.resolveStrategy)(abs, raw).strategy;
        if (cfg.injectHeaders && raw !== null && (strategy === "yaml-frontmatter" || strategy === "line-comment" || strategy === "block-comment")) {
            try {
                (0, inject_1.injectFile)(abs, recordAsMeta(rec), { dryRun: false, outDir: config.outDir, verbose: false, writeInjectLog: false });
            }
            catch {
                writeSidecar(abs, rec);
            }
        }
        else {
            writeSidecar(abs, rec);
        }
    }
    const manifestPaths = writeManifests(config.outDir, root, records, typeDistribution, cfg.now, cfg.dryRun);
    return { root, total: records.length, files, folders, typeDistribution, manifestPaths, records };
}
function safeRead(abs) {
    try {
        const buf = fs.readFileSync(abs);
        const n = Math.min(buf.length, 8192);
        for (let i = 0; i < n; i++)
            if (buf[i] === 0)
                return null; // binary
        return buf.toString("utf8");
    }
    catch {
        return null;
    }
}
function writeSidecar(abs, rec) {
    try {
        fs.writeFileSync((0, comment_1.sidecarPathFor)(abs), serializeYaml(rec), "utf8");
    }
    catch { /* unwritable — recorded in manifest only */ }
}
// Map an InventoryRecord onto the minimal header the injector serializes. The injector
// preserves the file body and reconciles fields; inventory only needs the identity block.
function recordAsMeta(rec) {
    return {
        id: rec.artifact_id,
        title: rec.file_name,
        artifact_type: "source",
        mcp_primitive: "resource",
        callable: false,
        retrievable: true,
        injectable: true,
        namespace: "inventory",
        sharing_scope: "agnostic",
        source_path: rec.relative_path,
        content_hash: rec.content_hash ?? "Unknown",
        token_cost_estimate: 0,
        authority: "inventory",
        created_or_detected_at: rec.created_at ?? "Unknown",
        // inventory-specific fields ride along; reconcile/serialize keep them verbatim
        inventory_type: rec.artifact_type,
        classification_confidence: rec.classification_confidence,
        evidence: rec.evidence_excerpt ?? "Unknown",
    };
}
function writeManifests(outDir, root, records, dist, now, dryRun) {
    fs.mkdirSync(outDir, { recursive: true });
    const jsonPath = path.join(outDir, "inventory.json");
    const csvPath = path.join(outDir, "inventory.csv");
    const mdPath = path.join(outDir, "inventory.md");
    fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: now, root, total: records.length, typeDistribution: dist, records }, null, 2), "utf8");
    const cols = ["relative_path", "file_name", "extension", "artifact_type", "size_bytes", "modified_at", "content_hash", "depth", "classification_confidence", "evidence_excerpt", "unknowns"];
    const rows = [cols.join(",")];
    for (const r of records)
        rows.push(cols.map((c) => csvCell(Array.isArray(r[c]) ? r[c].join("; ") : r[c])).join(","));
    fs.writeFileSync(csvPath, rows.join("\n") + "\n", "utf8");
    const md = [`# Inventory — ${root}`, ``, `Generated: ${now}  |  Total entries: ${records.length}`, ``, `## Type distribution`, ``, ...Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- **${k}**: ${v}`), ``, `## Entries`, ``, `| path | type | conf | size | evidence |`, `|---|---|---|---|---|`, ...records.slice(0, 500).map((r) => `| ${r.relative_path} | ${r.artifact_type} | ${r.classification_confidence} | ${r.size_bytes ?? ""} | ${r.evidence_excerpt ?? ""} |`)];
    if (records.length > 500)
        md.push(``, `_(${records.length - 500} more entries in inventory.json / inventory.csv)_`);
    fs.writeFileSync(mdPath, md.join("\n") + "\n", "utf8");
    if (dryRun) { /* manifests still written; source untouched */ }
    return { json: jsonPath, csv: csvPath, md: mdPath };
}
//# sourceMappingURL=inventory.js.map