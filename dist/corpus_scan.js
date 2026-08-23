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
exports.isDecodable = isDecodable;
exports.isLexicallyAnalyzable = isLexicallyAnalyzable;
exports.isTextFamilyFormat = isTextFamilyFormat;
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
const corpus_analysis_manifest_1 = require("./corpus_analysis_manifest");
const corpus_diff_1 = require("./corpus_diff");
const corpus_document_signals_1 = require("./corpus_document_signals");
const corpus_readiness_1 = require("./corpus_readiness");
const corpus_roots_1 = require("./corpus_roots");
const corpus_snapshot_1 = require("./corpus_snapshot");
const corpus_session_1 = require("./corpus_session");
const encoding_1 = require("./encoding");
const documents_1 = require("./documents");
const corpus_root_history_1 = require("./corpus_root_history");
const corpus_work_signal_export_1 = require("./corpus_work_signal_export");
const extractors_1 = require("./extractors");
const document_blocks_1 = require("./extractors/document_blocks");
const interpretation_1 = require("./interpretation");
const local_source_1 = require("./local_source");
const ordering_1 = require("./ordering");
const corpus_documents_1 = require("./corpus_documents");
const corpus_semantic_run_1 = require("./corpus_semantic_run");
const corpus_fusion_1 = require("./corpus_fusion");
const corpus_embeddings_1 = require("./corpus_embeddings");
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
/** Extensionless files the text decoder claims by name. */
const LEXICAL_EXTENSIONS = new Set(corpus_analysis_1.NEAR_DUPLICATE_EXTENSIONS);
/**
 * Formats whose decoder consumes the whole file, so the scan reads it once.
 *
 * The complement — `docx`, `pptx`, `xlsx` — are ZIP containers whose reader
 * streams individual parts out by offset. Handing those a whole-file buffer
 * would cost a second copy of every spreadsheet in the corpus to save a read the
 * container reader never makes.
 */
const WHOLE_FILE_FORMATS = new Set(["text", "markdown", "csv", "html", "ipynb", "pdf"]);
exports.CANDIDATE_STATEMENT = "Exact duplicates are byte equality and are facts. Near-duplicate candidates, topic "
    + "candidates and project candidates are deterministic candidate analyses: they report "
    + "shared bytes, shared wording and a container that holds a project marker. None of "
    + "them claims two documents mean the same thing, that anything should be merged, "
    + "moved or deleted, or that one is more valuable than another.";
/**
 * v2 alongside `l9.document-index/v2`, and for the same reason: the single
 * `decoder` field named one decoder for a root that seven of them read.
 */
exports.DOCUMENT_COVERAGE_SCHEMA = "l9.document-coverage/v2";
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
/**
 * True when some decoder in `registry` claims this artifact.
 *
 * This is the coverage denominator, so it has to be the same question the derive
 * stage asks. Deriving eligibility from a second hand-maintained extension list
 * is how "decoder_eligible_count" drifts away from what actually gets decoded.
 */
function isDecodable(rootRelativePath, registry) {
    return registry.forPath(rootRelativePath) !== undefined;
}
/** True when the lexical passes claim this artifact. */
function isLexicallyAnalyzable(rootRelativePath) {
    return LEXICAL_EXTENSIONS.has(extensionOf(basenameOf(rootRelativePath)));
}
/**
 * True for a format whose source bytes are themselves the text.
 *
 * The distinction decides two things that must not drift apart: whether the file
 * is probed for UTF-8 before being opened, and whether its statements are read
 * from its lines or from its blocks. A `.md` file has lines an operator can open
 * the file to; a `.docx` has no lines at all, and the two are read accordingly.
 */
function isTextFamilyFormat(format) {
    return format === "text" || format === "markdown";
}
/**
 * The identity of a decoded document: `H(content_hash, decoder_id, version)`.
 *
 * Derived from the decoder that actually read the bytes. Naming a fixed decoder
 * here instead would give every `.docx` in a corpus an id that says the text
 * decoder produced it, and that id is the join key between the document index,
 * the cache and every piece of block-bound evidence — three places that would
 * then disagree about which decoding they mean.
 */
