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
exports.DOCUMENT_COVERAGE_SCHEMA = exports.CANDIDATE_STATEMENT = exports.MANIFEST_DECODER_VERSION = exports.MANIFEST_DECODER_ID = exports.TEXT_DECODER_VERSION = exports.TEXT_DECODER_ID = exports.CORPUS_CANDIDATES_SCHEMA = void 0;
exports.isTextDecodable = isTextDecodable;
exports.isLexicallyAnalyzable = isLexicallyAnalyzable;
exports.runCorpusScan = runCorpusScan;
exports.renderCorpusCandidates = renderCorpusCandidates;
exports.renderDocumentCoverage = renderDocumentCoverage;
exports.renderReadinessEvidence = renderReadinessEvidence;
// corpus_scan.ts — one read-only pass over a multi-root corpus.
//
// This is the module that owns the order of operations, and the order is what
// makes the cache safe:
//
//   1. acquire every root read-only, hashing every byte. No cache participates.
//   2. derive each artifact's corpus identity from its root and its root-relative
//      path, and the corpus snapshot identity from the roots' revisions.
//   3. for each artifact, compute the cache keys of its derived layers *from its
//      content hash alone*. A file whose bytes are unchanged is never opened.
//   4. compute what missed, store it, and project the results.
//
// Step 1 is unconditional. Hashing is the cheap layer and the one that decides
// identity, so it is never skipped, never inferred from a timestamp, and never
// read out of a cache. Everything expensive — decoding, interpreting, tokenizing —
// hangs off the hash, which is why a warm run can be fast without a single
// decision being taken on trust.
//
// Nothing in this file writes to an observed root, executes anything it finds,
// installs anything, or calls a model. A scan of a corpus leaves the corpus
// byte-for-byte as it was.
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const corpus_analysis_1 = require("./corpus_analysis");
const corpus_cache_1 = require("./corpus_cache");
const corpus_candidates_1 = require("./corpus_candidates");
const corpus_coverage_1 = require("./corpus_coverage");
const corpus_diff_1 = require("./corpus_diff");
const corpus_readiness_1 = require("./corpus_readiness");
const corpus_roots_1 = require("./corpus_roots");
const corpus_snapshot_1 = require("./corpus_snapshot");
const corpus_session_1 = require("./corpus_session");
const encoding_1 = require("./encoding");
const extractors_1 = require("./extractors");
const interpretation_1 = require("./interpretation");
const local_source_1 = require("./local_source");
const ordering_1 = require("./ordering");
const corpus_documents_1 = require("./corpus_documents");
const corpus_semantic_run_1 = require("./corpus_semantic_run");
const repository_model_1 = require("./repository_model");
const local_source_model_1 = require("./local_source_model");
exports.CORPUS_CANDIDATES_SCHEMA = "l9.corpus-candidates/v1";
/** Decoder that turns exact bytes into the text every later layer reads. */
exports.TEXT_DECODER_ID = "utf8-text-decoder";
exports.TEXT_DECODER_VERSION = "1.0.0";
/** Decoder that reads a build manifest's declared name out of its body. */
exports.MANIFEST_DECODER_ID = "manifest-identifier-reader";
exports.MANIFEST_DECODER_VERSION = "1.0.0";
/** Extensions the text decoder claims beyond the lexical-analysis set. */
const STRUCTURED_TEXT_EXTENSIONS = new Set([
    ".cfg", ".clj", ".conf", ".gradle", ".ini", ".json", ".mod", ".properties",
    ".sbt", ".toml", ".xml", ".yaml", ".yml",
]);
/** Extensionless files the text decoder claims by name. */
const STRUCTURED_TEXT_NAMES = new Set([
    "dockerfile", "containerfile", "gemfile", "jenkinsfile", "makefile", "procfile",
]);
const LEXICAL_EXTENSIONS = new Set(corpus_analysis_1.NEAR_DUPLICATE_EXTENSIONS);
const OCR_EXTENSIONS = new Set(corpus_coverage_1.OCR_REQUIRED_EXTENSIONS);
const UNDECODED_EXTENSIONS = new Set(corpus_coverage_1.UNDECODED_DOCUMENT_EXTENSIONS);
exports.CANDIDATE_STATEMENT = "Exact duplicates are byte equality and are facts. Near-duplicate candidates, topic "
    + "candidates and project candidates are deterministic candidate analyses: they report "
    + "shared bytes, shared wording and a container that holds a project marker. None of "
    + "them claims two documents mean the same thing, that anything should be merged, "
    + "moved or deleted, or that one is more valuable than another.";
exports.DOCUMENT_COVERAGE_SCHEMA = "l9.document-coverage/v1";
// ───────────────────────────── helpers ─────────────────────────────
/**
 * The archives a member sits inside, outermost first.
 *
 * `old.zip!/inner.zip!/draft.md` is two archives deep, and its ancestry is the
 * successive archive prefixes rather than the bare filenames — `inner.zip` alone
 * would collide with an unrelated `inner.zip` in another archive.
 */
