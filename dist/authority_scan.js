"use strict";
/**
 * Read-only scan for competing repository metadata authorities.
 *
 * This scanner intentionally includes hidden control surfaces that normal artifact
 * discovery omits. It does not make those paths mutation candidates. It looks for
 * executable writer scripts and invocations, while treating marker text in docs,
 * tests, fixtures, and reports as inert evidence rather than an active conflict.
 */
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
exports.scanRepositoryAuthority = scanRepositoryAuthority;
exports.inspectRepositoryAuthority = inspectRepositoryAuthority;
exports.assertRepositoryAuthorityForOperation = assertRepositoryAuthorityForOperation;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const authority_1 = require("./authority");
const operation_contracts_1 = require("./operation_contracts");
const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
    ".git",
    ".venv",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "__pycache__",
    "docs",
    "test",
    "tests",
    "fixture",
    "fixtures",
    "reports",
]);
const CONTROL_FILE_NAMES = new Set([
    "package.json",
    "Makefile",
    "makefile",
    "GNUmakefile",
    ".pre-commit-config.yaml",
    ".pre-commit-config.yml",
]);
const CONTROL_PREFIXES = [
    ".github/workflows/",
    ".github/actions/",
    ".githooks/",
    ".husky/",
    "scripts/",
    "bin/",
    "tools/",
];
const SUSPICIOUS_NAME = /(?:inject|verify|write|writer|generate|sync)[-_.a-z0-9]*meta(?:data)?|meta(?:data)?[-_.a-z0-9]*(?:inject|verify|write|writer|generate|sync)/i;
const LEGACY_MARKERS = [
    { value: "L9_ARTIFACT_META", rule: "legacy-marker-l9-artifact-meta" },
    { value: "x-l9-meta", rule: "legacy-marker-x-l9-meta" },
    { value: "L9_META", rule: "legacy-marker-l9-meta" },
    { value: "l9:meta:start", rule: "canonical-block-marker" },
];
const WRITE_SIGNAL = /(?:writeFileSync|writeFile\s*\(|write_text\s*\(|write_bytes\s*\(|fs\.write|yaml\.safe_dump|json\.dump|open\s*\([^)]*["']w|>\s*["']?[^\n]*meta)/i;
const WRITER_INVOCATION = /(?:^|[\s"'`])(?:python(?:3)?\s+|node\s+|bash\s+|sh\s+)?(?:\.\/)?[^\s"'`]*(?:inject|verify)[-_]?l9[-_]?meta[^\s"'`]*/im;
const CANONICAL_INVOCATION = /Quantum-L9\/l9-meta-injector@[0-9a-f]{40}|(?:^|[\s"'`])l9-meta-injector(?:[\s"'`/:]|$)/im;
function toPosix(value) {
    return value.split(path.sep).join("/");
}
function lineFor(content, index) {
    return content.slice(0, index).split("\n").length;
}
function excerptAt(content, index) {
    const start = content.lastIndexOf("\n", index) + 1;
    const endAt = content.indexOf("\n", index);
    const end = endAt === -1 ? content.length : endAt;
    return content.slice(start, end).trim().slice(0, 240);
}
function evidence(pathName, kind, rule, content, index) {
    return {
        path: pathName,
        kind,
        rule,
        line: lineFor(content, index),
        excerpt: excerptAt(content, index),
    };
}
function isCandidate(relativePath) {
    const base = path.posix.basename(relativePath);
    if (CONTROL_FILE_NAMES.has(base))
        return true;
    if (CONTROL_PREFIXES.some((prefix) => relativePath.startsWith(prefix)))
        return true;
    return SUSPICIOUS_NAME.test(base);
}
function scanGap(relativePath, message) {
    return {
        code: "META_AUTHORITY_SCAN_INCOMPLETE",
        message,
        path: relativePath || ".",
    };
}
function walkFiles(root, excluded) {
    const files = [];
    const gaps = [];
    const walk = (directory) => {
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        }
        catch (error) {
            const relative = toPosix(path.relative(root, directory)) || ".";
            gaps.push(scanGap(relative, `unable to enumerate path during authority scan: ${error instanceof Error ? error.message : String(error)}`));
            return;
        }
        for (const entry of entries) {
            const full = path.join(directory, entry.name);
            const relative = toPosix(path.relative(root, full));
            if (entry.isSymbolicLink()) {
                if (isCandidate(relative))
                    gaps.push(scanGap(relative, "authority scan does not follow control-surface symlinks"));
                continue;
            }
            if (entry.isDirectory()) {
                if (excluded.has(entry.name))
                    continue;
                walk(full);
            }
            else if (entry.isFile() && isCandidate(relative)) {
                files.push(full);
            }
        }
    };
    walk(root);
    return { files: files.sort((a, b) => a.localeCompare(b)), gaps };
}
function conflictFor(item) {
    if (item.kind === "canonical_invocation")
        return null;
    const code = item.kind === "legacy_marker" ? "META_LEGACY_METADATA_PRESENT" : "META_AUTHORITY_CONFLICT";
    return {
        code,
        message: item.kind === "writer_invocation"
            ? "active control surface invokes a competing metadata writer"
            : item.kind === "writer_script"
                ? "competing metadata writer script detected"
                : "legacy metadata marker participates in an active writer",
        path: item.path,
        evidence: [`${item.rule}${item.line ? ` at line ${item.line}` : ""}`, item.excerpt ?? ""].filter(Boolean),
    };
}
function scanRepositoryAuthority(root, options = {}) {
    const repositoryRoot = path.resolve(root);
    const excluded = new Set(DEFAULT_EXCLUDED_DIRECTORIES);
    for (const item of options.excludedDirectoryNames ?? [])
        excluded.add(item);
    const maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
    const walked = walkFiles(repositoryRoot, excluded);
    const files = walked.files;
    const scannedPaths = [];
    const found = [];
    const scanGaps = [...walked.gaps];
    for (const filePath of files) {
        const relative = toPosix(path.relative(repositoryRoot, filePath));
        let stat;
        try {
            stat = fs.statSync(filePath);
        }
        catch (error) {
            scanGaps.push(scanGap(relative, `unable to stat control surface: ${error instanceof Error ? error.message : String(error)}`));
            continue;
        }
        if (stat.size > maxFileBytes) {
            scanGaps.push(scanGap(relative, `control surface exceeds authority-scan limit of ${maxFileBytes} bytes`));
            continue;
        }
        let content;
        try {
            content = fs.readFileSync(filePath, "utf8");
        }
        catch (error) {
            scanGaps.push(scanGap(relative, `unable to read control surface: ${error instanceof Error ? error.message : String(error)}`));
            continue;
        }
        if (content.includes("\u0000") || content.includes("\uFFFD")) {
            scanGaps.push(scanGap(relative, "control surface is binary or not valid UTF-8 text"));
            continue;
        }
        scannedPaths.push(relative);
        const canonicalMatch = content.match(CANONICAL_INVOCATION);
        if (canonicalMatch?.index !== undefined) {
            found.push(evidence(relative, "canonical_invocation", "canonical-l9-meta-injector-invocation", content, canonicalMatch.index));
        }
        const invocationMatch = content.match(WRITER_INVOCATION);
        if (invocationMatch?.index !== undefined) {
            found.push(evidence(relative, "writer_invocation", "legacy-writer-invocation", content, invocationMatch.index));
        }
        const base = path.posix.basename(relative);
        const writeMatch = content.match(WRITE_SIGNAL);
        if (SUSPICIOUS_NAME.test(base) && writeMatch?.index !== undefined) {
            found.push(evidence(relative, "writer_script", "suspicious-writer-filename-with-write-signal", content, writeMatch.index));
        }
        if (writeMatch?.index !== undefined) {
            for (const marker of LEGACY_MARKERS) {
                const markerIndex = content.indexOf(marker.value);
                if (markerIndex !== -1 && marker.value !== "l9:meta:start") {
                    found.push(evidence(relative, "legacy_marker", marker.rule, content, markerIndex));
                }
            }
        }
    }
    const deduped = [...new Map(found.map((item) => [`${item.path}:${item.kind}:${item.rule}`, item])).values()]
        .sort((a, b) => `${a.path}:${a.kind}`.localeCompare(`${b.path}:${b.kind}`));
    const conflicts = [
        ...scanGaps,
        ...deduped.map(conflictFor).filter((item) => item !== null),
    ];
    return { scannedPaths: scannedPaths.sort(), evidence: deduped, scanGaps, conflicts };
}
function inspectRepositoryAuthority(root, options = {}) {
    const repositoryRoot = path.resolve(root);
    const loaded = (0, authority_1.loadRepositoryAuthority)(repositoryRoot, options);
    const scanned = scanRepositoryAuthority(repositoryRoot, options);
    const conflicts = [...loaded.conflicts, ...scanned.conflicts];
    return {
        root: repositoryRoot,
        authorityPath: loaded.path,
        authority: loaded.authority,
        authorityResolved: loaded.authority !== undefined && conflicts.length === 0,
        scannedPaths: scanned.scannedPaths,
        evidence: scanned.evidence,
        scanGaps: scanned.scanGaps,
        conflicts,
    };
}
function assertRepositoryAuthorityForOperation(mode, inspection) {
    if (!(0, operation_contracts_1.operationRequiresAuthority)(mode))
        return inspection.authority;
    if (!inspection.authority) {
        const codes = inspection.conflicts.map((item) => item.code).join(", ") || "META_AUTHORITY_FILE_MISSING";
        throw new Error(`operation mode '${mode}' requires resolved repository authority (${codes})`);
    }
    if (inspection.conflicts.length > 0) {
        const summary = inspection.conflicts.map((item) => `${item.code}:${item.path ?? "<repository>"}`).join(", ");
        throw new Error(`operation mode '${mode}' blocked by repository metadata authority conflict: ${summary}`);
    }
    return inspection.authority;
}
//# sourceMappingURL=authority_scan.js.map