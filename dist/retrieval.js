"use strict";
// retrieval.ts - deterministic file discovery and scan.
// Every encountered filesystem entry receives one terminal disposition. Only
// eligible UTF-8 regular files are returned to the classifier and injector.
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
exports.discoverFiles = discoverFiles;
exports.findFiles = findFiles;
exports.scanFiles = scanFiles;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const extract_1 = require("./extract");
const comment_1 = require("./comment");
const omit_1 = require("./omit");
const encoding_1 = require("./encoding");
const discovery_contracts_1 = require("./discovery_contracts");
const ordering_1 = require("./ordering");
/** Injector-generated adjacent artifacts must never be rediscovered as inputs. */
function isGeneratedArtifact(name) {
    return name.endsWith(".inject.log") || name.endsWith(".l9meta.yaml");
}
function toPosix(value) {
    return value.split(path.sep).join("/");
}
function isL9InternalPath(relPath) {
    return relPath === ".l9" || relPath.startsWith(".l9/");
}
function isHiddenControlPath(relPath) {
    return relPath.split("/").some((segment) => segment.startsWith(".") && segment !== ".");
}
/**
 * Classify a file for discovery by validating its encoding over every byte.
 *
 * A prefix probe was not sufficient here: discovery decides which files are
 * eligible for inline mutation, and a file whose first 8 KiB are ASCII can still
 * be Windows-1252 further in. Rewriting such a file after a prefix-only check
 * re-encodes the tail. Validation streams the whole file in fixed-size chunks,
 * so the cost is bounded even on an external drive.
 */
