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
exports.findFiles = findFiles;
exports.scanFiles = scanFiles;
// retrieval.ts — File discovery and scan. Supports every text filetype in a repo.
// A glob ending in `*.ext` filters to that extension; otherwise all text files are
// returned (binary/media extensions excluded, and unknown extensions null-byte-sniffed).
// Markdown/frontmatter files parse their header; everything else defers to the
// filetype-aware injection strategy (see comment.ts).
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const extract_1 = require("./extract");
const comment_1 = require("./comment");
/** Injector-generated artifacts must never be re-discovered as inputs. */
function isGeneratedArtifact(name) {
    return name.endsWith(".inject.log") || name.endsWith(".l9meta.yaml");
}
/** Read a small prefix and report whether it looks binary (has a NUL byte). */
function looksBinaryOnDisk(filePath) {
    let fd = null;
    try {
        fd = fs.openSync(filePath, "r");
        const buf = Buffer.alloc(8192);
        const n = fs.readSync(fd, buf, 0, 8192, 0);
        for (let i = 0; i < n; i++)
            if (buf[i] === 0)
                return true;
        return false;
    }
    catch {
        return true;
    }
    finally {
        if (fd !== null)
            fs.closeSync(fd);
    }
}
function findFiles(root, glob) {
    // Extract extension filter from glob pattern (e.g. **/*.md → .md). No `*.ext`
    // suffix (e.g. **/*) → every text file the injector can safely annotate.
    const extMatch = glob.match(/\*\.([a-z0-9]+)$/i);
    const extFilter = extMatch ? `.${extMatch[1].toLowerCase()}` : null;
    const results = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
                walk(path.join(dir, entry.name));
            }
            else if (entry.isFile()) {
                if (isGeneratedArtifact(entry.name))
                    continue; // skip our own .inject.log / .l9meta.yaml
                const full = path.join(dir, entry.name);
                const ext = path.extname(entry.name).toLowerCase();
                if (extFilter && !entry.name.toLowerCase().endsWith(extFilter))
                    continue; // filtered out
                // Cheap ext-based strategy check first; only sniff the bytes when the
                // extension is unknown (sidecar fallback). This runs for filtered globs
                // too, so a glob like **/*.foo over binary content is still excluded.
                const spec = (0, comment_1.resolveStrategy)(full, ""); // ext-only decision (empty content)
                if (spec.strategy === "skip-binary")
                    continue; // known binary/media extension
                const knownText = comment_1.FRONTMATTER_EXTS.has(ext)
                    || spec.strategy === "line-comment"
                    || spec.strategy === "block-comment";
                if (!knownText && looksBinaryOnDisk(full))
                    continue; // unknown ext: exclude binaries
                results.push(full);
            }
        }
    }
    if (fs.existsSync(root))
        walk(root);
    return results;
}
function detectBodyStructure(body) {
    if (/^##\s+/m.test(body))
        return "sections";
    if (/\|.+\|.+\|/.test(body))
        return "table-driven";
    if (body.trim().length > 0)
        return "flat";
    return "unknown";
}
function scanFiles(filePaths) {
    return filePaths.map((fp) => {
        const raw = fs.readFileSync(fp, "utf8");
        const stat = fs.statSync(fp);
        const ext = path.extname(fp).toLowerCase();
        // Only markdown-family files carry YAML frontmatter. .txt and all non-prose
        // filetypes are headerConvention="none" (their metadata rides in comment blocks
        // or a sidecar, resolved at injection time).
        const isFrontmatter = comment_1.FRONTMATTER_EXTS.has(ext) && ext !== ".txt" && ext !== ".text";
        const { frontMatter, headerConvention, body } = isFrontmatter
            ? (0, extract_1.splitContent)(raw)
            : { frontMatter: null, headerConvention: "none", body: raw };
        return {
            sourcePath: fp, fileName: path.basename(fp), sizeBytes: stat.size,
            headerConvention: headerConvention,
            bodyStructure: detectBodyStructure(body),
            hasExistingFrontMatter: frontMatter !== null,
        };
    });
}
//# sourceMappingURL=retrieval.js.map