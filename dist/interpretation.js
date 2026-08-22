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
exports.DEFAULT_MAX_FILE_BYTES = exports.MAX_EXCERPT_LENGTH = exports.INTERPRETATION_PROFILE_VERSION = exports.INTERPRETATION_PROFILE_ID = void 0;
exports.extractorSubjectScope = extractorSubjectScope;
exports.isSecretCandidatePath = isSecretCandidatePath;
exports.looksSecret = looksSecret;
exports.boundExcerpt = boundExcerpt;
exports.interpretRepository = interpretRepository;
// interpretation.ts — deterministic repository interpretation (Seam B).
//
// Inventory answers "what files exist and what are they". Interpretation answers
// "what do those files declare", and it is a separate, separately versioned pass
// on purpose: observation must stay pure and cheap, while interpretation reads
// file bodies and can grow rules over time without perturbing the inventory
// contract.
//
// Every assertion produced here carries the evidence that produced it — exact
// repository-relative path, exact line range, a bounded excerpt, and the hash of
// the file it came from. An assertion that cannot cite a span is not emitted.
//
// Boundaries this module holds:
//   - Deterministic: no clock, no network, no locale-dependent ordering, no
//     randomness, no model. The same bytes always yield the same assertions.
//   - Observational: extractors parse syntax and report what a file states. They
//     never summarize, infer, resolve a contradiction, or upgrade a claim.
//   - Secret-safe: candidate secret files are never interpreted, and no excerpt
//     that looks like a credential is persisted.
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const encoding_1 = require("./encoding");
const repository_model_1 = require("./repository_model");
/** Identity of the interpretation policy. Bumped when extraction rules change. */
exports.INTERPRETATION_PROFILE_ID = "meta-injector-repository-interpretation";
/**
 * 1.1.0 adds artifact-scoped assertion subjects and the deterministic
 * work-intelligence extractors. Both change what this profile observes, so the
 * version — and through it every packet's semantic identity — moves with them.
 */
exports.INTERPRETATION_PROFILE_VERSION = "1.1.0";
/** The scope an extractor declares, defaulting to the pre-scope behavior. */
function extractorSubjectScope(extractor) {
    return extractor.subjectScope ?? "repository";
}
// ───────────────────────────── secret safety ─────────────────────────────
/**
 * Files never opened for interpretation.
 *
 * Matching is on the repository-relative POSIX path, case-insensitively. This is
 * a refusal to read, not a filter on output: the safest excerpt of a private key
 * is the one that was never loaded.
 */
const SECRET_PATH_PATTERNS = [
    /(^|\/)\.env$/i,
    /(^|\/)\.env\./i,
    /\.pem$/i,
    /\.key$/i,
    /\.p12$/i,
    /\.pfx$/i,
    /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
    /credential/i,
    /secret/i,
    /password/i,
    /\.netrc$/i,
    /(^|\/)\.htpasswd$/i,
];
function isSecretCandidatePath(sourcePath) {
    return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(sourcePath));
}
/**
 * Values that must never be persisted in an excerpt even from a file whose path
 * looked innocuous. A long opaque token assigned to a suggestive name is the
 * shape worth refusing; the assertion is dropped rather than redacted, because a
 * redacted excerpt is no longer evidence of anything.
 */
const SECRET_VALUE_PATTERNS = [
    /\b(?:api[_-]?key|secret|token|password|passwd|credential|private[_-]?key)\b\s*[:=]\s*\S{8,}/i,
    /-----BEGIN[A-Z ]*PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
];
function looksSecret(value) {
    return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}