function probeTextFile(filePath) {
    const probe = (0, encoding_1.probeFileEncoding)(filePath);
    switch (probe.status) {
        case "utf8":
            return { status: "text", reason: "valid UTF-8 over every byte", ...(probe.sizeBytes !== undefined ? { sizeBytes: probe.sizeBytes } : {}) };
        case "binary":
            return { status: "binary", reason: probe.reason, ...(probe.sizeBytes !== undefined ? { sizeBytes: probe.sizeBytes } : {}) };
        case "invalid":
            return { status: "unsupported_encoding", reason: probe.reason, ...(probe.sizeBytes !== undefined ? { sizeBytes: probe.sizeBytes } : {}) };
        default:
            return { status: "unreadable", reason: probe.reason };
    }
}
function record(ledger, pathName, kind, disposition, reason, sizeBytes) {
    ledger.push({ path: pathName, kind, disposition, reason, ...(sizeBytes === undefined ? {} : { sizeBytes }) });
}
function discoverFiles(root, glob, opts = {}) {
    const extMatch = /\*\.([a-z0-9]+)$/i.exec(glob);
    const extFilter = extMatch ? `.${extMatch[1].toLowerCase()}` : null;
    const absRoot = path.resolve(root);
    let rootStat;
    try {
        rootStat = fs.lstatSync(absRoot);
    }
    catch (error) {
        throw new Error(`discovery root cannot be inspected: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (rootStat.isSymbolicLink())
        throw new Error(`discovery root must not be a symbolic link: ${absRoot}`);
    if (!rootStat.isDirectory())
        throw new Error(`discovery root must be a directory: ${absRoot}`);
    const omit = opts.omit ?? (0, omit_1.buildOmitMatcher)({
        root: absRoot,
        patterns: opts.omitPatterns,
        omitFile: opts.omitFile,
        protectSkillMd: opts.protectSkillMd !== false,
        ignoreDirNames: ["node_modules"],
    });
    const files = [];
    const ledger = [];
    const walk = (directory) => {
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        }
        catch (error) {
            const rel = toPosix(path.relative(absRoot, directory)) || ".";
            record(ledger, rel, "directory", "unreadable", `directory enumeration failed: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        entries.sort((a, b) => (0, ordering_1.compareCodePoints)(a.name, b.name));
        for (const entry of entries) {
            const full = path.join(directory, entry.name);
            const rel = toPosix(path.relative(absRoot, full));
            let stat;
            try {
                stat = fs.lstatSync(full);
            }
            catch (error) {
                record(ledger, rel, "other", "unreadable", `lstat failed: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
            if (stat.isSymbolicLink()) {
                let target = "unknown target";
                try {
                    target = fs.readlinkSync(full);
                }
                catch { /* retained as unknown */ }
                record(ledger, rel, "symlink", "symlink", `symbolic link is not traversed or mutated: ${target}`);
                continue;
            }
            if (stat.isDirectory()) {
                if (isL9InternalPath(rel)) {
                    record(ledger, rel, "directory", "generated_artifact", ".l9 is reserved for authority and generated metadata state");
                    continue;
                }
                if (omit.shouldOmit(rel) || omit.shouldOmit(`${rel}/`)) {
                    record(ledger, rel, "directory", "omitted", "directory matched omit policy");
                    continue;
                }
                if (isHiddenControlPath(rel)) {
                    record(ledger, rel, "directory", "hidden_control", "hidden control directory is reserved for authority scanning");
                    continue;
                }
                record(ledger, rel, "directory", "traversed_directory", "directory traversed for candidate discovery");
                walk(full);
                continue;
            }
            if (!stat.isFile()) {
                record(ledger, rel, "other", "unsupported_entry", "filesystem entry is not a regular file, directory, or symlink", stat.size);
                continue;
            }
            if (isL9InternalPath(rel)) {
                record(ledger, rel, "file", "generated_artifact", ".l9 is reserved for authority and generated metadata state", stat.size);
                continue;
            }
            // Adjacent injector output is identified before omit policy so a generated
            // artifact is never reclassified as merely omitted by a noise pattern
            // (e.g. the built-in `*.log` rule matching `*.inject.log`).
            if (isGeneratedArtifact(entry.name)) {
                record(ledger, rel, "file", "generated_artifact", "adjacent injector output is not an input", stat.size);
                continue;
            }
            if (omit.shouldOmit(rel)) {
                record(ledger, rel, "file", "omitted", "file matched omit policy", stat.size);
                continue;
            }
            if (isHiddenControlPath(rel)) {
                record(ledger, rel, "file", "hidden_control", "hidden control file is reserved for authority scanning", stat.size);
                continue;
            }
            if (extFilter && !entry.name.toLowerCase().endsWith(extFilter)) {
                record(ledger, rel, "file", "extension_filtered", `file does not match requested ${extFilter} filter`, stat.size);
                continue;
            }
            const strategy = (0, comment_1.resolveStrategy)(full, "");
            if (strategy.strategy === "skip-binary") {
                record(ledger, rel, "file", "known_binary", "file extension resolves to skip-binary", stat.size);
                continue;
            }
            // An extension decides which metadata carrier a file would use; it does not
            // decide whether the file's bytes can be decoded. A `.md` file written in
            // Windows-1252 is still a `.md` file, and declaring it eligible on its name
            // would route it into inline mutation, where the whole file is decoded and
            // rewritten and its tail is lost. So every candidate is validated on disk,
            // and the extension only supplies the reason recorded for a file that
            // passes (OBS-008 keeps a readable known-text file eligible; it does not
            // exempt an undecodable one).
            const ext = path.extname(entry.name).toLowerCase();
            const knownText = comment_1.FRONTMATTER_EXTS.has(ext) ||
                strategy.strategy === "line-comment" ||
                strategy.strategy === "block-comment";
            const probe = probeTextFile(full);
            if (knownText && probe.status === "text") {
                record(ledger, rel, "file", "eligible", "known text extension", stat.size);
                files.push(full);
                continue;
            }
            if (probe.status === "binary") {
                record(ledger, rel, "file", "binary_detected", probe.reason, probe.sizeBytes);
                continue;
            }
            if (probe.status === "unsupported_encoding") {
                record(ledger, rel, "file", "unsupported_encoding", probe.reason, probe.sizeBytes);
                continue;
            }
            if (probe.status === "unreadable") {
                // Surface the access error to stderr rather than silently conflating it
                // with a real binary, so a dropped input is traceable (OBS-008).
                process.stderr.write(`[l9-meta-injector] retrieval: excluded unreadable file ${full}: ${probe.reason}\n`);
                record(ledger, rel, "file", "unreadable", probe.reason);
                continue;
            }
            record(ledger, rel, "file", "eligible", probe.reason, probe.sizeBytes);
            files.push(full);
        }
    };
    walk(absRoot);
    files.sort(ordering_1.compareCodePoints);
    return { files, summary: (0, discovery_contracts_1.summarizeDiscovery)(ledger) };
}
/** Backward-compatible file-only discovery wrapper. */
function findFiles(root, glob, opts = {}) {
    return discoverFiles(root, glob, opts).files;
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
    return filePaths.map((filePath) => {
        const raw = fs.readFileSync(filePath, "utf8");
        const stat = fs.statSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const isFrontmatter = comment_1.FRONTMATTER_EXTS.has(ext) && ext !== ".txt" && ext !== ".text";
        const { frontMatter, headerConvention, body } = isFrontmatter
            ? (0, extract_1.splitContent)(raw)
            : { frontMatter: null, headerConvention: "none", body: raw };
        return {
            sourcePath: filePath,
            fileName: path.basename(filePath),
            sizeBytes: stat.size,
            headerConvention: headerConvention,
            bodyStructure: detectBodyStructure(body),
            hasExistingFrontMatter: frontMatter !== null,
        };
    });
}
//# sourceMappingURL=retrieval.js.map