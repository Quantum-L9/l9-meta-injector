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
// retrieval.ts — File discovery and scan. Supports .md and .txt.
// .txt files are treated as pure prose: no frontmatter parsing, all fields via regex-seed + LLM assist.
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const extract_1 = require("./extract");
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt"]);
function findFiles(root, glob) {
    // Extract extension filter from glob pattern (e.g. **/*.md → .md, **/*.txt → .txt, **/* → all supported)
    const extMatch = glob.match(/\*\.([a-z]+)$/);
    const extFilter = extMatch ? `.${extMatch[1]}` : null;
    const results = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
                walk(path.join(dir, entry.name));
            }
            else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (extFilter ? entry.name.endsWith(extFilter) : SUPPORTED_EXTENSIONS.has(ext)) {
                    results.push(path.join(dir, entry.name));
                }
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
        // .txt is always headerConvention="none" — pure prose, no frontmatter
        const { frontMatter, headerConvention, body } = ext === ".txt"
            ? { frontMatter: null, headerConvention: "none", body: raw }
            : (0, extract_1.splitContent)(raw);
        return {
            sourcePath: fp, fileName: path.basename(fp), sizeBytes: stat.size,
            headerConvention: headerConvention,
            bodyStructure: detectBodyStructure(body),
            hasExistingFrontMatter: frontMatter !== null,
        };
    });
}
//# sourceMappingURL=retrieval.js.map