function archiveAncestryOf(rootRelativePath) {
    const parts = rootRelativePath.split(local_source_1.ARCHIVE_MEMBER_SEPARATOR);
    if (parts.length < 2)
        return [];
    const ancestry = [];
    for (let i = 0; i < parts.length - 1; i += 1) {
        ancestry.push(parts.slice(0, i + 1).join(local_source_1.ARCHIVE_MEMBER_SEPARATOR));
    }
    return ancestry;
}
function normalizeHash(value) {
    if (value === null || value.length === 0)
        return null;
    return value.startsWith("sha256:") ? value : `sha256:${value}`;
}
function basenameOf(rootRelativePath) {
    return rootRelativePath.slice(rootRelativePath.lastIndexOf("/") + 1).toLowerCase();
}
function extensionOf(basename) {
    const dot = basename.lastIndexOf(".");
    return dot <= 0 ? "" : basename.slice(dot);
}
/** True when the text decoder claims this artifact at all. */
function isTextDecodable(rootRelativePath) {
    const basename = basenameOf(rootRelativePath);
    const extension = extensionOf(basename);
    if (LEXICAL_EXTENSIONS.has(extension))
        return true;
    if (STRUCTURED_TEXT_EXTENSIONS.has(extension))
        return true;
    return extension === "" && STRUCTURED_TEXT_NAMES.has(basename);
}
/** True when the lexical passes claim this artifact. */
function isLexicallyAnalyzable(rootRelativePath) {
    return LEXICAL_EXTENSIONS.has(extensionOf(basenameOf(rootRelativePath)));
}
function termCounts(tokens) {
    const counts = new Map();
    for (const token of tokens)
        counts.set(token, (counts.get(token) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => (0, ordering_1.compareCodePoints)(a[0], b[0]));
}
/**
 * Invert a membership relation: which groups each member belongs to.
 *
 * Near-duplicate candidates, topic candidates and project candidates all need the
 * same inversion, and three hand-rolled copies of it were three places for the
 * bucket-initialization branch to be got wrong.
 */
function indexMembership(groups, membersOf, idOf) {
    const index = new Map();
    for (const group of groups) {
        const id = idOf(group);
        for (const member of membersOf(group)) {
            const bucket = index.get(member);
            if (bucket === undefined)
                index.set(member, [id]);
            else
                bucket.push(id);
        }
    }
    return index;
}
/** Reject a root key that would make a corpus path ambiguous. */
function assertUsableRootKey(rootKey, rootPath) {
    if (rootKey.length === 0) {
        throw new Error(`corpus: root ${rootPath} resolves to an empty key; name it with --root PATH=NAME`);
    }
    if (rootKey.includes(corpus_roots_1.CORPUS_PATH_SEPARATOR) || /[\n\r]/.test(rootKey)) {
        throw new Error(`corpus: root key '${rootKey}' contains '${corpus_roots_1.CORPUS_PATH_SEPARATOR}' or a newline, `
            + "which would make a corpus path ambiguous");
    }
}
/**
 * Establish one document's derived layers, opening it only if it has to.
 *
 * Every key here is computed from the content hash the acquisition pass already
 * produced, so the decision not to read a file is made *after* its identity is
 * known rather than instead of knowing it. `needsText` is the whole of that
 * decision: if every layer this document wants is already stored under its own
 * content-addressed key, the file is never opened.
 */
async function deriveDocumentLayers(artifact, context) {
    const { cache, session, memory, extractors, candidateProfile, interpretProfile, interpretEnabled, maxFileBytes, rootPathsById, rootKeyById, into, } = context;
    const { normalized, lexical, interpreted, manifestIdentifiers, skipped } = into;
    const contentHash = artifact.contentHash;
    const documentKey = (0, corpus_cache_1.normalizedDocumentKey)({
        contentHash,
        decoderId: exports.TEXT_DECODER_ID,
        decoderVersion: exports.TEXT_DECODER_VERSION,
    });
    const lexicalKey = (0, corpus_cache_1.lexicalFeaturesKey)({
        normalizedDocumentIdentity: documentKey,
        lexicalProfileHash: candidateProfile,
    });
    // The interpretation key carries the source path as well as the two the
    // cache contract names. An assertion cites the path it was read from and is
    // filed against that path's artifact subject, and several extractors read
    // the path itself — so two identical files at two paths are two different
    // interpretations, and a purely content-addressed key would serve one under
    // the other's name.
    const interpretKey = (0, corpus_cache_1.interpretationKey)({
        normalizedDocumentIdentity: (0, repository_model_1.stableId)("interp-subject", {
            // Bumped when the stored shape changed to drop subject-bound identity. An
            // entry written by the previous release carries another root's subject ids
            // and must never be served; a distinct key is what guarantees it is not.
            cache_format: 2,
            normalized_document_identity: documentKey,
            source_path: artifact.rootRelativePath,
        }),
        interpretationProfileHash: interpretProfile,
    });
    const wantsLexical = isLexicallyAnalyzable(artifact.rootRelativePath);
    const wantsInterpretation = interpretEnabled
        && extractors.some((extractor) => extractor.matches(artifact.rootRelativePath));
    const wantsIdentifier = (0, corpus_candidates_1.readsDeclaredIdentifier)(artifact.basename);
    // Eligibility first: a refusal to open a file is a decision about the file,
    // not about its bytes, so it is never cached under a content key.
    if ((0, interpretation_1.isSecretCandidatePath)(artifact.rootRelativePath)) {
        skipped.secret += 1;
        return;
    }
    if (artifact.sizeBytes !== null && artifact.sizeBytes > maxFileBytes) {
        skipped.oversized += 1;
        return;
    }
    const documentHit = cache.get("normalized_document", documentKey);
    const lexicalHit = wantsLexical
        ? cache.get("lexical_features", lexicalKey)
        : undefined;
    const portableHit = wantsInterpretation
        ? cache.get("interpretation", interpretKey)
        : undefined;
    const repositorySubjectId = `repo:${rootKeyById.get(artifact.rootId) ?? artifact.rootId}`;
    const interpretHit = portableHit === undefined
        ? undefined
        : {
            assertions: (0, interpretation_1.bindPortableAssertions)(portableHit.assertions, repositorySubjectId),
            diagnostics: portableHit.diagnostics,
        };
    const identifierKey = (0, corpus_cache_1.normalizedDocumentKey)({
        contentHash,
        decoderId: exports.MANIFEST_DECODER_ID,
        decoderVersion: exports.MANIFEST_DECODER_VERSION,
    });
    const identifierHit = wantsIdentifier
        ? cache.get("normalized_document", identifierKey)
        : undefined;
    const needsText = documentHit === undefined
        || (wantsLexical && lexicalHit === undefined && documentHit.decodes)
        || (wantsInterpretation && interpretHit === undefined && documentHit.decodes)
        || (wantsIdentifier && identifierHit === undefined && documentHit.decodes);
    if (documentHit !== undefined)
        normalized.set(artifact.virtualSourceId, documentHit);
    if (lexicalHit !== undefined)
        lexical.set(artifact.virtualSourceId, lexicalHit);
    if (interpretHit !== undefined)
        interpreted.set(artifact.virtualSourceId, interpretHit);
    if (identifierHit !== undefined)
        manifestIdentifiers.set(artifact.virtualSourceId, identifierHit.declared);
    if (!needsText) {
        session?.completeDecoder(documentKey);
        return;
    }
    const absolute = artifact.absolutePath;
    if (absolute === null) {
        skipped.unreadable += 1;
        return;
    }
    const reserve = artifact.sizeBytes ?? 0;
    await memory.reserve(reserve);
    try {
        const encoding = (0, encoding_1.probeFileEncoding)(absolute);
        if (encoding.status !== "utf8") {
            if (encoding.status === "unreadable")
                skipped.unreadable += 1;
            else
                skipped.encoding += 1;
            const record = {
                decodes: false,
                reason: encoding.status,
                byte_length: artifact.sizeBytes ?? 0,
                normalized_content_hash: null,
                token_count: 0,
            };
            cache.put("normalized_document", documentKey, record);
            normalized.set(artifact.virtualSourceId, record);
            return;
        }
        let text;
        try {
            text = fs.readFileSync(absolute, "utf8");
        }
        catch {
            skipped.unreadable += 1;
            return;
        }
        const analysisText = (0, corpus_analysis_1.normalizeForAnalysis)(text);
        const tokens = (0, corpus_analysis_1.analysisTokens)(analysisText);
        const record = {
            decodes: true,
            reason: null,
            byte_length: Buffer.byteLength(text, "utf8"),
            normalized_content_hash: (0, repository_model_1.stableId)("normtext", { text: analysisText }),
            token_count: tokens.length,
        };
        cache.put("normalized_document", documentKey, record);
        normalized.set(artifact.virtualSourceId, record);
        session?.completeDecoder(documentKey);
        if (wantsLexical && lexicalHit === undefined) {
            const features = {
                normalized_content_hash: record.normalized_content_hash,
                token_count: tokens.length,
                shingles: [...(0, corpus_analysis_1.shingleSet)(tokens)],
                term_counts: termCounts(tokens),
            };
            cache.put("lexical_features", lexicalKey, features);
            lexical.set(artifact.virtualSourceId, features);
        }
        if (wantsInterpretation && interpretHit === undefined) {
            const observedPaths = rootPathsById.get(artifact.rootId) ?? new Set();
            // Whether the extractor set consulted the rest of the root is discovered
            // rather than assumed. A document whose interpretation depended on which
            // other paths exist is not a function of its own bytes, so it is
            // computed and used but never stored: a later run with a different root
            // would otherwise read back an answer that is no longer true.
            let consultedRoot = false;
            const result = (0, interpretation_1.interpretDocumentContent)({
                repositorySubjectId,
                sourcePath: artifact.rootRelativePath,
                content: text,
                extractors,
                pathExists: (relativePath) => {
                    consultedRoot = true;
                    return observedPaths.has(relativePath.replace(/^\.\//, ""));
                },
            });
            if (!consultedRoot) {
                const portable = {
                    assertions: (0, interpretation_1.toPortableAssertions)(result.assertions),
                    diagnostics: result.diagnostics,
                };
                cache.put("interpretation", interpretKey, portable);
            }
            interpreted.set(artifact.virtualSourceId, {
                assertions: result.assertions,
                diagnostics: result.diagnostics,
            });
        }
        if (wantsIdentifier && identifierHit === undefined) {
            const declared = (0, corpus_candidates_1.readDeclaredIdentifier)(artifact.basename, text) ?? null;
            cache.put("normalized_document", identifierKey, { declared });
            manifestIdentifiers.set(artifact.virtualSourceId, declared);
        }
    }
    finally {
        memory.release(reserve);
    }
}
/**
 * A previous run's hashes for one root, keyed by root-relative path.
 *
 * Only artifacts with both a hash and the stat they were hashed at are eligible:
 * a record missing either cannot be revalidated, and an unrevalidatable record is
 * not a reason to skip reading a file. Archive members are excluded — their bytes
 * live inside an archive this run re-reads, so there is nothing to stat.
 */
function knownHashesForRoot(rootId, previous) {
    const known = new Map();
    for (const artifact of previous?.artifacts ?? []) {
        if (artifact.root_id !== rootId)
            continue;
        if (artifact.is_archive_member)
            continue;
        if (artifact.content_hash === null || artifact.stat_precheck === undefined)
            continue;
        known.set(artifact.root_relative_path, {
            content_hash: artifact.content_hash,
            size_bytes: artifact.stat_precheck.size_bytes,
            mtime_ms: artifact.stat_precheck.mtime_ms,
            ...(artifact.stat_precheck.mtime_ns !== undefined
                ? { mtime_ns: artifact.stat_precheck.mtime_ns }
                : {}),
        });
    }
    return known;
}
// ───────────────────────────── the scan ─────────────────────────────
/**
 * Observe every root, derive the corpus, and project it.
 *
 * Asynchronous because the decode stage is bounded rather than unbounded: the
 * budgets decide how many documents are in flight and how many bytes of text are
 * held at once, and both of those need something to wait on.
 */
async function runCorpusScan(input) {
    if (input.roots.length === 0)
        throw new Error("corpus: at least one --root is required");
    const cache = input.cache ?? new corpus_cache_1.NullCorpusCache();
    // Every ratio this run reports is its own. A cache shared with an earlier scan
    // has that scan's counters in it, and averaging the two would describe neither.
    const cacheAtStart = cache.stats();
    const cacheNotesAtStart = cache.diagnostics().length;
    const session = input.session;
    const diagnostics = [];
    const budgets = {
        ...corpus_session_1.DEFAULT_CORPUS_BUDGETS,
        ...input.budgets,
    };
    const maxFileBytes = input.maxFileBytes ?? interpretation_1.DEFAULT_MAX_FILE_BYTES;
    const nearDuplicatesEnabled = input.nearDuplicates?.enabled !== false;
    const nearDuplicateThreshold = input.nearDuplicates?.threshold ?? corpus_analysis_1.DEFAULT_NEAR_DUPLICATE_THRESHOLD;
    const topicsEnabled = input.topics?.enabled !== false;
    const topicThreshold = input.topics?.threshold ?? corpus_candidates_1.DEFAULT_TOPIC_THRESHOLD;
    const extractors = (0, extractors_1.defaultExtractors)();
    const interpretProfile = (0, interpretation_1.interpretationProfileHash)(extractors);
    const interpretEnabled = input.interpret !== false;
    const verificationMode = input.verification ?? "full";
    const verifyContent = input.verifyContent === true;
    // `--verify-content` outranks `--incremental`: it exists precisely to turn a
    // stat-assisted snapshot back into a byte-verified one, so it must win when
    // both are given rather than quietly deferring to the cheaper mode.
    const knownHashesEnabled = verificationMode === "incremental"
        && !verifyContent
        && input.previousSnapshot !== undefined;
    if (budgets.max_parallel_analysis > 1) {
        diagnostics.push({
            code: "corpus.analysis_parallelism_recorded",
            severity: "info",
            message: `max_parallel_analysis=${budgets.max_parallel_analysis} was recorded, but candidate `
                + "generation is a single pass over evidence already in memory; the value is not "
                + "exercised in this release",
        });
    }
    if (budgets.max_parallel_hashers > 1) {
        diagnostics.push({
            code: "corpus.hasher_parallelism_clamped",
            severity: "info",
            message: `max_parallel_hashers=${budgets.max_parallel_hashers} was recorded, but acquisition `
                + "hashes each root with one streaming reader; the value is not exercised in this release",
        });
    }
    // ── 1. acquire every root, read-only ────────────────────────────────────
    const observations = [];
    const disposals = [];
    try {
        for (const spec of input.roots) {
            const rootKey = spec.name !== undefined && spec.name.length > 0
                ? spec.name
                : (0, corpus_roots_1.defaultRootKey)(spec.path);
            assertUsableRootKey(rootKey, spec.path);
            const observation = (0, local_source_1.acquireLocalSource)({
                path: spec.path,
                sourceKind: "auto",
                name: rootKey,
                ...(knownHashesEnabled
                    ? { knownHashes: knownHashesForRoot((0, corpus_roots_1.corpusRootId)(rootKey), input.previousSnapshot) }
                    : {}),
                expandArchives: input.expandArchives !== false,
                ...(input.archivePolicy ? { archivePolicy: input.archivePolicy } : {}),
                ...(input.omitPatterns ? { omitPatterns: input.omitPatterns } : {}),
                ...(input.omitFile !== undefined ? { omitFile: input.omitFile } : {}),
                ...(input.hashMaxBytes !== undefined ? { hashMaxBytes: input.hashMaxBytes } : {}),
                ...(input.scratchParent !== undefined ? { scratchParent: input.scratchParent } : {}),
            });
            disposals.push(observation);
            if (!observation.stable) {
                throw new Error(`corpus: SOURCE_CHANGED_DURING_OBSERVATION under root '${rootKey}'; `
                    + "the root changed while it was being read, so it has no deterministic snapshot");
            }
            const rootId = (0, corpus_roots_1.corpusRootId)(rootKey);
            observations.push({
                binding: {
                    root_id: rootId,
                    root_key: rootKey,
                    root_label: rootKey,
                    root_snapshot_id: (0, corpus_roots_1.corpusRootSnapshotId)(observation.physicalSnapshotHash),
                    source_kind: observation.sourceKind,
                    source_revision: observation.sourceRevision,
                    physical_snapshot_hash: observation.physicalSnapshotHash,
                    absolute_path: path.resolve(spec.path),
                    key_declared: spec.name !== undefined && spec.name.length > 0,
                },
                observation,
            });
        }
        const bound = (0, corpus_roots_1.bindCorpusRoots)(observations.map((entry) => entry.binding));
        for (const folded of bound.folded) {
            diagnostics.push({
                code: "corpus.root_folded",
                severity: "info",
                message: `root '${folded.root_key}' was mounted twice with identical content; `
                    + `${folded.absolute_path} was folded into ${folded.kept_absolute_path}`,
            });
        }
        const keptPaths = new Set(bound.roots.map((root) => root.absolute_path));
        const active = observations.filter((entry) => keptPaths.has(entry.binding.absolute_path));
        const bindingById = new Map(bound.roots.map((root) => [root.root_id, root]));
        // ── 2. corpus identity ────────────────────────────────────────────────
        const candidateProfile = (0, corpus_candidates_1.candidateProfileHash)({
            topicThreshold,
            nearDuplicateThreshold,
        });
        const corpusProfileHash = (0, repository_model_1.stableId)("corpus-profile", {
            candidate_profile_hash: candidateProfile,
            corpus_profile_id: corpus_analysis_1.CORPUS_PROFILE_ID,
            corpus_profile_version: corpus_analysis_1.CORPUS_PROFILE_VERSION,
            exact_duplicate_method: corpus_analysis_1.EXACT_DUPLICATE_METHOD,
            exact_duplicate_version: corpus_analysis_1.EXACT_DUPLICATE_METHOD_VERSION,
            expand_archives: input.expandArchives !== false,
            interpretation_enabled: interpretEnabled,
            interpretation_profile_hash: interpretProfile,
            max_file_bytes: maxFileBytes,
            near_duplicate_enabled: nearDuplicatesEnabled,
            near_duplicate_method: corpus_analysis_1.NEAR_DUPLICATE_METHOD,
            near_duplicate_version: corpus_analysis_1.NEAR_DUPLICATE_METHOD_VERSION,
            readiness_profile_hash: (0, corpus_readiness_1.readinessProfileHash)(),
            text_decoder_id: exports.TEXT_DECODER_ID,
            text_decoder_version: exports.TEXT_DECODER_VERSION,
            topic_candidates_enabled: topicsEnabled,
        });
        const corpusIdLabel = input.corpusId ?? corpus_roots_1.DEFAULT_CORPUS_ID;
        // Every decoder that can claim bytes in this release, named with its version.
        // A decoder revision changes what the normalized documents say and so changes
        // the analysis identity; it changes nothing about the bytes.
        const documentDecoderProfiles = [
            `${exports.TEXT_DECODER_ID}@${exports.TEXT_DECODER_VERSION}`,
            `${exports.MANIFEST_DECODER_ID}@${exports.MANIFEST_DECODER_VERSION}`,
        ];
        const embeddingProfile = input.embeddingReport?.enabled === true
            ? (0, repository_model_1.stableId)("embedding-profile", {
                chunk_profile: input.embeddingReport.chunk_profile,
                model_id: input.embeddingReport.model_id ?? "",
                model_revision: input.embeddingReport.model_revision ?? "",
                provider: input.embeddingReport.provider ?? "",
            })
            : null;
        // ── 3. corpus artifacts ───────────────────────────────────────────────
        const previousPrechecks = input.previousSnapshot
            ? (0, corpus_snapshot_1.snapshotPrechecks)(input.previousSnapshot)
            : new Map();
        const precheck = { predicted_unchanged: 0, confirmed_unchanged: 0, contradicted: 0 };
        const previousHashes = new Map((input.previousSnapshot?.artifacts ?? []).map((artifact) => [
            artifact.virtual_source_id,
            artifact.content_hash,
        ]));
        const artifacts = [];
        const archives = [];
        const rootPathsById = new Map();
        let scannedFiles = 0;
        let scannedBytes = 0;
        for (const entry of active) {
            const binding = bindingById.get(entry.binding.root_id);
            const observed = new Set();
            const memberPaths = new Set(entry.observation.virtualArtifacts.map((member) => member.virtualSourcePath));
            for (const record of entry.observation.inventory.records) {
                observed.add(record.relative_path);
                if (record.artifact_type === "folder")
                    continue;
                const rootRelativePath = record.relative_path;
                const identity = (0, corpus_roots_1.virtualSourceId)(binding.root_id, rootRelativePath);
                const basename = basenameOf(rootRelativePath);
                const contentHash = normalizeHash(record.content_hash);
                const artifact = {
                    virtualSourceId: identity,
                    corpusPath: (0, corpus_roots_1.corpusPath)(binding.root_label, rootRelativePath),
                    rootId: binding.root_id,
                    rootRelativePath,
                    absolutePath: record.absolute_path,
                    contentHash,
                    sizeBytes: record.size_bytes,
                    artifactType: record.artifact_type,
                    isArchiveMember: memberPaths.has(rootRelativePath),
                    basename,
                    extension: extensionOf(basename),
                };
                if (!artifact.isArchiveMember && record.absolute_path !== null) {
                    try {
                        const stats = fs.statSync(record.absolute_path);
                        // The nanosecond field is recorded when the platform keeps one, so
                        // the next incremental run can revalidate against the finest tick
                        // available rather than a millisecond one it might sit inside.
                        let mtimeNs = null;
                        try {
                            mtimeNs = fs.statSync(record.absolute_path, { bigint: true }).mtimeNs.toString();
                        }
                        catch {
                            // No high-resolution stat here; the millisecond field still stands.
                        }
                        artifact.statPrecheck = {
                            size_bytes: stats.size,
                            mtime_ms: Math.trunc(stats.mtimeMs),
                            ...(mtimeNs !== null ? { mtime_ns: mtimeNs } : {}),
                        };
                    }
                    catch {
                        // A file that vanished between acquisition and here contributes no
                        // hint. It contributes no identity either: the hash already decided.
                    }
                }
                // The hint is scored against the hash that was just computed, and then
                // discarded. It has no other effect anywhere in this file.
                if (artifact.statPrecheck !== undefined
                    && (0, corpus_cache_1.statPrecheckMatches)(previousPrechecks.get(identity), artifact.statPrecheck)) {
                    precheck.predicted_unchanged += 1;
                    if (previousHashes.get(identity) === contentHash)
                        precheck.confirmed_unchanged += 1;
                    else
                        precheck.contradicted += 1;
                }
                scannedFiles += 1;
                scannedBytes += record.size_bytes ?? 0;
                if (contentHash !== null) {
                    (0, corpus_cache_1.cached)(cache, "raw_identity", (0, corpus_cache_1.rawIdentityKey)({ contentHash }), () => ({
                        exact_content_hash: contentHash,
                    }));
                    session?.completeSource(identity);
                }
                artifacts.push(artifact);
            }
            rootPathsById.set(binding.root_id, observed);
            for (const archive of entry.observation.archives) {
                archives.push({
                    archive_id: (0, corpus_roots_1.virtualSourceId)(binding.root_id, archive.sourcePath),
                    corpus_path: (0, corpus_roots_1.corpusPath)(binding.root_label, archive.sourcePath),
                    root_id: binding.root_id,
                    content_hash: archive.contentHash,
                    size_bytes: archive.sizeBytes,
                    member_count: archive.memberCount,
                    expanded: archive.expanded,
                });
                session?.completeArchive(archive.contentHash);
            }
            for (const diagnostic of entry.observation.diagnostics) {
                if (diagnostic.severity === "info")
                    continue;
                diagnostics.push({
                    code: diagnostic.code,
                    severity: diagnostic.severity,
                    message: diagnostic.message,
                    ...(diagnostic.sourcePath !== undefined
                        ? { corpus_path: (0, corpus_roots_1.corpusPath)(binding.root_label, diagnostic.sourcePath) }
                        : {}),
                });
            }
        }
        artifacts.sort((a, b) => (0, ordering_1.compareCodePoints)(a.corpusPath, b.corpusPath));
        // ── 4. derived layers, keyed on content ───────────────────────────────
        const normalized = new Map();
        const lexical = new Map();
        const interpreted = new Map();
        const skipped = { secret: 0, oversized: 0, encoding: 0, unreadable: 0 };
        const manifestIdentifiers = new Map();
        const memory = new corpus_session_1.MemoryBudget(budgets.max_memory_bytes);
        // Anything an extractor claims must be something the decoder is willing to
        // open, or interpretation coverage would report a gap the decoder set caused
        // rather than the corpus. The extension list is the floor, not the ceiling.
        const decodable = artifacts.filter((artifact) => artifact.contentHash !== null
            && (isTextDecodable(artifact.rootRelativePath)
                || extractors.some((extractor) => extractor.matches(artifact.rootRelativePath))));
        await (0, corpus_session_1.boundedMap)(decodable, budgets.max_parallel_decoders, (artifact) => deriveDocumentLayers(artifact, {
            cache,
            ...(session !== undefined ? { session } : {}),
            memory,
            extractors,
            candidateProfile,
            interpretProfile,
            interpretEnabled,
            maxFileBytes,
            rootPathsById,
            rootKeyById: new Map(bound.roots.map((root) => [root.root_id, root.root_key])),
            into: { normalized, lexical, interpreted, manifestIdentifiers, skipped },
        }));
        // ── 4b. per-root Repository Model Packets ─────────────────────────────
        // Each root is modelled on its own, exactly as it would be if it had been
        // observed alone: the corpus is an analysis over several roots, not a
        // synthetic filesystem that replaces them. Nothing about the corpus — its
        // name, its other roots, its thresholds — reaches a packet, so a root carries
        // the same packet id into every corpus it is ever named in.
        const builtPackets = [];
        for (const entry of active) {
            const binding = bindingById.get(entry.binding.root_id);
            const rootAssertions = [];
            const rootDiagnostics = [];
            for (const artifact of artifacts) {
                if (artifact.rootId !== binding.root_id)
                    continue;
                const record = interpreted.get(artifact.virtualSourceId);
                if (record === undefined)
                    continue;
                rootAssertions.push(...record.assertions);
                rootDiagnostics.push(...record.diagnostics);
            }
            const packet = (0, repository_model_1.buildRepositoryModelPacket)({
                inventory: entry.observation.inventory,
                repositoryName: binding.root_key,
                sourceRevision: binding.source_revision,
                producerVersion: input.producerVersion,
                localSource: (0, local_source_model_1.toRepositoryModelLocalSource)(entry.observation),
                ...(interpretEnabled
                    ? {
                        interpretation: {
                            profile: {
                                profile_id: interpretation_1.INTERPRETATION_PROFILE_ID,
                                profile_version: interpretation_1.INTERPRETATION_PROFILE_VERSION,
                                profile_hash: interpretProfile,
                                extractor_versions: Object.fromEntries([...extractors]
                                    .sort((a, b) => (0, ordering_1.compareCodePoints)(a.id, b.id))
                                    .map((extractor) => [extractor.id, extractor.version])),
                            },
                            // Sorted so a packet does not inherit the order documents happened
                            // to finish decoding in; the decode stage is bounded-parallel.
                            assertions: [...rootAssertions].sort((a, b) => (0, ordering_1.compareCodePoints)(a.assertion_id, b.assertion_id)),
                            diagnostics: [...rootDiagnostics].sort((a, b) => (0, ordering_1.compareCodePoints)(a.code, b.code) || (0, ordering_1.compareCodePoints)(a.message, b.message)),
                        },
                    }
                    : {}),
                ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
            });
            builtPackets.push({
                binding,
                packet,
                // Operational, and the only wall clock in a root's own outputs: it says
                // when the drive was read, which is a fact about the run rather than
                // about the corpus. Deterministic unless the caller supplies one.
                localSourceManifest: (0, local_source_model_1.buildLocalSourceManifest)(entry.observation, {
                    observedAt: input.observedAt ?? "1970-01-01T00:00:00.000Z",
                }),
            });
        }
        builtPackets.sort((a, b) => (0, ordering_1.compareCodePoints)(a.binding.root_id, b.binding.root_id));
        const packetByRoot = new Map(builtPackets.map((e) => [e.binding.root_id, e.packet]));
        // ── 4c. corpus identity, in two halves ────────────────────────────────
        const sourceSnapshotId = (0, corpus_roots_1.corpusSourceSnapshotId)(bound.roots.map((root) => ({
            root_id: root.root_id,
            source_revision: root.source_revision,
            rmp_packet_id: packetByRoot.get(root.root_id)?.packet_id ?? "",
        })));
        const analysisIdentity = {
            corpus_analysis_id: (0, corpus_roots_1.corpusAnalysisId)({
                corpusSourceSnapshotId: sourceSnapshotId,
                profiles: {
                    corpus_profile: corpusProfileHash,
                    document_decoder_profiles: documentDecoderProfiles,
                    interpretation_profile: interpretProfile,
                    semantic_candidate_profile: candidateProfile,
                    ...(embeddingProfile !== null ? { embedding_profile: embeddingProfile } : {}),
                    readiness_profile: (0, corpus_readiness_1.readinessProfileHash)(),
                },
            }),
            corpus_profile: corpusProfileHash,
            document_decoder_profiles: [...documentDecoderProfiles],
            interpretation_profile: interpretProfile,
            semantic_candidate_profile: candidateProfile,
            embedding_profile: embeddingProfile,
            readiness_profile: (0, corpus_readiness_1.readinessProfileHash)(),
        };
        session?.setTarget(sourceSnapshotId);
        // ── 5. readiness signals ──────────────────────────────────────────────
        const readinessInputs = artifacts.map((artifact) => ({
            virtual_source_id: artifact.virtualSourceId,
            corpus_path: artifact.corpusPath,
            root_relative_path: artifact.rootRelativePath,
            content_hash: artifact.contentHash,
            size_bytes: artifact.sizeBytes,
            is_archive_member: artifact.isArchiveMember,
            // The outermost archive a member sits in, so two members of one ZIP count
            // as one archive rather than two.
            archive_id: archiveAncestryOf(artifact.rootRelativePath)[0] ?? null,
            decoded: normalized.get(artifact.virtualSourceId)?.decodes === true,
            unsupported_format: UNDECODED_EXTENSIONS.has(artifact.extension),
            assertions: (interpreted.get(artifact.virtualSourceId)?.assertions ?? []).map((assertion) => ({
                predicate: assertion.predicate,
                object: assertion.object,
            })),
        }));
        const signalsById = new Map(readinessInputs.map((artifact) => [artifact.virtual_source_id, (0, corpus_readiness_1.readinessSignalsFor)(artifact)]));
        // ── 6. corpus-scope analyses ──────────────────────────────────────────
        const clusters = (0, corpus_analysis_1.clusterExactDuplicates)(artifacts
            .filter((artifact) => artifact.contentHash !== null)
            .map((artifact) => ({
            artifactId: artifact.virtualSourceId,
            sourcePath: artifact.corpusPath,
            contentHash: artifact.contentHash,
            sizeBytes: artifact.sizeBytes,
        })));
        const relations = (0, corpus_analysis_1.buildDuplicateRelations)(clusters);
        const lexicalDocuments = [];
        for (const artifact of artifacts) {
            const features = lexical.get(artifact.virtualSourceId);
            if (features === undefined || artifact.contentHash === null)
                continue;
            lexicalDocuments.push({
                artifactId: artifact.virtualSourceId,
                sourcePath: artifact.corpusPath,
                contentHash: artifact.contentHash,
                normalizedContentHash: features.normalized_content_hash,
                shingles: new Set(features.shingles),
                tokenCount: features.token_count,
            });
        }
        // Each input's identity, not just its bytes. The candidate documents embed
        // artifact ids and corpus paths, so a corpus whose documents are unchanged but
        // renamed is a different input to this analysis: keying on content alone would
        // serve back candidates naming artifacts the current snapshot does not have.
        const featureIdentities = lexicalDocuments.map((document) => `${document.artifactId} ${document.sourcePath} ${document.normalizedContentHash}`);
        const nearKey = (0, corpus_cache_1.candidateAnalysisKey)({
            inputFeatureIdentities: [...featureIdentities, `near:${nearDuplicateThreshold.toFixed(6)}`],
            candidateProfileHash: candidateProfile,
        });
        const nearCandidates = nearDuplicatesEnabled
            ? (0, corpus_cache_1.cached)(cache, "candidate_analysis", nearKey, () => (0, corpus_analysis_1.nearDuplicateCandidates)(lexicalDocuments, nearDuplicateThreshold))
            : [];
        if (nearDuplicatesEnabled)
            session?.completeAnalysis(nearKey);
        const topicKey = (0, corpus_cache_1.candidateAnalysisKey)({
            inputFeatureIdentities: [...featureIdentities, `topic:${topicThreshold.toFixed(6)}`],
            candidateProfileHash: candidateProfile,
        });
        const rootByArtifact = new Map(artifacts.map((artifact) => [artifact.virtualSourceId, artifact.rootId]));
        const topicCandidates = topicsEnabled
            ? (0, corpus_cache_1.cached)(cache, "candidate_analysis", topicKey, () => (0, corpus_candidates_1.buildTopicCandidates)({
                documents: artifacts
                    .filter((artifact) => lexical.has(artifact.virtualSourceId))
                    .map((artifact) => {
                    const features = lexical.get(artifact.virtualSourceId);
                    return {
                        virtual_source_id: artifact.virtualSourceId,
                        corpus_path: artifact.corpusPath,
                        term_counts: features.term_counts,
                        token_count: features.token_count,
                    };
                }),
                threshold: topicThreshold,
                rootById: rootByArtifact,
            }))
            : [];
        if (topicsEnabled)
            session?.completeAnalysis(topicKey);
        const markers = [];
        for (const artifact of artifacts) {
            const signals = signalsById.get(artifact.virtualSourceId) ?? [];
            const isManifest = signals.some((signal) => signal.signal === "artifact.has_build_manifest");
            const isCi = signals.some((signal) => signal.signal === "artifact.has_ci_definition");
            if (!isManifest && !isCi)
                continue;
            const declared = isManifest ? manifestIdentifiers.get(artifact.virtualSourceId) ?? null : null;
            markers.push({
                virtual_source_id: artifact.virtualSourceId,
                root_id: artifact.rootId,
                root_relative_path: artifact.rootRelativePath,
                corpus_path: artifact.corpusPath,
                marker_kind: isManifest ? "build_manifest" : "ci_definition",
                ...(declared !== null
                    ? {
                        declared_identifier: declared.identifier,
                        declared_identifier_evidence: { field: declared.field, line: declared.line },
                    }
                    : {}),
            });
        }
        const projectCandidates = (0, corpus_candidates_1.buildProjectCandidates)({
            markers,
            members: artifacts.map((artifact) => ({
                virtual_source_id: artifact.virtualSourceId,
                root_id: artifact.rootId,
                root_relative_path: artifact.rootRelativePath,
                corpus_path: artifact.corpusPath,
            })),
            rootLabels: new Map(bound.roots.map((root) => [root.root_id, root.root_label])),
        });
        // ── 7. projections ────────────────────────────────────────────────────
        const clusterByArtifact = new Map();
        for (const cluster of clusters) {
            for (const artifactId of cluster.artifact_ids)
                clusterByArtifact.set(artifactId, cluster.cluster_id);
        }
        const nearByArtifact = indexMembership(nearCandidates, (candidate) => [
            candidate.artifact_a_id,
            candidate.artifact_b_id,
        ], (candidate) => candidate.candidate_id);
        const topicByArtifact = indexMembership(topicCandidates, (candidate) => candidate.member_ids, (candidate) => candidate.candidate_id);
        const projectByArtifact = indexMembership(projectCandidates, (candidate) => candidate.member_ids, (candidate) => candidate.candidate_id);
        const snapshotArtifacts = artifacts.map((artifact) => ({
            virtual_source_id: artifact.virtualSourceId,
            corpus_path: artifact.corpusPath,
            root_id: artifact.rootId,
            root_relative_path: artifact.rootRelativePath,
            content_hash: artifact.contentHash,
            size_bytes: artifact.sizeBytes,
            is_archive_member: artifact.isArchiveMember,
            artifact_type: artifact.artifactType,
            ...(artifact.statPrecheck !== undefined ? { stat_precheck: artifact.statPrecheck } : {}),
        }));
        const orderedArchives = [...archives].sort((a, b) => (0, ordering_1.compareCodePoints)(a.corpus_path, b.corpus_path));
        const snapshotRoots = bound.roots.map((root) => {
            const packet = packetByRoot.get(root.root_id);
            return {
                ...(0, corpus_roots_1.rootIdentity)(root),
                rmp_packet_id: packet?.packet_id ?? "",
                rmp_semantic_hash: packet?.semantic_hash ?? "",
                // Output-relative, so a snapshot copied to another machine still points at
                // its own bundles. The absolute location is the operator's business.
                bundle_ref: packet === undefined ? null : `roots/${(0, corpus_roots_1.rootDirectoryName)(root.root_key)}/bundle`,
                observation_status: packet === undefined ? "failed" : "observed",
                failure_reason: null,
            };
        });
        const hashingTotals = active.reduce((sum, entry) => ({
            fully_rehashed_count: sum.fully_rehashed_count + entry.observation.hashing.fully_rehashed_count,
            cached_reuse_count: sum.cached_reuse_count + entry.observation.hashing.cached_reuse_count,
            unhashed_count: sum.unhashed_count + entry.observation.hashing.unhashed_count,
        }), { fully_rehashed_count: 0, cached_reuse_count: 0, unhashed_count: 0 });
        // The label follows the run, not the request. An incremental run that happened
        // to reuse nothing did read every byte and may say so; a run that reused even
        // one hash did not, whatever mode it was asked for.
        const verification = {
            mode: verificationMode,
            verify_content_requested: verifyContent,
            verification_class: hashingTotals.cached_reuse_count === 0
                ? "fully_verified"
                : "cached_unchanged_assumption",
            fully_rehashed_artifact_count: hashingTotals.fully_rehashed_count,
            cached_hash_reuse_count: hashingTotals.cached_reuse_count,
            unhashed_artifact_count: hashingTotals.unhashed_count,
            statement: hashingTotals.cached_reuse_count === 0
                ? corpus_snapshot_1.FULLY_VERIFIED_STATEMENT
                : corpus_snapshot_1.CACHED_ASSUMPTION_STATEMENT,
        };
        const corpusStatus = snapshotRoots.every((root) => root.observation_status === "observed")
            ? "complete"
            : "partial";
        const snapshot = {
            schema: corpus_snapshot_1.CORPUS_SNAPSHOT_SCHEMA,
            corpus_id: corpusIdLabel,
            corpus_source_snapshot_id: sourceSnapshotId,
            analysis: analysisIdentity,
            corpus_status: corpusStatus,
            verification,
            missing_root_ids: [],
            roots: snapshotRoots,
            artifacts: snapshotArtifacts,
            archives: orderedArchives,
            counts: {
                root_count_requested: input.roots.length,
                root_count_observed: snapshotRoots.filter((r) => r.observation_status === "observed").length,
                root_count_failed: snapshotRoots.filter((r) => r.observation_status !== "observed").length,
                root_count: bound.roots.length,
                artifact_count: artifacts.length,
                archive_count: archives.length,
                archive_member_count: artifacts.filter((artifact) => artifact.isArchiveMember).length,
                total_bytes: artifacts.reduce((sum, artifact) => sum + (artifact.sizeBytes ?? 0), 0),
            },
        };
        const crossRoot = (items) => items.filter((item) => item.root_ids.length > 1).length;
        const clusterRootIds = (cluster) => [
            ...new Set(cluster.artifact_ids.map((id) => rootByArtifact.get(id) ?? "")),
        ];
        const candidatesDocument = {
            schema: exports.CORPUS_CANDIDATES_SCHEMA,
            corpus_source_snapshot_id: sourceSnapshotId,
            corpus_analysis_id: analysisIdentity.corpus_analysis_id,
            corpus_profile_hash: corpusProfileHash,
            roots: bound.roots.map(corpus_roots_1.rootIdentity),
            analysis_profile: {
                corpus_profile_id: corpus_analysis_1.CORPUS_PROFILE_ID,
                corpus_profile_version: corpus_analysis_1.CORPUS_PROFILE_VERSION,
                exact_duplicate_method: corpus_analysis_1.EXACT_DUPLICATE_METHOD,
                exact_duplicate_version: corpus_analysis_1.EXACT_DUPLICATE_METHOD_VERSION,
                near_duplicate_method: corpus_analysis_1.NEAR_DUPLICATE_METHOD,
                near_duplicate_version: corpus_analysis_1.NEAR_DUPLICATE_METHOD_VERSION,
                near_duplicate_threshold: Math.round(nearDuplicateThreshold * 1e6) / 1e6,
                near_duplicate_enabled: nearDuplicatesEnabled,
                topic_candidate_method: topicCandidates[0]?.method ?? "lexical-topic-candidate/v1",
                topic_candidate_version: topicCandidates[0]?.algorithm_version ?? "1.0.0",
                topic_threshold: Math.round(topicThreshold * 1e6) / 1e6,
                topic_candidates_enabled: topicsEnabled,
                project_candidate_method: "container-project-candidate/v1",
                project_candidate_version: "1.0.0",
                candidate_profile_hash: candidateProfile,
                interpretation_profile_hash: interpretProfile,
            },
            summary: {
                artifact_count: artifacts.length,
                archive_count: archives.length,
                archive_member_count: snapshot.counts.archive_member_count,
                root_count: bound.roots.length,
                exact_duplicate_cluster_count: clusters.length,
                exact_duplicate_artifact_count: clusters.reduce((sum, cluster) => sum + cluster.count, 0),
                cross_root_duplicate_cluster_count: clusters.filter((cluster) => clusterRootIds(cluster).length > 1).length,
                recoverable_duplicate_bytes: clusters.reduce((sum, cluster) => sum + cluster.recoverable_bytes, 0),
                near_duplicate_candidate_count: nearCandidates.length,
                cross_root_near_duplicate_count: nearCandidates.filter((candidate) => rootByArtifact.get(candidate.artifact_a_id) !== rootByArtifact.get(candidate.artifact_b_id)).length,
                topic_candidate_count: topicCandidates.length,
                cross_root_topic_candidate_count: crossRoot(topicCandidates),
                project_candidate_count: projectCandidates.length,
                cross_root_project_candidate_count: crossRoot(projectCandidates),
            },
            artifacts: artifacts.map((artifact) => ({
                virtual_source_id: artifact.virtualSourceId,
                corpus_path: artifact.corpusPath,
                root_id: artifact.rootId,
                artifact_type: artifact.artifactType,
                content_hash: artifact.contentHash,
                size_bytes: artifact.sizeBytes,
                is_archive_member: artifact.isArchiveMember,
                exact_duplicate_cluster_id: clusterByArtifact.get(artifact.virtualSourceId) ?? null,
                near_duplicate_candidate_ids: (nearByArtifact.get(artifact.virtualSourceId) ?? []).sort(ordering_1.compareCodePoints),
                topic_candidate_ids: (topicByArtifact.get(artifact.virtualSourceId) ?? []).sort(ordering_1.compareCodePoints),
                project_candidate_ids: (projectByArtifact.get(artifact.virtualSourceId) ?? []).sort(ordering_1.compareCodePoints),
            })),
            exact_duplicate_clusters: clusters,
            relations,
            near_duplicate_candidates: nearCandidates,
            topic_candidates: topicCandidates,
            project_candidates: projectCandidates,
            candidate_statement: exports.CANDIDATE_STATEMENT,
        };
        const exactDuplicateIds = new Set(clusterByArtifact.keys());
        const nearPairs = nearCandidates.map((candidate) => [candidate.artifact_a_id, candidate.artifact_b_id]);
        const bodies = projectCandidates.map((candidate) => ({
            origin: candidate.identifier_is_declared ? "explicit_project_identifier" : "project_candidate",
            origin_ref: candidate.project_key,
            member_ids: candidate.member_ids,
        }));
        // ── 7. normalized documents, written down ─────────────────────────────
        //
        // Every field below was already established above. The index exists because
        // a later pass reasoning over documents cannot recover which artifact a
        // document came from, which source bytes it describes, or which decoder
        // produced it, once the run has ended.
        const documentIndex = (0, corpus_documents_1.buildDocumentIndex)({
            corpusSourceSnapshotId: sourceSnapshotId,
            corpusAnalysisId: analysisIdentity.corpus_analysis_id,
            decoderId: exports.TEXT_DECODER_ID,
            decoderVersion: exports.TEXT_DECODER_VERSION,
            artifacts: artifacts.map((artifact) => {
                const record = normalized.get(artifact.virtualSourceId);
                return {
                    artifactId: artifact.virtualSourceId,
                    rootId: artifact.rootId,
                    corpusPath: artifact.corpusPath,
                    rootRelativePath: artifact.rootRelativePath,
                    contentHash: artifact.contentHash,
                    sizeBytes: artifact.sizeBytes,
                    isArchiveMember: artifact.isArchiveMember,
                    archiveAncestry: archiveAncestryOf(artifact.rootRelativePath),
                    ...(record !== undefined ? { normalized: record } : {}),
                    normalizedDocumentId: artifact.contentHash === null
                        ? null
                        : (0, corpus_cache_1.normalizedDocumentKey)({
                            contentHash: artifact.contentHash,
                            decoderId: exports.TEXT_DECODER_ID,
                            decoderVersion: exports.TEXT_DECODER_VERSION,
                        }),
                };
            }),
        });
        // ── 7b. per-root projections ──────────────────────────────────────────
        // Each root's own index, built from the same records as the corpus one but
        // scoped to that root. An operator who later wants only the old SSD finds it
        // whole under `roots/old-ssd/` rather than having to filter a corpus file.
        const documentsByRoot = new Map();
        for (const document of documentIndex.documents) {
            const bucket = documentsByRoot.get(document.root_id) ?? [];
            bucket.push(document);
            documentsByRoot.set(document.root_id, bucket);
        }
        const rootPackets = builtPackets.map((entry) => {
            const documents = documentsByRoot.get(entry.binding.root_id) ?? [];
            const decoded = documents.filter((document) => document.decoded);
            const undecodedCounts = new Map();
            for (const document of documents) {
                if (document.decoded)
                    continue;
                const reason = document.undecoded_reason ?? corpus_documents_1.UNDECODED_REASON_NOT_ELIGIBLE;
                undecodedCounts.set(reason, (undecodedCounts.get(reason) ?? 0) + 1);
            }
            const rootIndex = {
                ...documentIndex,
                summary: {
                    artifact_count: documents.length,
                    decoded_count: decoded.length,
                    undecoded_count: documents.length - decoded.length,
                    distinct_document_count: new Set(decoded.map((document) => document.normalized_document_id ?? "")).size,
                    archive_member_count: documents.filter((d) => d.is_archive_member).length,
                    total_token_count: decoded.reduce((sum, d) => sum + (d.token_count ?? 0), 0),
                    undecoded_by_reason: [...undecodedCounts.entries()]
                        .map(([reason, count]) => ({ reason, count }))
                        .sort((a, b) => (0, ordering_1.compareCodePoints)(a.reason, b.reason)),
                },
                documents,
            };
            return {
                root_id: entry.binding.root_id,
                root_key: entry.binding.root_key,
                directory: (0, corpus_roots_1.rootDirectoryName)(entry.binding.root_key),
                packet: entry.packet,
                localSourceManifest: entry.localSourceManifest,
                documentIndex: rootIndex,
                documentCoverage: {
                    schema: exports.DOCUMENT_COVERAGE_SCHEMA,
                    corpus_source_snapshot_id: sourceSnapshotId,
                    corpus_analysis_id: analysisIdentity.corpus_analysis_id,
                    root_id: entry.binding.root_id,
                    root_key: entry.binding.root_key,
                    decoder: { decoder_id: exports.TEXT_DECODER_ID, decoder_version: exports.TEXT_DECODER_VERSION },
                    ...rootIndex.summary,
                },
            };
        });
        // ── 8. semantic candidate discovery ───────────────────────────────────
        let semantic = null;
        if (input.semanticAnalysis !== false) {
            const documentById = new Map(documentIndex.documents.map((doc) => [doc.artifact_id, doc]));
            const semanticArtifacts = artifacts.map((artifact) => {
                const document = documentById.get(artifact.virtualSourceId);
                const declared = manifestIdentifiers.get(artifact.virtualSourceId) ?? null;
                const features = lexical.get(artifact.virtualSourceId);
                return {
                    artifact_id: artifact.virtualSourceId,
                    root_id: artifact.rootId,
                    corpus_path: artifact.corpusPath,
                    root_relative_path: artifact.rootRelativePath,
                    content_hash: artifact.contentHash,
                    normalized_document_id: document?.normalized_document_id ?? null,
                    is_archive_member: artifact.isArchiveMember,
                    archive_ancestry: archiveAncestryOf(artifact.rootRelativePath),
                    assertions: (interpreted.get(artifact.virtualSourceId)?.assertions ?? []).map((assertion) => ({
                        assertion_id: assertion.assertion_id,
                        predicate: assertion.predicate,
                        object: assertion.object,
                    })),
                    declared_identifiers: declared === null
                        ? []
                        : [{
                                identifier: declared.identifier,
                                manifest: artifact.basename.toLowerCase(),
                                field: declared.field,
                            }],
                    exact_duplicate_cluster_id: clusterByArtifact.get(artifact.virtualSourceId) ?? null,
                    near_duplicate_candidate_ids: nearByArtifact.get(artifact.virtualSourceId) ?? [],
                    // Term counts rather than text: the lexical cache holds a bag of words
                    // and never a body, so the semantic pass never needs the source back.
                    ...(features !== undefined ? { body_term_counts: features.term_counts } : {}),
                };
            });
            const assertionsByArtifact = new Map();
            for (const [artifactId, record] of interpreted) {
                assertionsByArtifact.set(artifactId, record.assertions.map((assertion) => ({
                    assertion_id: assertion.assertion_id,
                    predicate: assertion.predicate,
                    object: assertion.object,
                    source_path: assertion.source_path,
                    evidence_excerpt: assertion.evidence_excerpt,
                    source_content_hash: assertion.source_content_hash,
                })));
            }
            semantic = (0, corpus_semantic_run_1.runSemanticAnalysis)({
                corpusSourceSnapshotId: sourceSnapshotId,
                corpusAnalysisId: analysisIdentity.corpus_analysis_id,
                artifacts: semanticArtifacts,
                nearDuplicatePairs: nearCandidates.map((candidate) => ({
                    artifact_a_id: candidate.artifact_a_id,
                    artifact_b_id: candidate.artifact_b_id,
                    score: candidate.score,
                })),
                assertionsByArtifact,
                ...(input.embeddingPairs !== undefined ? { embeddingPairs: input.embeddingPairs } : {}),
                ...(input.embeddingReport !== undefined ? { embeddingReport: input.embeddingReport } : {}),
                ...(input.packBudget !== undefined ? { packBudget: input.packBudget } : {}),
            });
            for (const note of semantic.relations.diagnostics) {
                diagnostics.push({ code: note.code, severity: note.severity, message: note.message });
            }
        }
        const decodableIds = new Set(decodable.map((artifact) => artifact.virtualSourceId));
        const decodedIds = new Set([...normalized.entries()].filter(([, record]) => record.decodes).map(([id]) => id));
        const interpretationEligible = artifacts.filter((artifact) => interpretEnabled && extractors.some((extractor) => extractor.matches(artifact.rootRelativePath)));
        const lexicalEligible = artifacts.filter((artifact) => isLexicallyAnalyzable(artifact.rootRelativePath));
        const encryptedCount = active.reduce((sum, entry) => sum
            + entry.observation.archives.reduce((holds, archive) => holds + archive.holds.filter((hold) => hold.code === "archive.member_encrypted").length, 0), 0);
        // Artifacts carrying at least one `work.*` claim. This is the denominator a
        // reader needs beside "3 blocked": three of eleven documents that say anything
        // about their own state is a different corpus from three of eleven thousand.
        const workSignalArtifacts = new Set();
        for (const [artifactId, record] of interpreted) {
            if (record.assertions.some((assertion) => assertion.predicate.startsWith("work."))) {
                workSignalArtifacts.add(artifactId);
            }
        }
        const dependencyPredicates = new Map();
        for (const record of interpreted.values()) {
            for (const assertion of record.assertions) {
                if (!assertion.predicate.startsWith("work.depends_on")
                    && !assertion.predicate.startsWith("work.blocked_by")
                    && !assertion.predicate.startsWith("work.references"))
                    continue;
                dependencyPredicates.set(assertion.predicate, (dependencyPredicates.get(assertion.predicate) ?? 0) + 1);
            }
        }
        const uniqueHashes = new Map();
        for (const artifact of artifacts) {
            if (artifact.contentHash === null)
                continue;
            if (!uniqueHashes.has(artifact.contentHash)) {
                uniqueHashes.set(artifact.contentHash, artifact.sizeBytes ?? 0);
            }
        }
        const reasoningEligible = projectCandidates.filter((candidate) => candidate.member_ids.some((id) => decodedIds.has(id))
            && candidate.member_ids.some((id) => (signalsById.get(id) ?? []).length > 0)).length;
        const cacheStats = (0, corpus_cache_1.cacheStatsDelta)(cacheAtStart, cache.stats());
        // ── 8b. readiness evidence ────────────────────────────────────────────
        // Built after candidate discovery so a body of work can be told how many
        // consolidation candidates its own members appear in. Readiness is evidence
        // about candidates; it cannot be assembled before the candidates exist.
        const consolidationsByArtifact = new Map();
        for (const candidate of semantic?.consolidations.candidates ?? []) {
            for (const memberId of candidate.member_artifact_ids) {
                const bucket = consolidationsByArtifact.get(memberId) ?? [];
                bucket.push(candidate.candidate_id);
                consolidationsByArtifact.set(memberId, bucket);
            }
        }
        const readiness = (0, corpus_readiness_1.buildReadinessEvidence)({
            corpusSourceSnapshotId: sourceSnapshotId,
            corpusAnalysisId: analysisIdentity.corpus_analysis_id,
            artifacts: readinessInputs,
            bodies,
            context: {
                signalsById,
                artifactsById: new Map(readinessInputs.map((artifact) => [artifact.virtual_source_id, artifact])),
                rootById: rootByArtifact,
                exactDuplicateIds,
                clusterByArtifact,
                consolidationsByArtifact,
                nearDuplicatePairs: nearPairs,
            },
        });
        const coverage = {
            schema: corpus_coverage_1.CORPUS_COVERAGE_SCHEMA,
            corpus_source_snapshot_id: sourceSnapshotId,
            corpus_analysis_id: analysisIdentity.corpus_analysis_id,
            root_ids: bound.roots.map((root) => root.root_id).sort(ordering_1.compareCodePoints),
            corpus: {
                root_count_requested: snapshot.counts.root_count_requested,
                root_count_observed: snapshot.counts.root_count_observed,
                root_count_failed: snapshot.counts.root_count_failed,
                total_physical_artifacts: artifacts.filter((a) => !a.isArchiveMember).length,
                total_virtual_archive_artifacts: artifacts.filter((a) => a.isArchiveMember).length,
                total_bytes_observed: snapshot.counts.total_bytes,
                archive_count: archives.length,
                archive_member_count: snapshot.counts.archive_member_count,
            },
            hashing: {
                fully_rehashed_count: verification.fully_rehashed_artifact_count,
                cached_hash_reuse_count: verification.cached_hash_reuse_count,
                unhashed_count: verification.unhashed_artifact_count,
                verification_class: verification.verification_class,
                verification_mode: verification.mode,
            },
            documents: {
                decoder_eligible_count: decodableIds.size,
                normalized_document_count: decodedIds.size,
                unsupported_format_count: artifacts.filter((artifact) => UNDECODED_EXTENSIONS.has(artifact.extension)).length,
                // A decoder that was offered bytes and could not read them. Distinct from
                // an artifact no decoder claims: one is a gap in this corpus, the other is
                // a gap in the decoder set, and merging them hides which.
                decoder_failure_count: decodableIds.size - decodedIds.size,
                ocr_required_count: artifacts.filter((a) => OCR_EXTENSIONS.has(a.extension)).length,
                encrypted_document_count: encryptedCount,
                oversized_document_count: skipped.oversized,
                secret_skipped_count: skipped.secret,
            },
            semantics: {
                interpreted_artifact_count: interpreted.size,
                work_signal_artifact_count: workSignalArtifacts.size,
                exact_duplicate_cluster_count: clusters.length,
                near_duplicate_candidate_count: nearCandidates.length,
                topic_candidate_count: topicCandidates.length,
                project_candidate_count: projectCandidates.length,
                consolidation_candidate_count: semantic?.consolidations.candidates.length ?? 0,
            },
            embeddings: {
                enabled: input.embeddingReport?.enabled === true,
                eligible_count: input.embeddingReport?.enabled === true
                    ? input.embeddingReport.eligible_artifact_count
                    : null,
                embedded_count: input.embeddingReport?.enabled === true
                    ? input.embeddingReport.embedded_artifact_count
                    : null,
                cache_hit_count: input.embeddingReport?.enabled === true
                    ? input.embeddingReport.cache_hits
                    : null,
                provider_failure_count: input.embeddingReport?.enabled === true
                    ? input.embeddingReport.eligible_artifact_count
                        - input.embeddingReport.embedded_artifact_count
                        - input.embeddingReport.secret_candidates_skipped
                    : null,
            },
            exact_hash_coverage: (0, corpus_coverage_1.coverageRatio)(artifacts.filter((artifact) => artifact.contentHash !== null).length, artifacts.length),
            normalized_document_coverage: (0, corpus_coverage_1.coverageRatio)(decodedIds.size, decodableIds.size),
            interpretation_coverage: (0, corpus_coverage_1.coverageRatio)(interpretationEligible.filter((artifact) => interpreted.has(artifact.virtualSourceId)).length, interpretationEligible.length),
            lexical_analysis_coverage: (0, corpus_coverage_1.coverageRatio)(lexicalEligible.filter((artifact) => lexical.has(artifact.virtualSourceId)).length, lexicalEligible.length),
            embedding_coverage_when_enabled: null,
            unsupported_format_counts: (0, corpus_coverage_1.formatCounts)(artifacts
                .filter((artifact) => UNDECODED_EXTENSIONS.has(artifact.extension))
                .map((artifact) => ({ extension: artifact.extension, bytes: artifact.sizeBytes ?? 0 }))),
            reasoning_handoff: {
                reasoning_eligible_candidate_count: reasoningEligible,
                reasoning_candidate_count: semantic?.reasoningCandidates.length ?? 0,
                reasoning_evidence_pack_count: semantic?.evidencePacks.length ?? 0,
                truncated_evidence_pack_count: semantic?.evidencePacks.filter((pack) => pack.truncation.truncated).length ?? 0,
                corpus_snapshot_ref: "corpus-snapshot.json",
                corpus_coverage_ref: "corpus-coverage.json",
                readiness_evidence_refs: {
                    schema: readiness.schema,
                    file: "readiness-evidence.json",
                    body_of_work_count: readiness.bodies_of_work.length,
                    signal_vocabulary: corpus_readiness_1.READINESS_SIGNALS,
                },
                dependency_evidence_refs: [...dependencyPredicates.entries()]
                    .map(([predicate, assertion_count]) => ({ predicate, assertion_count }))
                    .sort((a, b) => (0, ordering_1.compareCodePoints)(a.predicate, b.predicate)),
                duplicate_evidence_refs: {
                    exact_duplicate_cluster_count: clusters.length,
                    exact_duplicate_artifact_count: exactDuplicateIds.size,
                    recoverable_duplicate_bytes: candidatesDocument.summary.recoverable_duplicate_bytes,
                    near_duplicate_candidate_count: nearCandidates.length,
                    near_duplicate_threshold: Math.round(nearDuplicateThreshold * 1e6) / 1e6,
                },
                unique_content_estimate: uniqueHashes.size,
                unique_content_bytes_estimate: [...uniqueHashes.values()].reduce((sum, bytes) => sum + bytes, 0),
                no_priority_statement: corpus_coverage_1.NO_PRIORITY_STATEMENT,
            },
            cache: {
                enabled: cacheStats.enabled,
                hit_ratio: cacheStats.hit_ratio,
                hits: cacheStats.hits,
                misses: cacheStats.misses,
                writes: cacheStats.writes,
                corrupt: cacheStats.corrupt,
                layers: cacheStats.layers.map((layer) => ({
                    layer: layer.layer,
                    hits: layer.hits,
                    misses: layer.misses,
                    writes: layer.writes,
                    corrupt: layer.corrupt,
                })),
            },
        };
        for (const note of cache.diagnostics().slice(cacheNotesAtStart)) {
            diagnostics.push({
                code: note.code,
                severity: note.severity,
                message: `${note.layer}: ${note.message}`,
            });
            session?.fail({ code: note.code, severity: note.severity, message: note.message });
        }
        if (skipped.encoding > 0) {
            diagnostics.push({
                code: "corpus.unsupported_encoding",
                severity: "info",
                message: `${skipped.encoding} file(s) were hashed but are not valid UTF-8 and were not decoded`,
            });
        }
        const diff = input.previousSnapshot
            ? (0, corpus_diff_1.buildCorpusDiff)(input.previousSnapshot, snapshot)
            : null;
        const orderedDiagnostics = [...diagnostics].sort((a, b) => (0, ordering_1.compareCodePoints)(a.code, b.code)
            || (0, ordering_1.compareCodePoints)(a.corpus_path ?? "", b.corpus_path ?? "")
            || (0, ordering_1.compareCodePoints)(a.message, b.message));
        return {
            snapshot,
            rootPackets,
            candidates: candidatesDocument,
            readiness,
            coverage,
            diff,
            diagnostics: orderedDiagnostics,
            cacheStats,
            bindings: bound.roots,
            precheck,
            scanned: { files: scannedFiles, bytes: scannedBytes },
            documentIndex,
            semantic,
        };
    }
    finally {
        for (const observation of disposals)
            observation.dispose();
    }
}
/** Canonical bytes of the candidate projection. */
function renderCorpusCandidates(document) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(document)}\n`;
}
/** Canonical bytes of one root's document coverage. */
function renderDocumentCoverage(coverage) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(coverage)}\n`;
}
/** Canonical bytes of the readiness projection. */
function renderReadinessEvidence(evidence) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(evidence)}\n`;
}
//# sourceMappingURL=corpus_scan.js.map