/** Excerpts are bounded so a packet can never become a file mirror. */
exports.MAX_EXCERPT_LENGTH = 240;
/** Files larger than this are reported as a diagnostic rather than interpreted. */
exports.DEFAULT_MAX_FILE_BYTES = 512 * 1024;
function boundExcerpt(value) {
    const collapsed = value.replace(/\s+/g, " ").trim();
    return collapsed.length <= exports.MAX_EXCERPT_LENGTH
        ? collapsed
        : `${collapsed.slice(0, exports.MAX_EXCERPT_LENGTH - 1)}…`;
}
function profileHash(extractors) {
    return (0, repository_model_1.semanticHash)({
        id: exports.INTERPRETATION_PROFILE_ID,
        version: exports.INTERPRETATION_PROFILE_VERSION,
        evidence_classes: ["declared", "observed"],
        ordering: "code-point",
        absolute_paths_in_identity: false,
        max_excerpt_length: exports.MAX_EXCERPT_LENGTH,
        extractors: extractors
            .map((extractor) => ({
            id: extractor.id,
            version: extractor.version,
            // Scope is part of what an extractor observes, not just where the claim
            // is filed: the same predicate against a repository and against an
            // artifact are different assertions.
            subject_scope: extractorSubjectScope(extractor),
        }))
            .sort((left, right) => (0, repository_model_1.compareCodePoints)(left.id, right.id)),
    });
}
/** Total order over assertions. Stable regardless of filesystem or extractor order. */
function compareAssertions(left, right) {
    return ((0, repository_model_1.compareCodePoints)(left.source_path, right.source_path) ||
        left.source_range.start_line - right.source_range.start_line ||
        left.source_range.end_line - right.source_range.end_line ||
        (0, repository_model_1.compareCodePoints)(left.predicate, right.predicate) ||
        (0, repository_model_1.compareCodePoints)(left.object, right.object) ||
        (0, repository_model_1.compareCodePoints)(left.extractor_id, right.extractor_id) ||
        (0, repository_model_1.compareCodePoints)(left.subject_id, right.subject_id));
}
function compareDiagnostics(left, right) {
    return ((0, repository_model_1.compareCodePoints)(left.code, right.code) ||
        (0, repository_model_1.compareCodePoints)(left.source_path ?? "", right.source_path ?? "") ||
        (0, repository_model_1.compareCodePoints)(left.message, right.message));
}
/**
 * Interpret a repository that inventory has already observed.
 *
 * Returns an empty assertion set rather than throwing when nothing matches: a
 * repository the profile has no rules for is not an error, it is a repository
 * with no declared semantics this profile can read.
 */
