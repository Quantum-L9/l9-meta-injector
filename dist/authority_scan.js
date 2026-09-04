"use strict";
/**
 * Read-only scan for competing repository metadata authorities.
 *
 * This scanner intentionally includes hidden control surfaces that normal artifact
 * discovery omits. It does not make those paths mutation candidates.
 *
 * Three distinct things are separated here, because collapsing them is what made a
 * mature repository un-adoptable without source surgery:
 *
 *   historical marker        legacy L9 metadata *text*, with nothing showing that the
 *                            containing surface writes L9 metadata. Always inert.
 *   dormant writer artifact  a control surface whose own evidence specifically claims to
 *                            write/inject/verify/generate/sync L9 metadata, but which
 *                            nothing invokes. Blocking under `forbidden`; a recorded
 *                            migration notice under `migration_only`.
 *   active invocation        a live control surface that calls a competing writer.
 *                            Blocking under every policy.
 *
 * A generic `writeFileSync` / `json.dump` / `yaml.safe_dump` / `open(..., "w")` is never
 * sufficient on its own. The write has to be tied to the L9 metadata surface, either on
 * the same line or by a filename that names it.
 *
 * The repository's declared `legacy_writers` policy is an input to this decision, not a
 * separate validation pass: there is exactly one authority scanner.
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
exports.dispositionForEvidence = dispositionForEvidence;
exports.scanRepositoryAuthority = scanRepositoryAuthority;
exports.inspectRepositoryAuthority = inspectRepositoryAuthority;
exports.assertRepositoryAuthorityForOperation = assertRepositoryAuthorityForOperation;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const authority_1 = require("./authority");
const operation_contracts_1 = require("./operation_contracts");
const ordering_1 = require("./ordering");
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
/**
 * Names of the L9 metadata surface itself.
 *
 * A write becomes an L9-metadata write only when it is tied to one of these. This is the
 * discriminator that separates "this file happens to call json.dump" from "this file
 * writes competing L9 metadata".
 */
const L9_METADATA_TOKEN = /L9_ARTIFACT_META|x-l9-meta|L9_META|l9:meta:start|l9meta|l9[-_]meta|\.l9\/metadata-index/i;
/** A filename that itself claims to be an L9 metadata writer. */
const L9_METADATA_FILENAME = /l9[-_.]?meta/i;
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
const AUTHORITY_DIRECTORY_NAME = ".l9";
const AUTHORITY_FILE_NAME = "meta-authority.yaml";
function nestedAuthorityConflict(relativePath) {
    return {
        code: "META_AUTHORITY_CONFLICT",
        message: "nested authority declaration competes with the root .l9/meta-authority.yaml; one repository has one authority",
        path: relativePath,
    };
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
    const nestedAuthorities = [];
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
                if (entry.name === AUTHORITY_DIRECTORY_NAME && directory !== root) {
                    const candidate = path.join(full, AUTHORITY_FILE_NAME);
                    try {
                        if (fs.lstatSync(candidate).isFile())
                            nestedAuthorities.push(toPosix(path.relative(root, candidate)));
                    }
                    catch {
                        // No document inside the nested `.l9`: nothing competes.
                    }
                }
                walk(full);
            }
            else if (entry.isFile() && isCandidate(relative)) {
                files.push(full);
            }
        }
    };
    walk(root);
    files.sort(ordering_1.compareCodePoints);
    return { files, gaps, nestedAuthorities: nestedAuthorities.sort(ordering_1.compareCodePoints) };
}
/**
 * Apply the repository's declared legacy-writer policy to one piece of evidence.
 *
 * An absent policy means the authority did not resolve; the scan then fails closed and
 * treats every legacy writer signal as a conflict.
 */