function normalizedDocumentIdOf(contentHash, record) {
    if (contentHash === null)
        return null;
    return (0, corpus_cache_1.normalizedDocumentKey)({
        contentHash,
        decoderId: record?.decoder_id ?? exports.TEXT_DECODER_ID,
        decoderVersion: record?.decoder_version ?? exports.TEXT_DECODER_VERSION,
    });
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
    const { cache, session, memory, extractors, candidateProfile, interpretProfile, interpretEnabled, maxFileBytes, rootPathsById, rootKeyById, registry, into, } = context;
    const { normalized, lexical, interpreted, manifestIdentifiers, skipped } = into;
    const contentHash = artifact.contentHash;
    // The decoder that claims this path decides the key. A `.docx` and a `.md` are
    // read by different code into different documents, and a decoder revision must
    // invalidate its own entries without touching anyone else's.
    const decoder = registry.forPath(artifact.rootRelativePath);
    const documentKey = (0, corpus_cache_1.normalizedDocumentKey)({
        contentHash,
        decoderId: decoder?.id ?? exports.TEXT_DECODER_ID,
        decoderVersion: decoder?.version ?? exports.TEXT_DECODER_VERSION,
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
    // Two routes into lexical analysis, because the two families answer the
    // question differently. For text and Markdown the extension decides, since the
    // text decoder also claims source code and shingling a repository's TypeScript
    // would make every file that shares an import block a near-duplicate of every
    // other. For a document format there is nothing left to consult: a Word file
    // is prose whatever it is called. Without the second route a decoded `.docx`
    // would be counted in coverage and reach no candidate at all.
    const wantsLexical = isLexicallyAnalyzable(artifact.rootRelativePath)
        || (decoder !== undefined && (0, documents_1.isProseDocumentFormat)(decoder.format));
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
    // A document already known not to decode has no derived layers and never will.
    // Asking for them anyway records a miss on every run — for a scanned PDF, on
    // every run forever — and a warm run over a corpus containing one could never
    // reach a full cache however many times it was repeated.
    const mayDecode = documentHit === undefined || documentHit.decodes;
    const lexicalHit = wantsLexical && mayDecode
        ? cache.get("lexical_features", lexicalKey)
        : undefined;
    const portableHit = wantsInterpretation && mayDecode
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
    const identifierHit = wantsIdentifier && mayDecode
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
        // A decoder that reads text still needs the bytes to be text; one that reads
        // a container does not, and probing a `.docx` for UTF-8 would reject every
        // Word document in the corpus.
        const textFamily = decoder === undefined || isTextFamilyFormat(decoder.format);
        if (textFamily) {
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
                    format: decoder?.format ?? "unknown",
                    decoder_id: decoder?.id ?? exports.TEXT_DECODER_ID,
                    decoder_version: decoder?.version ?? exports.TEXT_DECODER_VERSION,
                    block_count: 0,
                };
                cache.put("normalized_document", documentKey, record);
                normalized.set(artifact.virtualSourceId, record);
                return;
            }
        }
        if (decoder === undefined) {
            skipped.unreadable += 1;
            return;
        }
        // Read the bytes here, asynchronously, for the formats whose decoders
        // consume the whole file.
        //
        // This is the seam `max_parallel_decoders` bounds. With the read inside a
        // synchronous decoder there is nothing to overlap in a single-threaded
        // runtime, and the budget would govern only how many pipelines happened to
        // be between awaits — a number nobody sets a flag for. Reading here puts N
        // reads genuinely in flight, which on a spinning disk or a network mount is
        // the difference the operator was reaching for.
        //
        // Container formats are excluded on purpose: their readers stream parts out
        // by offset, and pulling a whole `.xlsx` into memory to hand it over would
        // trade the concurrency for a memory spike and a second copy of every file.
        let bytes;
        if (WHOLE_FILE_FORMATS.has(decoder.format)) {
            try {
                bytes = await fs.promises.readFile(absolute);
            }
            catch {
                skipped.unreadable += 1;
                return;
            }
        }
        const outcome = decoder.decode({
            artifactId: artifact.virtualSourceId,
            contentHash,
            sourcePath: artifact.rootRelativePath,
            absolutePath: absolute,
            ...(bytes !== undefined ? { bytes } : {}),
            sizeBytes: artifact.sizeBytes ?? 0,
            budget: documents_1.DEFAULT_DECODER_BUDGET,
        });
        if (!outcome.decoded) {
            // A refusal is a typed fact with a reason, never an empty document. A
            // scanned PDF and a PDF with nothing in it are different findings.
            const record = {
                decodes: false,
                reason: outcome.reason,
                byte_length: artifact.sizeBytes ?? 0,
                normalized_content_hash: null,
                token_count: 0,
                format: decoder.format,
                decoder_id: decoder.id,
                decoder_version: decoder.version,
                block_count: 0,
            };
            cache.put("normalized_document", documentKey, record);
            normalized.set(artifact.virtualSourceId, record);
            return;
        }
        const document = outcome.document;
        // Which text the later layers read depends on whether the format has lines.
        //
        // A Markdown file does. Its assertions cite line spans, and those spans have
        // to point at lines of the file an operator can open — so a text document is
        // read exactly as it was before this decoder existed, from its own bytes.
        //
        // A Word document does not have lines. Its blocks are the only text there is,
        // so joining them is what puts a `.docx` plan into the same keyphrase and
        // near-duplicate analysis as a `.md` one instead of leaving it a coverage
        // statistic. Its evidence cites block ids and structured locators, which is
        // what `document-signals.json` carries.
        let text;
        if (textFamily) {
            // The bytes are already in hand from the read above; decoding them again
            // beats a second trip to the filesystem for the same file.
            if (bytes === undefined) {
                skipped.unreadable += 1;
                return;
            }
            text = bytes.toString("utf8");
        }
        else {
            text = document.blocks.map((block) => block.text).join("\n");
        }
        const analysisText = (0, corpus_analysis_1.normalizeForAnalysis)(text);
        const tokens = (0, corpus_analysis_1.analysisTokens)(analysisText);
        const record = {
            decodes: true,
            reason: null,
            byte_length: Buffer.byteLength(text, "utf8"),
            normalized_content_hash: (0, repository_model_1.stableId)("normtext", { text: analysisText }),
            token_count: tokens.length,
            format: document.format,
            decoder_id: document.decoder_id,
            decoder_version: document.decoder_version,
            block_count: document.blocks.length,
            blocks: document.blocks.map((block) => ({
                block_id: block.block_id,
                kind: block.kind,
                text: block.text,
                locator: block.locator,
            })),
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
    // Supplied by the caller only in tests that need a narrower decoder set; a
    // corpus run always uses the shipped registry, so what a document decodes to
    // is a property of the release rather than of the invocation.
    const registry = input.decoderRegistry ?? (0, documents_1.defaultDecoderRegistry)();
    // The gap sets are asked of the registry rather than read from a constant, so
    // a run with a wider decoder set reports a correspondingly narrower gap, and a
    // decoder registered without its extension leaving the gap list is rejected
    // here rather than producing a report that contradicts itself.
    const gaps = (0, corpus_coverage_1.documentGaps)(registry);
    const ocrExtensions = new Set(gaps.ocrRequired);
    const undecodedExtensions = new Set(gaps.unsupported);
    const interpretProfile = (0, interpretation_1.interpretationProfileHash)(extractors);
    const blockProfile = (0, document_blocks_1.documentBlockProfileHash)();
    const interpretEnabled = input.interpret !== false;
    const verificationMode = input.verification ?? "full";
    const verifyContent = input.verifyContent === true;
    // `--verify-content` outranks `--incremental`: it exists precisely to turn a
    // stat-assisted snapshot back into a byte-verified one, so it must win when
    // both are given rather than quietly deferring to the cheaper mode.
    // An archive's preflight verdict is a function of its bytes, the reader and the
    // policy, so it is cached under exactly those. The bytes are still staged: the
    // members are needed by whatever reads them next, and a verdict is not members.
    const archiveManifestStore = {
        get: (key) => cache.get("archive_manifest", (0, corpus_cache_1.archiveManifestKey)({
            archiveContentHash: key.archiveContentHash,
            archiveReaderVersion: key.readerVersion,
            archivePolicyVersion: key.policyVersion,
        })),
        put: (key, value) => cache.put("archive_manifest", (0, corpus_cache_1.archiveManifestKey)({
            archiveContentHash: key.archiveContentHash,
            archiveReaderVersion: key.readerVersion,
            archivePolicyVersion: key.policyVersion,
        }), value),
    };
    // ── 0. may this run claim continuity with a previous one? ───────────────
    //
    // Decided before a byte is read, from the root specs alone: a spec carrying an
    // explicit name is a declared identity, one without is the mount point's final
    // segment. Every longitudinal path is gated here rather than at its own call
    // site, so the diff, the resume and the incremental reuse cannot come to
    // disagree about what continuity is worth.
    const allowInferredRootHistory = input.allowInferredRootHistory === true;
    const declaredIdentities = input.roots.map((spec) => {
        const rootKey = spec.name !== undefined && spec.name.length > 0
            ? spec.name
            : (0, corpus_roots_1.defaultRootKey)(spec.path);
        return {
            root_id: (0, corpus_roots_1.corpusRootId)(rootKey),
            root_key: rootKey,
            root_identity_class: spec.name !== undefined && spec.name.length > 0
                ? "declared"
                : "inferred",
        };
    });
    const authorizations = [];
    const authorize = (operation, previousRoots) => {
        const result = (0, corpus_root_history_1.assertLongitudinalRootIdentityAuthorized)({
            operation,
            currentRoots: declaredIdentities,
            previousRoots,
            allowInferredRootHistory,
        });
        authorizations.push({ operation, result });
    };
    if (input.previousSnapshot !== undefined) {
        authorize("previous-snapshot diff", input.previousSnapshot.roots);
    }
    // A session with no roots recorded yet is one this run is about to create, and
    // creating it claims nothing about a previous observation.
    const sessionRoots = input.session?.resumedRoots ?? [];
    if (sessionRoots.length > 0) {
        authorize("resume", sessionRoots);
    }
    const knownHashesEnabled = verificationMode === "incremental"
        && !verifyContent
        && input.previousSnapshot !== undefined;
    if (knownHashesEnabled) {
        // Reuse keyed purely on content is safe whatever the root is called: the key
        // is the bytes. This is the other kind — "that path under that root had these
        // bytes last run" — and it is a continuity claim like any other.
        authorize("incremental hash reuse", input.previousSnapshot.roots);
    }
    // ── 1. acquire every root, read-only ────────────────────────────────────
    const observations = [];
    const failedRoots = [];
    const disposals = [];
    try {
        let acquiredRoots = 0;
        for (const spec of input.roots) {
            // Between roots, so a corpus of several drives is not one block the length
            // of every drive together.
            if (acquiredRoots > 0)
                await (0, corpus_session_1.yieldToEventLoop)();
            acquiredRoots += 1;
            const rootKey = spec.name !== undefined && spec.name.length > 0
                ? spec.name
                : (0, corpus_roots_1.defaultRootKey)(spec.path);
            assertUsableRootKey(rootKey, spec.path);
            // Whether the key is the operator's word or the mount point's last
            // segment. It decides `root_identity_class`, which is what a later diff
            // consults before treating two runs' roots as the same disk.
            const keyDeclared = spec.name !== undefined && spec.name.length > 0;
            // An unplugged drive is a fact about the corpus and has to end up inside
            // it. Swallowing the failure and carrying on would produce a snapshot that
            // looks complete and is missing a disk, which is the one outcome a corpus
            // spread across removable media must never produce.
            let observation;
            try {
                observation = (0, local_source_1.acquireLocalSource)({
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
                    archiveManifests: archiveManifestStore,
                });
            }
            catch (error) {
                if (input.allowPartialRoots !== true)
                    throw error;
                const reason = error instanceof Error ? error.message : String(error);
                failedRoots.push({ rootKey, rootId: (0, corpus_roots_1.corpusRootId)(rootKey), reason, keyDeclared });
                diagnostics.push({
                    code: "corpus.root_unreadable",
                    severity: "error",
                    message: `root '${rootKey}' could not be observed and is missing from this corpus: ${reason}`,
                });
                continue;
            }
            disposals.push(observation);
            if (!observation.stable) {
                const unstable = `corpus: SOURCE_CHANGED_DURING_OBSERVATION under root '${rootKey}'; `
                    + "the root changed while it was being read, so it has no deterministic snapshot";
                if (input.allowPartialRoots !== true)
                    throw new Error(unstable);
                failedRoots.push({
                    rootKey, rootId: (0, corpus_roots_1.corpusRootId)(rootKey), reason: unstable, keyDeclared,
                });
                diagnostics.push({ code: "corpus.root_unstable", severity: "error", message: unstable });
                continue;
            }
            const rootId = (0, corpus_roots_1.corpusRootId)(rootKey);
            observations.push({
                binding: {
                    root_id: rootId,
                    root_key: rootKey,
                    root_identity_class: keyDeclared ? "declared" : "inferred",
                    root_label: rootKey,
                    root_snapshot_id: (0, corpus_roots_1.corpusRootSnapshotId)(observation.physicalSnapshotHash),
                    source_kind: observation.sourceKind,
                    source_revision: observation.sourceRevision,
                    physical_snapshot_hash: observation.physicalSnapshotHash,
                    absolute_path: path.resolve(spec.path),
                    key_declared: keyDeclared,
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
            ...registry.profile(),
            `${exports.MANIFEST_DECODER_ID}@${exports.MANIFEST_DECODER_VERSION}`,
        ];
        // The embedding profile is a property of the model and the chunking, both
        // known before a single vector exists — which is what lets a run that will
        // embed carry the right analysis identity even though the pass itself has to
        // wait for the decoders. A supplied provider and a supplied report are
        // alternatives; the provider wins when both are given, because it is the one
        // that will actually produce this run's numbers.
        const embeddingConfiguration = input.embeddingProvider?.configuration;
        const embeddingProfile = embeddingConfiguration !== undefined
            ? (0, repository_model_1.stableId)("embedding-profile", {
                chunk_profile: (0, corpus_embeddings_1.embeddingChunkProfileHash)(),
                model_id: embeddingConfiguration.model_id,
                model_revision: embeddingConfiguration.model_revision ?? "",
                provider: embeddingConfiguration.provider,
            })
            : input.embeddingReport?.enabled === true
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
        let recordsSeen = 0;
        for (const entry of active) {
            const binding = bindingById.get(entry.binding.root_id);
            const observed = new Set();
            const memberPaths = new Set(entry.observation.virtualArtifacts.map((member) => member.virtualSourcePath));
            for (const record of entry.observation.inventory.records) {
                // Counted per record rather than per artifact: folders are skipped below,
                // so a run of them at a multiple of the interval would otherwise yield
                // once for each of them.
                recordsSeen += 1;
                if (recordsSeen % corpus_session_1.YIELD_INTERVAL === 0)
                    await (0, corpus_session_1.yieldToEventLoop)();
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
            && (isDecodable(artifact.rootRelativePath, registry)
                || extractors.some((extractor) => extractor.matches(artifact.rootRelativePath))));
        const rootKeyById = new Map(bound.roots.map((root) => [root.root_id, root.root_key]));
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
            rootKeyById,
            registry,
            into: { normalized, lexical, interpreted, manifestIdentifiers, skipped },
        }));
        // ── 4a. what the decoded documents say about themselves ───────────────
        //
        // The line-based interpretation above reads files that have lines. Everything
        // a decoder opens that does not — a Word document, a deck, a worksheet, a
        // notebook, a PDF, an HTML page, a CSV — states its status, its tasks and its
        // dependencies in exactly the same vocabulary, and until this pass existed it
        // stated them to nobody: the text reached the lexical analysis and the
        // statements reached nothing at all.
        //
        // Read here rather than inside `deriveDocumentLayers` because the blocks are
        // part of the normalized document record, so they are equally in hand whether
        // the document was just decoded or read out of the cache. A warm run and a
        // cold run therefore produce these signals from the same bytes by
        // construction, instead of by a second cache layer having to agree with the
        // first.
        const blockSignals = new Map();
        for (const artifact of decodable) {
            const record = normalized.get(artifact.virtualSourceId);
            if (record?.decodes !== true)
                continue;
            // A text document is skipped: its assertions already exist, and they cite
            // the line spans it actually has. Reading it twice would double every task
            // in the corpus and file the second copy under a weaker coordinate.
            if (isTextFamilyFormat(record.format))
                continue;
            const blocks = record.blocks ?? [];
            if (blocks.length === 0)
                continue;
            const rootKey = rootKeyById.get(artifact.rootId) ?? artifact.rootId;
            const signals = (0, document_blocks_1.readDocumentBlockSignals)({
                subjectId: (0, repository_model_1.repositoryModelArtifactId)(`repo:${rootKey}`, artifact.rootRelativePath),
                sourcePath: artifact.rootRelativePath,
                sourceContentHash: artifact.contentHash,
                normalizedDocumentId: normalizedDocumentIdOf(artifact.contentHash, record),
                decoderId: record.decoder_id,
                decoderVersion: record.decoder_version,
                format: record.format,
                blocks: blocks.map((block) => ({
                    block_id: block.block_id,
                    kind: block.kind,
                    text: block.text,
                    locator: block.locator,
                })),
            });
            if (signals.length > 0)
                blockSignals.set(artifact.virtualSourceId, signals);
        }
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
                    document_block_profile: blockProfile,
                    semantic_candidate_profile: candidateProfile,
                    ...(embeddingProfile !== null ? { embedding_profile: embeddingProfile } : {}),
                    readiness_profile: (0, corpus_readiness_1.readinessProfileHash)(),
                },
            }),
            corpus_profile: corpusProfileHash,
            document_decoder_profiles: [...documentDecoderProfiles],
            interpretation_profile: interpretProfile,
            document_block_profile: blockProfile,
            semantic_candidate_profile: candidateProfile,
            embedding_profile: embeddingProfile,
            readiness_profile: (0, corpus_readiness_1.readinessProfileHash)(),
        };
        // Both projections of the work signals are built from this one array. The
        // report samples it and the machine payload carries all of it, so the two can
        // disagree about presentation and never about how much the corpus found.
        const workSignalRecords = [...blockSignals.entries()]
            .flatMap(([artifactId, signals]) => signals.map((signal) => ({
            signal_id: signal.assertion_id,
            artifact_id: artifactId,
            rmp_artifact_id: signal.subject_id,
            source_path: signal.source_path,
            format: signal.format,
            raw_content_hash: signal.source_content_hash,
            normalized_document_id: signal.evidence.normalized_document_id,
            decoder_id: signal.evidence.decoder_id,
            decoder_version: signal.evidence.decoder_version,
            block_id: signal.evidence.block_id,
            block_kind: signal.evidence.block_kind,
            structured_locator: signal.evidence.locator,
            predicate: signal.predicate,
            object: signal.object,
            bounded_excerpt: signal.evidence_excerpt,
            evidence_class: signal.evidence_class,
            authority: signal.authority,
            confidence: signal.confidence,
            extractor_id: signal.extractor_id,
            extractor_profile_version: document_blocks_1.DOCUMENT_BLOCK_PROFILE_VERSION,
        })));
        // The complete payload is built here, before the snapshot, because the
        // snapshot carries a reference to it: a record count and the two hashes, so a
        // reader holding only the snapshot can tell whether the payload beside it is
        // the one this run produced.
        const documentWorkSignals = (0, corpus_work_signal_export_1.buildDocumentWorkSignalExport)({
            corpusSourceSnapshotId: sourceSnapshotId,
            corpusAnalysisId: analysisIdentity.corpus_analysis_id,
            profile: {
                profile_id: document_blocks_1.DOCUMENT_BLOCK_PROFILE_ID,
                profile_version: document_blocks_1.DOCUMENT_BLOCK_PROFILE_VERSION,
                profile_hash: blockProfile,
            },
            records: workSignalRecords,
        });
        // What the operator authorized, recorded beside what was observed. Null on
        // an ordinary run: an `enabled: false` entry on every run would train a
        // reader to skip the field precisely when it says something.
        const historyOverride = (0, corpus_root_history_1.inferredRootHistoryOverride)(authorizations);
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
            unsupported_format: undecodedExtensions.has(artifact.extension),
            // Both readers, because readiness is a question about the document and not
            // about which coordinate system its evidence happens to use. A `.docx` plan
            // with three open tasks is exactly as unfinished as the `.md` one beside it.
            assertions: [
                ...(interpreted.get(artifact.virtualSourceId)?.assertions ?? []),
                ...(blockSignals.get(artifact.virtualSourceId) ?? []),
            ].map((assertion) => ({
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
        const topicResult = topicsEnabled
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
            : {
                candidates: [],
                pair_work: {
                    eligible_document_count: 0,
                    exhaustive_pair_count: 0,
                    evaluated_pair_count: 0,
                    skipped_same_component_count: 0,
                    indexed_posting_count: 0,
                    unindexed_term_count: 0,
                },
            };
        const topicCandidates = topicResult.candidates;
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
        // A root that was named and could not be read appears in the snapshot as a
        // missing root, not as an absence. Downstream, "12 project candidates" over a
        // corpus with an unplugged drive is a different claim from the same number
        // over a whole one, and the only way it can be told is if the snapshot says so.
        for (const failed of failedRoots) {
            snapshotRoots.push({
                root_id: failed.rootId,
                root_key: failed.rootKey,
                root_identity_class: failed.keyDeclared ? "declared" : "inferred",
                root_label: failed.rootKey,
                root_snapshot_id: "",
                source_kind: "unknown",
                source_revision: "",
                physical_snapshot_hash: "",
                rmp_packet_id: "",
                rmp_semantic_hash: "",
                bundle_ref: null,
                observation_status: "missing",
                failure_reason: failed.reason,
            });
        }
        snapshotRoots.sort((a, b) => (0, ordering_1.compareCodePoints)(a.root_id, b.root_id));
        const corpusStatus = snapshotRoots.every((root) => root.observation_status === "observed")
            ? "complete"
            : "partial";
        const snapshot = {
            schema: corpus_snapshot_1.CORPUS_SNAPSHOT_SCHEMA,
            corpus_id: corpusIdLabel,
            corpus_source_snapshot_id: sourceSnapshotId,
            analysis: analysisIdentity,
            document_work_signals: (0, corpus_work_signal_export_1.documentWorkSignalsRef)(documentWorkSignals.manifest),
            ...(historyOverride !== null
                ? { operational_provenance: { inferred_root_history_override: historyOverride } }
                : {}),
            corpus_status: corpusStatus,
            verification,
            missing_root_ids: failedRoots.map((failed) => failed.rootId).sort(ordering_1.compareCodePoints),
            roots: snapshotRoots,
            artifacts: snapshotArtifacts,
            archives: orderedArchives,
            counts: {
                root_count_requested: input.roots.length,
                root_count_observed: bound.roots.length,
                root_count_failed: failedRoots.length,
                root_count: bound.roots.length,
                artifact_count: artifacts.length,
                archive_count: archives.length,
                archive_member_count: artifacts.filter((artifact) => artifact.isArchiveMember).length,
                total_bytes: artifacts.reduce((sum, artifact) => sum + (artifact.sizeBytes ?? 0), 0),
            },
        };
        // What this run concluded, written into the snapshot so the *next* run can
        // diff it. Without this a snapshot-to-snapshot diff can only say whether the
        // rules or the bytes moved, and the candidate deltas were three hard zeros.
        //
        // It is attached after the snapshot object rather than built into it because
        // the candidates do not exist until the analyses above have run, and neither
        // identity may depend on them: the source id is about the disks, the analysis
        // id is about the rules, and this is about the conclusions.
        snapshot.analysis_manifest = (0, corpus_analysis_manifest_1.buildAnalysisManifest)({
            exactDuplicateClusters: clusters,
            nearDuplicates: nearCandidates,
            topics: topicCandidates,
            projects: projectCandidates,
        });
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
            decoderProfiles: registry.profile(),
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
                    ...(record !== undefined
                        ? {
                            normalized: {
                                ...record,
                                // Read off the blocks rather than declared beside them, so the
                                // index cannot claim a coordinate system no block of this
                                // document actually cites.
                                locator_kinds: (record.blocks ?? []).map((block) => String(block.locator.kind)),
                            },
                        }
                        : {}),
                    normalizedDocumentId: normalizedDocumentIdOf(artifact.contentHash, record),
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
            // Summarized by the same function as the corpus index, so a per-root file
            // and the corpus file can never come to disagree about one root.
            const rootIndex = {
                ...documentIndex,
                summary: (0, corpus_documents_1.summarizeDocuments)(documents),
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
                    decoder_profiles: registry.profile(),
                    ...rootIndex.summary,
                },
            };
        });
        // ── 7c. the embedding pass, when a provider was supplied ──────────────
        //
        // It runs here and not in the caller because the text it sends is the
        // *normalized* text — a decoded Word document's blocks, a PDF's page text —
        // and that only exists once the decoders have run. A caller that wanted to
        // run the pass itself would have to reimplement the decode stage to get the
        // input, which is how "the provider interface is exported for an operator to
        // implement" turned into a CLI that refused `--embeddings` outright.
        //
        // Every containment rule in `corpus_embeddings.ts` applies to what is
        // assembled here: title and headings from block kinds, body from the rest,
        // secret-candidate paths marked so the pass drops them before chunking, and
        // never a path, never a raw byte, never an archive.
        let embeddingPairs = input.embeddingPairs;
        let embeddingReport = input.embeddingReport;
        if (input.embeddingProvider !== undefined) {
            const embeddable = artifacts.map((artifact) => {
                const record = normalized.get(artifact.virtualSourceId);
                const blocks = record?.blocks ?? [];
                const title = blocks.find((block) => block.kind === "title")?.text;
                const headings = blocks
                    .filter((block) => block.kind === "heading")
                    .map((block) => block.text);
                const body = blocks
                    .filter((block) => block.kind !== "title" && block.kind !== "heading")
                    .map((block) => block.text)
                    .join("\n");
                return {
                    artifact_id: artifact.virtualSourceId,
                    normalized_document_id: record?.normalized_content_hash ?? null,
                    ...(title !== undefined ? { title } : {}),
                    ...(headings.length > 0 ? { headings } : {}),
                    ...(body.length > 0 ? { body } : {}),
                    is_secret_candidate: (0, interpretation_1.isSecretCandidatePath)(artifact.rootRelativePath),
                    decoded: record?.decodes === true,
                };
            });
            try {
                const run = await (0, corpus_embeddings_1.runEmbeddings)({
                    documents: embeddable,
                    provider: input.embeddingProvider,
                    pairThreshold: input.embeddingPairThreshold ?? corpus_fusion_1.DEFAULT_EMBEDDING_PAIR_THRESHOLD,
                    // The budget an operator already sets with `--max-embedding-workers`,
                    // rather than a second knob beside it. This is the number that was
                    // previously recorded in the session manifest and acted on nowhere.
                    maxParallelRequests: budgets.max_parallel_embedding_requests,
                });
                embeddingPairs = run.pairs.map((pair) => ({
                    artifact_a_id: pair.artifact_a_id,
                    artifact_b_id: pair.artifact_b_id,
                    score: pair.score,
                }));
                embeddingReport = run.report;
            }
            catch (error) {
                // A provider that fails is reported as a failure, not absorbed into a
                // run that then claims embeddings were off. The distinction matters: one
                // says nothing was asked of a model, the other says something was asked
                // and did not come back.
                throw new Error(`embedding pass failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
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
                    assertions: [
                        ...(interpreted.get(artifact.virtualSourceId)?.assertions ?? []),
                        ...(blockSignals.get(artifact.virtualSourceId) ?? []),
                    ].map((assertion) => ({
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
            const packAssertion = (assertion) => ({
                assertion_id: assertion.assertion_id,
                predicate: assertion.predicate,
                object: assertion.object,
                source_path: assertion.source_path,
                evidence_excerpt: assertion.evidence_excerpt,
                source_content_hash: assertion.source_content_hash ?? "",
            });
            for (const [artifactId, record] of interpreted) {
                assertionsByArtifact.set(artifactId, record.assertions.map(packAssertion));
            }
            // Block-bound claims join the same packs. An evidence pack quotes what a
            // document said and names where it said it; the locator differs by format
            // and the claim does not, so excluding these would build reasoning packs
            // that silently omit every plan the operator wrote in Word.
            for (const [artifactId, signals] of blockSignals) {
                const existing = assertionsByArtifact.get(artifactId) ?? [];
                assertionsByArtifact.set(artifactId, [...existing, ...signals.map(packAssertion)]);
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
                ...(embeddingPairs !== undefined ? { embeddingPairs } : {}),
                ...(embeddingReport !== undefined ? { embeddingReport } : {}),
                ...(input.packBudget !== undefined ? { packBudget: input.packBudget } : {}),
            });
            for (const note of semantic.relations.diagnostics) {
                diagnostics.push({ code: note.code, severity: note.severity, message: note.message });
            }
        }
        // Which artifacts a candidate of any kind actually names. Read off the
        // per-artifact candidate fields rather than inferred, because "the decoder
        // opened it" and "something downstream used it" are different claims and
        // only the second one means the decoding was worth doing.
        const candidateMembers = new Set(candidatesDocument.artifacts
            .filter((artifact) => artifact.exact_duplicate_cluster_id !== null
            || artifact.near_duplicate_candidate_ids.length > 0
            || artifact.topic_candidate_ids.length > 0
            || artifact.project_candidate_ids.length > 0)
            .map((artifact) => artifact.virtual_source_id));
        const documentSignals = (0, corpus_document_signals_1.buildCorpusDocumentSignals)({
            corpusSourceSnapshotId: sourceSnapshotId,
            corpusAnalysisId: analysisIdentity.corpus_analysis_id,
            decoderProfiles: registry.profile(),
            documents: [...normalized.entries()].map(([artifactId, record]) => ({
                virtual_source_id: artifactId,
                format: record.format,
                decoder_id: record.decoder_id,
                decoder_version: record.decoder_version,
                decoded: record.decodes,
                reason: record.reason,
                blocks: (record.blocks ?? []).map((block) => ({
                    block_id: block.block_id,
                    kind: block.kind,
                    locator: block.locator,
                })),
            })),
            blockProfile: {
                profile_id: document_blocks_1.DOCUMENT_BLOCK_PROFILE_ID,
                profile_version: document_blocks_1.DOCUMENT_BLOCK_PROFILE_VERSION,
                profile_hash: blockProfile,
                extractor_id: document_blocks_1.DOCUMENT_BLOCK_EXTRACTOR_ID,
            },
            blockSignals: workSignalRecords,
            // Interpreted means "said something", by either reader. Counting only the
            // line-based one would report every decoded Word document as interpreted
            // zero times, which is the exact shape of failure this document exists to
            // make visible.
            interpreted: new Set([
                ...[...interpreted.entries()]
                    .filter(([, record]) => record.assertions.length > 0)
                    .map(([artifactId]) => artifactId),
                ...blockSignals.keys(),
            ]),
            lexicallyAnalyzed: new Set(lexical.keys()),
            candidateMembers,
        });
        const decodableIds = new Set(decodable.map((artifact) => artifact.virtualSourceId));
        const decodedIds = new Set([...normalized.entries()].filter(([, record]) => record.decodes).map(([id]) => id));
        // Why the eligible documents that are not normalized documents are not.
        //
        // Tallied from the refusal reasons the decoders actually returned rather
        // than guessed from extensions, because the two disagree in exactly the case
        // that matters: a `.pdf` is a format a decoder claims, and a *scanned* `.pdf`
        // is one it opens and correctly reports as having no text layer. An
        // extension-only tally calls the first a decode failure and never sees the
        // second at all.
        const refusalReasons = new Map();
        for (const record of normalized.values()) {
            if (record.decodes || record.reason === null)
                continue;
            refusalReasons.set(record.reason, (refusalReasons.get(record.reason) ?? 0) + 1);
        }
        const refusals = (...reasons) => reasons.reduce((sum, reason) => sum + (refusalReasons.get(reason) ?? 0), 0);
        const namedRefusals = new Set([
            "decoder.ocr_required", "decoder.encrypted", "decoder.malformed",
            "not_utf8", "binary", "encoding",
        ]);
        const decodeGap = {
            secret_skipped: skipped.secret,
            oversized: skipped.oversized,
            encoding_rejected: refusals("not_utf8", "binary", "encoding"),
            ocr_required: refusals("decoder.ocr_required"),
            encrypted: refusals("decoder.encrypted"),
            malformed: refusals("decoder.malformed"),
            other_refusal: [...refusalReasons.entries()]
                .filter(([reason]) => !namedRefusals.has(reason))
                .reduce((sum, [, count]) => sum + count, 0),
            unaccounted: 0,
        };
        // The residual, computed rather than assumed zero: if a document goes missing
        // between eligibility and decoding by a route nobody named, it surfaces here
        // instead of vanishing into the difference between two totals.
        decodeGap.unaccounted = decodableIds.size - decodedIds.size
            - decodeGap.secret_skipped - decodeGap.oversized - decodeGap.encoding_rejected
            - decodeGap.ocr_required - decodeGap.encrypted - decodeGap.malformed
            - decodeGap.other_refusal;
        const interpretationEligible = artifacts.filter((artifact) => interpretEnabled && extractors.some((extractor) => extractor.matches(artifact.rootRelativePath)));
        const lexicalEligible = artifacts.filter((artifact) => isLexicallyAnalyzable(artifact.rootRelativePath)
            || (0, documents_1.isProseDocumentFormat)(registry.forPath(artifact.rootRelativePath)?.format ?? ""));
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
        for (const [artifactId, signals] of blockSignals) {
            if (signals.some((assertion) => assertion.predicate.startsWith("work."))) {
                workSignalArtifacts.add(artifactId);
            }
        }
        const dependencyPredicates = new Map();
        for (const assertions of [
            ...[...interpreted.values()].map((record) => record.assertions),
            ...blockSignals.values(),
        ]) {
            for (const assertion of assertions) {
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
                unsupported_format_count: artifacts.filter((artifact) => undecodedExtensions.has(artifact.extension)).length,
                // A decoder that was offered bytes it claimed and could not read them.
                // Distinct from an artifact no decoder claims — one is a gap in this
                // corpus, the other a gap in the decoder set — and distinct again from a
                // page that simply has no text on it, which is neither.
                decoder_failure_count: decodeGap.malformed + decodeGap.encoding_rejected
                    + decodeGap.other_refusal + decodeGap.unaccounted,
                // Two routes to the same finding: a raster file, known by its extension,
                // and a document a decoder opened to discover its pages are images.
                ocr_required_count: artifacts.filter((a) => ocrExtensions.has(a.extension)).length
                    + decodeGap.ocr_required,
                encrypted_document_count: encryptedCount + decodeGap.encrypted,
                oversized_document_count: skipped.oversized,
                secret_skipped_count: skipped.secret,
                decode_gap: decodeGap,
            },
            semantics: {
                interpreted_artifact_count: interpreted.size,
                work_signal_artifact_count: workSignalArtifacts.size,
                exact_duplicate_cluster_count: clusters.length,
                near_duplicate_candidate_count: nearCandidates.length,
                topic_candidate_count: topicCandidates.length,
                project_candidate_count: projectCandidates.length,
                consolidation_candidate_count: semantic?.consolidations.candidates.length ?? 0,
                topic_pair_work: topicResult.pair_work,
            },
            embeddings: {
                enabled: embeddingReport?.enabled === true,
                eligible_count: embeddingReport?.enabled === true
                    ? embeddingReport.eligible_artifact_count
                    : null,
                embedded_count: embeddingReport?.enabled === true
                    ? embeddingReport.embedded_artifact_count
                    : null,
                cache_hit_count: embeddingReport?.enabled === true
                    ? embeddingReport.cache_hits
                    : null,
                // Eligibility already excludes the documents refused for their name, so
                // subtracting them again would report a negative failure count on any
                // corpus holding one.
                provider_failure_count: embeddingReport?.enabled === true
                    ? embeddingReport.eligible_artifact_count - embeddingReport.embedded_artifact_count
                    : null,
                secret_skipped_count: embeddingReport?.enabled === true
                    ? embeddingReport.secret_candidates_skipped
                    : null,
            },
            exact_hash_coverage: (0, corpus_coverage_1.coverageRatio)(artifacts.filter((artifact) => artifact.contentHash !== null).length, artifacts.length),
            normalized_document_coverage: (0, corpus_coverage_1.coverageRatio)(decodedIds.size, decodableIds.size),
            interpretation_coverage: (0, corpus_coverage_1.coverageRatio)(interpretationEligible.filter((artifact) => interpreted.has(artifact.virtualSourceId)).length, interpretationEligible.length),
            lexical_analysis_coverage: (0, corpus_coverage_1.coverageRatio)(lexicalEligible.filter((artifact) => lexical.has(artifact.virtualSourceId)).length, lexicalEligible.length),
            // A real ratio when a pass ran, and null — not zero — when none did. Zero
            // would read as "the model was asked and answered nothing".
            embedding_coverage_when_enabled: embeddingReport?.enabled === true
                ? (0, corpus_coverage_1.coverageRatio)(embeddingReport.embedded_artifact_count, embeddingReport.eligible_artifact_count)
                : null,
            unsupported_format_counts: (0, corpus_coverage_1.formatCounts)(artifacts
                .filter((artifact) => undecodedExtensions.has(artifact.extension))
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
        if (historyOverride !== null) {
            // Stated in the run's own diagnostics as well as recorded in the snapshot:
            // a reader of the report should not have to open the snapshot to find out
            // that the continuity it describes is the operator's claim.
            diagnostics.push({
                code: "corpus.inferred_root_history_override",
                severity: "warning",
                message: (0, corpus_root_history_1.inferredRootHistoryWarning)(historyOverride),
            });
        }
        if (skipped.encoding > 0) {
            diagnostics.push({
                code: "corpus.unsupported_encoding",
                severity: "info",
                message: `${skipped.encoding} file(s) were hashed but are not valid UTF-8 and were not decoded`,
            });
        }
        // The completeness contract, checked before anything is written rather than
        // asserted in a document. Every failure here means the payload and the report
        // disagree about what the corpus found, or a signal points at something the
        // corpus does not contain — and a consumer reading either one would be
        // reading a number nobody could reconcile.
        const exportProblems = (0, corpus_work_signal_export_1.verifyDocumentWorkSignalExport)({
            manifest: documentWorkSignals.manifest,
            payloadJsonl: documentWorkSignals.payloadJsonl,
            knownArtifactIds: new Set(artifacts.map((artifact) => artifact.virtualSourceId)),
            knownNormalizedDocumentIds: new Set(artifacts
                .map((artifact) => normalizedDocumentIdOf(artifact.contentHash, normalized.get(artifact.virtualSourceId)))
                .filter((id) => id !== null)),
            reportSignalCount: documentSignals.block_signals.signal_count,
        });
        if (exportProblems.length > 0) {
            throw new Error("corpus: the complete document work-signal payload failed its own completeness "
                + `check and was not published:\n  - ${exportProblems.join("\n  - ")}`);
        }
        // Built only after the guard above allowed the comparison: an unauthorized
        // inferred continuity never reaches this call, so a diff exists exactly when
        // there was a claim worth making.
        const diff = input.previousSnapshot
            ? {
                ...(0, corpus_diff_1.buildCorpusDiff)(input.previousSnapshot, snapshot),
                ...(historyOverride !== null
                    ? { inferred_root_history_override: historyOverride }
                    : {}),
            }
            : null;
        const orderedDiagnostics = [...diagnostics].sort((a, b) => (0, ordering_1.compareCodePoints)(a.code, b.code)
            || (0, ordering_1.compareCodePoints)(a.corpus_path ?? "", b.corpus_path ?? "")
            || (0, ordering_1.compareCodePoints)(a.message, b.message));
        return {
            snapshot,
            documentWorkSignals,
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
            documentSignals,
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