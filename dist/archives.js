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
exports.EXPANDABLE_ARCHIVE_EXTS = exports.EXTRACTED_DIR_SUFFIX = void 0;
exports.extractDirFor = extractDirFor;
exports.listZipMembers = listZipMembers;
exports.extractZip = extractZip;
exports.findArchives = findArchives;
exports.writeArchiveSidecar = writeArchiveSidecar;
exports.expandArchivesUnderRoot = expandArchivesUnderRoot;
// archives.ts — Opt-in local-files archive expansion for the pipeline.
// Default (repo) mode never extracts. When PipelineConfig.localFiles is set,
// .zip archives under the scan root are expanded into sibling *.l9extracted/
// directories, members become ordinary inject targets, and each archive gets an
// inventory-style sidecar (<zip>.l9meta.yaml). Nested zips are expanded up to
// maxDepth. Extraction uses the system `unzip` binary (macOS/Linux); missing
// unzip fails closed with an explicit error.
//
// Omit (ADR-017): when an OmitMatcher is supplied, omitted archives are not
// expanded / sidecared, omitted directories are not walked, and omitted zip
// members (e.g. SKILL.md, *.log, __pycache__) are not extracted onto disk.
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const comment_1 = require("./comment");
const yaml_serialize_1 = require("./yaml_serialize");
/** Directory-name suffix for an expanded archive (sibling of the .zip). */
exports.EXTRACTED_DIR_SUFFIX = ".l9extracted";
/** Archive extensions expanded in local-files mode (v1: zip only). */
exports.EXPANDABLE_ARCHIVE_EXTS = new Set([".zip"]);
function isExpandableArchive(filePath) {
    return exports.EXPANDABLE_ARCHIVE_EXTS.has(path.extname(filePath).toLowerCase());
}
function relPosix(root, abs) {
    return path.relative(root, abs).split(path.sep).join("/");
}
function isOmitted(omit, rel) {
    if (!omit)
        return false;
    return omit.shouldOmit(rel) || omit.shouldOmit(rel.endsWith("/") ? rel : `${rel}/`);
}
/** Sibling extract directory for a zip: `Archive.zip` → `Archive.l9extracted`. */
function extractDirFor(zipPath) {
    const dir = path.dirname(zipPath);
    const base = path.basename(zipPath, path.extname(zipPath));
    return path.join(dir, base + exports.EXTRACTED_DIR_SUFFIX);
}
function requireUnzip() {
    try {
        return (0, child_process_1.execFileSync)("which", ["unzip"], { encoding: "utf8" }).trim();
    }
    catch {
        throw new Error("local-files mode requires the `unzip` binary on PATH (macOS/Linux). " +
            "Install unzip or run without --local-files / localFiles.");
    }
}
/** List member paths inside a zip; reject Zip-Slip (`..` / absolute) names. */
function listZipMembers(zipPath) {
    requireUnzip();
    const out = (0, child_process_1.execFileSync)("unzip", ["-Z1", zipPath], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    const members = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const name of members) {
        const normalized = name.replace(/\\/g, "/");
        if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
            throw new Error(`refusing to extract unsafe zip member path from ${zipPath}: ${name}`);
        }
    }
    return members;
}
/**
 * Remove and recreate extractDir, then unzip allowed members into it.
 * When `allowedMembers` is set, only those paths are extracted (omit filter).
 * Returns the number of non-directory members actually extracted.
 */