function interpretRepository(input) {
    const extractors = [...input.extractors].sort((left, right) => (0, repository_model_1.compareCodePoints)(left.id, right.id));
    const maxFileBytes = input.maxFileBytes ?? exports.DEFAULT_MAX_FILE_BYTES;
    const assertions = [];
    const diagnostics = [];
    // Inventory order is filesystem order; sort so the read order is fixed too.
    const records = [...input.inventory.records]
        .filter((record) => record.artifact_type !== "folder")
        .sort((left, right) => (0, repository_model_1.compareCodePoints)(left.relative_path, right.relative_path));
    const observedPaths = new Set(input.inventory.records.map((record) => record.relative_path));
    const pathExists = (relativePath) => observedPaths.has(relativePath.replace(/^\.\//, ""));
    // Subject per observed path, computed once. A virtual archive member resolves
    // to its own artifact — `Bundle.zip!/plans/a.md`, never the outer archive and
    // never the staged scratch copy, neither of which is what declared anything.
    const artifactSubjects = new Map();
    const artifactSubjectFor = (sourcePath) => {
        const known = artifactSubjects.get(sourcePath);
        if (known !== undefined)
            return known;
        const subject = (0, repository_model_1.repositoryModelArtifactId)(input.subjectId, sourcePath);
        artifactSubjects.set(sourcePath, subject);
        return subject;
    };
    for (const record of records) {
        const sourcePath = record.relative_path;
        const claiming = extractors.filter((extractor) => extractor.matches(sourcePath));
        if (claiming.length === 0)
            continue;
        if (isSecretCandidatePath(sourcePath)) {
            diagnostics.push({
                code: "interpretation.secret_path_skipped",
                severity: "info",
                message: "path matches a credential pattern and was not opened for interpretation",
                source_path: sourcePath,
            });
            continue;
        }
        if (record.size_bytes !== null && record.size_bytes > maxFileBytes) {
            diagnostics.push({
                code: "interpretation.file_too_large",
                severity: "warning",
                message: `file exceeds the ${maxFileBytes}-byte interpretation limit and was not read`,
                source_path: sourcePath,
            });
            continue;
        }
        const absolute = record.absolute_path ?? path.join(input.root, sourcePath);
        // Encoding eligibility is decided over every byte before the file is decoded.
        // A prefix that happens to be ASCII says nothing about byte 9000, and decoding
        // a non-UTF-8 file with replacement characters would produce assertions whose
        // excerpts do not match the bytes their hash claims to cite.
        const encoding = (0, encoding_1.probeFileEncoding)(absolute);
        if (encoding.status !== "utf8") {
            diagnostics.push({
                code: encoding.status === "unreadable"
                    ? "interpretation.unreadable"
                    : "interpretation.unsupported_encoding",
                severity: "warning",
                message: encoding.status === "unreadable"
                    ? `file could not be read: ${encoding.reason}`
                    : `file is not valid UTF-8 text and was not interpreted: ${encoding.reason}`,
                source_path: sourcePath,
            });
            continue;
        }
        let content;
        try {
            content = fs.readFileSync(absolute, "utf8");
        }
        catch (error) {
            diagnostics.push({
                code: "interpretation.unreadable",
                severity: "warning",
                message: `file could not be read: ${error.message}`,
                source_path: sourcePath,
            });
            continue;
        }
        // Hash the text actually interpreted, so evidence binds to what was parsed.
        const contentHash = (0, repository_model_1.sha256TextPrefixed)(content);
        for (const extractor of claiming) {
            const subjectId = extractorSubjectScope(extractor) === "artifact"
                ? artifactSubjectFor(sourcePath)
                : input.subjectId;
            let drafts;
            try {
                drafts = extractor.extract({
                    subjectId,
                    sourcePath,
                    content,
                    contentHash,
                    pathExists,
                });
            }
            catch (error) {
                // A malformed file is a fact about the repository, not a crash.
                diagnostics.push({
                    code: "interpretation.extractor_failed",
                    severity: "warning",
                    message: `extractor did not complete: ${error.message}`,
                    extractor_id: extractor.id,
                    source_path: sourcePath,
                });
                continue;
            }
            for (const draft of drafts) {
                const excerpt = boundExcerpt(draft.evidenceExcerpt);
                if (looksSecret(excerpt) || looksSecret(draft.object)) {
                    diagnostics.push({
                        code: "interpretation.secret_value_suppressed",
                        severity: "warning",
                        message: "assertion was dropped because its evidence resembled a credential",
                        extractor_id: extractor.id,
                        source_path: sourcePath,
                    });
                    continue;
                }
                if (draft.sourceRange.start_line < 1 || draft.sourceRange.end_line < draft.sourceRange.start_line) {
                    diagnostics.push({
                        code: "interpretation.invalid_source_range",
                        severity: "error",
                        message: "assertion was dropped because its source range was not a valid span",
                        extractor_id: extractor.id,
                        source_path: sourcePath,
                    });
                    continue;
                }
                // The subject is part of assertion identity: the same predicate about a
                // repository and about one of its files are two different claims, and
                // they must not collide on one id.
                const identity = {
                    subject_id: subjectId,
                    predicate: draft.predicate,
                    object: draft.object,
                    source_path: sourcePath,
                    source_range: draft.sourceRange,
                    extractor_id: extractor.id,
                };
                assertions.push({
                    assertion_id: (0, repository_model_1.stableId)("assertion", identity),
                    subject_id: subjectId,
                    predicate: draft.predicate,
                    object: draft.object,
                    source_path: sourcePath,
                    source_range: draft.sourceRange,
                    evidence_excerpt: excerpt,
                    source_content_hash: contentHash,
                    extractor_id: extractor.id,
                    evidence_class: draft.evidenceClass,
                    authority: draft.authority,
                    confidence: draft.confidence,
                });
            }
        }
    }
    return {
        profile: {
            profile_id: exports.INTERPRETATION_PROFILE_ID,
            profile_version: exports.INTERPRETATION_PROFILE_VERSION,
            profile_hash: profileHash(extractors),
            extractor_versions: Object.fromEntries(extractors.map((extractor) => [extractor.id, extractor.version])),
        },
        assertions: assertions.sort(compareAssertions),
        diagnostics: diagnostics.sort(compareDiagnostics),
    };
}
//# sourceMappingURL=interpretation.js.map