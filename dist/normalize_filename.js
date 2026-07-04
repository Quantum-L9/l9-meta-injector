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
exports.toSnakeCase = toSnakeCase;
exports.normalizeFilename = normalizeFilename;
exports.normalizeFilenameWithLog = normalizeFilenameWithLog;
exports.normalizeFilenames = normalizeFilenames;
// normalize_filename.ts — Normalize .md filenames to snake_case; write sidecar .normalize.log.yaml
// --dry-run: write sidecar only, never rename. Live: sidecar + rename flag (rename is a separate pass).
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
function toSnakeCase(s) {
    return s.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[-\s]+/g, "_")
        .replace(/[^a-z0-9_.]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}
function normalizeFilename(filePath) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    // Preserve dot-convention prefix: ns.primitive.Stem.md → ns.primitive.snake_stem.md
    const dotMatch = stem.match(/^([a-z_]+\.[a-z_]+\.)(.+)$/i);
    let normalizedStem;
    if (dotMatch) {
        normalizedStem = dotMatch[1].toLowerCase() + toSnakeCase(dotMatch[2]);
    }
    else if (/^Prompt-/i.test(stem)) {
        normalizedStem = "Prompt-" + toSnakeCase(stem.replace(/^Prompt-/i, ""));
    }
    else {
        normalizedStem = toSnakeCase(stem);
    }
    const normalizedBase = normalizedStem + ext.toLowerCase();
    const normalizedPath = path.join(dir, normalizedBase);
    return { originalPath: filePath, normalizedName: normalizedBase, normalizedPath, changed: normalizedBase !== base, sidecarPath: filePath + ".normalize.log.yaml" };
}
function normalizeFilenameWithLog(filePath, opts) {
    const result = normalizeFilename(filePath);
    if (!result.changed)
        return result;
    const log = [
        `# normalize.log`, `original: "${result.originalPath}"`, `normalized: "${result.normalizedPath}"`,
        `dry_run: ${opts.dryRun}`, `timestamp: "${new Date().toISOString()}"`,
        `status: ${opts.dryRun ? "pending_rename" : "sidecar_written"}`,
    ].join("\n") + "\n";
    fs.writeFileSync(result.sidecarPath, log, "utf8");
    if (opts.verbose)
        process.stderr.write(`[normalize${opts.dryRun ? "-dry-run" : ""}] ${path.basename(result.originalPath)} → ${result.normalizedName}\n`);
    return result;
}
function normalizeFilenames(filePaths, opts) {
    return filePaths.map((fp) => normalizeFilenameWithLog(fp, opts));
}
//# sourceMappingURL=normalize_filename.js.map