function dispositionForEvidence(kind, policy) {
    // The canonical writer is this package. Seeing it is the desired state, not a conflict.
    if (kind === "canonical_invocation")
        return "inert";
    // Historical marker text never blocks: it is evidence about the past, and no repository
    // should have to rewrite its own history to adopt the canonical writer.
    if (kind === "legacy_marker")
        return "inert";
    // A live invocation of a competing writer is a conflict under every policy.
    if (kind === "writer_invocation")
        return "conflict";
    // Dormant writer artifact: `migration_only` records it, `forbidden` blocks on it.
    return policy === "migration_only" ? "migration" : "conflict";
}
function evidenceDetail(item) {
    return [`${item.rule}${item.line ? ` at line ${item.line}` : ""}`, item.excerpt ?? ""].filter(Boolean);
}
function conflictFor(item, policy) {
    if (dispositionForEvidence(item.kind, policy) !== "conflict")
        return null;
    const message = item.kind === "writer_invocation"
        ? "active control surface invokes a competing metadata writer"
        : `competing metadata writer artifact detected under legacy_writers: ${policy ?? "unresolved"}`;
    return {
        code: "META_AUTHORITY_CONFLICT",
        message,
        path: item.path,
        evidence: evidenceDetail(item),
    };
}
function noticeFor(item, policy) {
    const disposition = dispositionForEvidence(item.kind, policy);
    if (disposition === "migration") {
        return {
            code: "META_LEGACY_WRITER_MIGRATION",
            message: "dormant competing metadata writer artifact retained under legacy_writers: migration_only",
            path: item.path,
            evidence: evidenceDetail(item),
        };
    }
    if (item.kind === "legacy_marker") {
        return {
            code: "META_LEGACY_METADATA_PRESENT",
            message: "historical L9 metadata marker present; no evidence that this surface writes L9 metadata",
            path: item.path,
            evidence: evidenceDetail(item),
        };
    }
    return null;
}
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Read one control surface, returning its text or a scan gap explaining why it was skipped. */
function readControlSurface(filePath, repositoryRoot, maxFileBytes) {
    const relative = toPosix(path.relative(repositoryRoot, filePath));
    let stat;
    try {
        stat = fs.statSync(filePath);
    }
    catch (error) {
        return { relative, gap: scanGap(relative, `unable to stat control surface: ${describeError(error)}`) };
    }
    if (stat.size > maxFileBytes) {
        return { relative, gap: scanGap(relative, `control surface exceeds authority-scan limit of ${maxFileBytes} bytes`) };
    }
    let content;
    try {
        content = fs.readFileSync(filePath, "utf8");
    }
    catch (error) {
        return { relative, gap: scanGap(relative, `unable to read control surface: ${describeError(error)}`) };
    }
    if (content.includes("\u0000") || content.includes("\uFFFD")) {
        return { relative, gap: scanGap(relative, "control surface is binary or not valid UTF-8 text") };
    }
    return { relative, content };
}
/**
 * Every legacy marker occurrence in the surface, unconditionally.
 *
 * This deliberately does NOT depend on a write signal. Historical marker text is evidence
 * in its own right and is preserved whether or not it turns out to be blocking.
 */
function legacyMarkerEvidence(relative, content) {
    const found = [];
    for (const marker of LEGACY_MARKERS) {
        if (marker.value === "l9:meta:start")
            continue; // the canonical block marker, not a legacy one
        const markerIndex = content.indexOf(marker.value);
        if (markerIndex !== -1)
            found.push(evidence(relative, "legacy_marker", marker.rule, content, markerIndex));
    }
    return found;
}
function lineAt(content, index) {
    const start = content.lastIndexOf("\n", index) + 1;
    const endAt = content.indexOf("\n", index);
    return content.slice(start, endAt === -1 ? content.length : endAt);
}
/** Every write-signal position in the surface, so each can be judged in its own context. */
function writeSignalIndexes(content) {
    const scanner = new RegExp(WRITE_SIGNAL.source, "gi");
    const found = [];
    let match;
    while ((match = scanner.exec(content)) !== null) {
        found.push(match.index);
        if (scanner.lastIndex === match.index)
            scanner.lastIndex += 1;
    }
    return found;
}
/**
 * Locate a write that is specifically an L9 *metadata* write.
 *
 * Qualifying evidence is either a write on a line that also names the L9 metadata surface,
 * or — for a file whose own name claims to inject/verify/generate/sync L9 metadata — any
 * write at all. A generic write with an unrelated L9 marker elsewhere in the file does not
 * qualify, which is exactly the historical-marker false positive this repairs.
 */