function extractZip(zipPath, extractDir, allowedMembers) {
    requireUnzip();
    const members = listZipMembers(zipPath);
    const files = members.filter((m) => !m.endsWith("/"));
    const toExtract = allowedMembers
        ? files.filter((m) => allowedMembers.includes(m))
        : files;
    if (fs.existsSync(extractDir))
        fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    if (toExtract.length === 0)
        return 0;
    // Pass member names explicitly so omitted paths (SKILL.md, *.log, …) never land on disk.
    (0, child_process_1.execFileSync)("unzip", ["-q", "-o", "-d", extractDir, zipPath, ...toExtract], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
    });
    return toExtract.length;
}
function walkFiles(dir, out) {
    if (!fs.existsSync(dir))
        return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith(".") || entry.name === "node_modules")
                continue;
            walkFiles(full, out);
        }
        else if (entry.isFile()) {
            out.push(full);
        }
    }
}
/** Discover expandable archives under root (does not enter existing *.l9extracted dirs). */
function findArchives(root, omit) {
    const absRoot = path.resolve(root);
    const archives = [];
    const omitted = [];
    function walk(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            const rel = relPosix(absRoot, full);
            if (entry.isDirectory()) {
                if (entry.name.startsWith(".") || entry.name === "node_modules")
                    continue;
                if (entry.name.endsWith(exports.EXTRACTED_DIR_SUFFIX))
                    continue; // don't re-discover from prior extract trees as roots
                if (isOmitted(omit, rel))
                    continue;
                walk(full);
            }
            else if (entry.isFile() && isExpandableArchive(full)) {
                if (isOmitted(omit, rel))
                    omitted.push(rel);
                else
                    archives.push(full);
            }
        }
    }
    if (fs.existsSync(absRoot))
        walk(absRoot);
    archives.sort();
    omitted.sort();
    return { archives, omitted };
}
function contentHashFile(filePath) {
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(filePath));
    return `sha256:${hash.digest("hex")}`;
}
/** Write `<zip>.l9meta.yaml` describing the archive and its extract location. */
function writeArchiveSidecar(zipPath, extractDir, memberCount, extras = {}) {
    const sidecar = (0, comment_1.sidecarPathFor)(zipPath);
    const obj = {
        schema: "l9.archive-sidecar/v1",
        artifact_type: "archive",
        source_path: zipPath,
        file_name: path.basename(zipPath),
        content_hash: contentHashFile(zipPath),
        size_bytes: fs.statSync(zipPath).size,
        extracted_to: extractDir,
        member_count: memberCount,
        injectable: false,
        expanded_by: "l9-meta-injector.local-files",
        ...extras,
    };
    fs.writeFileSync(sidecar, (0, yaml_serialize_1.serializeYamlObject)(obj, { fences: true, trailingNewline: true }), "utf8");
    return sidecar;
}
/**
 * Expand all zips under root (and nested zips inside freshly extracted trees)
 * up to maxDepth. Writes archive sidecars unless dryRun. Honors `opts.omit`.
 */
function expandArchivesUnderRoot(root, opts) {
    const absRoot = path.resolve(root);
    const maxDepth = opts.maxDepth ?? 3;
    const archives = [];
    const extractedRoots = [];
    const omittedArchives = [];
    const omit = opts.omit;
    // Queue of { zip, depth }. Start with archives found outside any extract tree.
    const found = findArchives(absRoot, omit);
    omittedArchives.push(...found.omitted);
    const queue = found.archives.map((zipPath) => ({
        zipPath,
        depth: 0,
    }));
    const seen = new Set();
    while (queue.length) {
        const { zipPath, depth } = queue.shift();
        const key = path.resolve(zipPath);
        if (seen.has(key))
            continue;
        seen.add(key);
        const zipRel = relPosix(absRoot, zipPath);
        if (isOmitted(omit, zipRel)) {
            omittedArchives.push(zipRel);
            if (opts.verbose) {
                process.stderr.write(`[l9-meta-injector] local-files: omit archive ${zipRel}\n`);
            }
            continue;
        }
        const extractDir = extractDirFor(zipPath);
        const members = listZipMembers(zipPath).filter((m) => !m.endsWith("/"));
        const allowed = omit
            ? members.filter((m) => {
                const memberAbs = path.join(extractDir, m);
                const memberRel = relPosix(absRoot, memberAbs);
                return !isOmitted(omit, memberRel);
            })
            : members;
        if (opts.verbose) {
            process.stderr.write(`[l9-meta-injector] local-files: extracting ${zipPath} → ${extractDir} ` +
                `(depth=${depth}, members=${allowed.length}/${members.length})\n`);
        }
        const memberCount = extractZip(zipPath, extractDir, omit ? allowed : undefined);
        extractedRoots.push(extractDir);
        let sidecarPath;
        if (!opts.dryRun) {
            sidecarPath = writeArchiveSidecar(zipPath, extractDir, memberCount, {
                nested_depth: depth,
                expanded_at: new Date().toISOString(),
                members_omitted: members.length - allowed.length,
            });
        }
        archives.push({ zipPath, extractDir, memberCount, sidecarPath, nestedDepth: depth });
        if (depth >= maxDepth)
            continue;
        // Nested zips inside this extract tree (omit still applies to their relative paths)
        const nested = [];
        walkFiles(extractDir, nested);
        for (const f of nested) {
            if (!isExpandableArchive(f))
                continue;
            const nestedRel = relPosix(absRoot, f);
            if (isOmitted(omit, nestedRel)) {
                omittedArchives.push(nestedRel);
                continue;
            }
            queue.push({ zipPath: f, depth: depth + 1 });
        }
    }
    if (opts.verbose || archives.length > 0 || omittedArchives.length > 0) {
        process.stderr.write(`[l9-meta-injector] local-files: expanded ${archives.length} archive(s)` +
            (omittedArchives.length ? `, omitted ${omittedArchives.length}` : "") +
            ` under ${absRoot}\n`);
    }
    return { archives, extractedRoots, omittedArchives };
}
//# sourceMappingURL=archives.js.map