function findMetadataWriteIndex(relative, content) {
    const indexes = writeSignalIndexes(content);
    if (indexes.length === 0)
        return null;
    for (const index of indexes) {
        const line = lineAt(content, index);
        // `l9-meta-injector` itself contains an L9 metadata token. A line that invokes the
        // canonical writer and redirects its output is this package doing its job, not a
        // competitor, and must never be reported as one.
        if (CANONICAL_INVOCATION.test(line))
            continue;
        if (L9_METADATA_TOKEN.test(line))
            return index;
    }
    const basename = path.posix.basename(relative);
    if (SUSPICIOUS_NAME.test(basename) && L9_METADATA_FILENAME.test(basename))
        return indexes[0];
    return null;
}
/** Collect every authority-relevant evidence item from one scanned control surface. */
function collectSurfaceEvidence(relative, content) {
    const found = [];
    const canonicalMatch = CANONICAL_INVOCATION.exec(content);
    if (canonicalMatch?.index !== undefined) {
        found.push(evidence(relative, "canonical_invocation", "canonical-l9-meta-injector-invocation", content, canonicalMatch.index));
    }
    const invocationMatch = WRITER_INVOCATION.exec(content);
    // A canonical `l9-meta-injector` reference on the same line is this package, not a
    // competitor, so it must never be reported as a competing invocation.
    if (invocationMatch?.index !== undefined && !CANONICAL_INVOCATION.test(lineAt(content, invocationMatch.index))) {
        found.push(evidence(relative, "writer_invocation", "legacy-writer-invocation", content, invocationMatch.index));
    }
    const metadataWriteIndex = findMetadataWriteIndex(relative, content);
    if (metadataWriteIndex !== null) {
        found.push(evidence(relative, "writer_script", "l9-metadata-write-signal", content, metadataWriteIndex));
    }
    found.push(...legacyMarkerEvidence(relative, content));
    return found;
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
        const surface = readControlSurface(filePath, repositoryRoot, maxFileBytes);
        if ("gap" in surface) {
            scanGaps.push(surface.gap);
            continue;
        }
        scannedPaths.push(surface.relative);
        found.push(...collectSurfaceEvidence(surface.relative, surface.content));
    }
    const deduped = [...new Map(found.map((item) => [`${item.path}:${item.kind}:${item.rule}`, item])).values()]
        .sort((a, b) => (0, ordering_1.compareCodePoints)(`${a.path}:${a.kind}:${a.rule}`, `${b.path}:${b.kind}:${b.rule}`));
    const policy = options.legacyPolicy;
    const conflicts = [
        ...scanGaps,
        ...walked.nestedAuthorities.map(nestedAuthorityConflict),
        ...deduped.map((item) => conflictFor(item, policy)).filter((item) => item !== null),
    ];
    const notices = deduped
        .map((item) => noticeFor(item, policy))
        .filter((item) => item !== null);
    scannedPaths.sort(ordering_1.compareCodePoints);
    return { scannedPaths, evidence: deduped, scanGaps, conflicts, notices };
}
function inspectRepositoryAuthority(root, options = {}) {
    const repositoryRoot = path.resolve(root);
    const loaded = (0, authority_1.loadRepositoryAuthority)(repositoryRoot, options);
    // The declared policy is an input to the one scanner, so legacy evidence is judged by
    // the repository's own contract rather than by a second, independent rule set. An
    // unresolved authority leaves the policy undefined and the scan fails closed.
    const legacyPolicy = loaded.authority?.legacy_writers ?? options.legacyPolicy;
    const scanned = scanRepositoryAuthority(repositoryRoot, { ...options, ...(legacyPolicy !== undefined ? { legacyPolicy } : {}) });
    const conflicts = [...loaded.conflicts, ...scanned.conflicts];
    return {
        root: repositoryRoot,
        authorityPath: loaded.path,
        authority: loaded.authority,
        authorityResolved: loaded.authority !== undefined && conflicts.length === 0,
        ...(legacyPolicy !== undefined ? { legacyPolicy } : {}),
        scannedPaths: scanned.scannedPaths,
        evidence: scanned.evidence,
        scanGaps: scanned.scanGaps,
        conflicts,
        notices: scanned.notices,
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