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
exports.TRUNCATION_STATEMENT = exports.EVIDENCE_AGE_STATEMENT = exports.QUERY_OUTCOMES = exports.EVIDENCE_SOURCES = exports.DEFAULT_MAX_EXCERPT_BYTES = exports.DEFAULT_QUERY_LIMIT = exports.MAX_QUERY_LIMIT = exports.CORPUS_EVIDENCE_QUERY_SCHEMA = void 0;
exports.queryCorpusEvidence = queryCorpusEvidence;
exports.renderEvidenceQueryResponse = renderEvidenceQueryResponse;
// corpus_query.ts — one precise question, asked of one completed generation.
//
// A corpus run writes everything it found into `generations/<id>/` and switches
// `CURRENT.json` to it. A developer holding that output has every record they
// need and no way to ask for the three they want: which documents record an
// unresolved question about routing, what constraints the transport spec states,
// which decisions the WIP proposal declared. This module answers such questions
// by reading the records the run already wrote, verifying them first, and
// returning them unchanged.
//
// Three boundaries hold throughout.
//
// It is a view, not a store. Nothing is indexed, cached, normalized or persisted;
// a query is a streaming pass over the generation's own JSONL and JSON, and two
// queries over one generation return the same bytes. There is no ranking, no
// fuzzy match, no embedding and no model: a filter either matches a recorded
// field literally or it does not.
//
// It trusts nothing it has not checked. `CURRENT.json` is resolved once and the
// generation it names is pinned for the whole query. Every file read is named by
// that pointer, sits inside that generation directory (symlinks are refused), and
// hashes to what the pointer recorded. The work-signal and architecture-evidence
// payloads are verified against their manifests with the same functions the
// scan used before publishing them. A generation that fails any of this yields
// an `invalid` outcome and no results, never a partial answer that looks whole.
//
// It returns evidence, not conclusions. A record carries the identities, the
// coordinate, the bounded excerpt and the classification the generation wrote.
// It never says which document is canonical, which declaration wins, or whether
// a decision was ever accepted — a `decision_statement` from a WIP proposal comes
// back exactly as source-declared, beside the WIP status the document declared.
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const corpus_analysis_1 = require("./corpus_analysis");
const corpus_architecture_evidence_1 = require("./corpus_architecture_evidence");
const corpus_document_signals_1 = require("./corpus_document_signals");
const corpus_documents_1 = require("./corpus_documents");
const corpus_publish_1 = require("./corpus_publish");
const corpus_snapshot_1 = require("./corpus_snapshot");
const corpus_work_signal_export_1 = require("./corpus_work_signal_export");
const architecture_statements_1 = require("./extractors/architecture_statements");
const interpretation_1 = require("./interpretation");
const ordering_1 = require("./ordering");
const repository_model_1 = require("./repository_model");
/** Schema of the one response this module renders. */
exports.CORPUS_EVIDENCE_QUERY_SCHEMA = "l9.corpus-evidence-query/v1";
/** Result ceiling a caller may ask for; a larger answer needs a narrower question. */
exports.MAX_QUERY_LIMIT = 500;
exports.DEFAULT_QUERY_LIMIT = 50;
/** Longest excerpt returned, in UTF-8 bytes. The source bound is characters; this is the wire bound. */
exports.DEFAULT_MAX_EXCERPT_BYTES = 1024;
/**
 * Where a result came from inside the generation.
 *
 * `repository_model_packet` is the per-root packet's artifact-scoped assertions:
 * the line-cited work signals of text documents, which the scan files in the
 * packet rather than in the JSONL payload (ADR-043). A query that read only the
 * JSONL would answer "which documents say they are WIP" with every Word document
 * and no Markdown one.
 */
exports.EVIDENCE_SOURCES = [
    "architecture_evidence",
    "document_work_signals",
    "repository_model_packet",
];
exports.QUERY_OUTCOMES = [
    "ok",
    "empty",
    "incomplete",
    "unavailable",
    "unsupported",
    "invalid",
];
/** The evidence-age statement every response carries. A recorded verification is history. */
exports.EVIDENCE_AGE_STATEMENT = "Every record describes the bytes the generation observed when it ran. The verification "
    + "class is the one that run recorded; nothing here re-reads the source files, so a "
    + "fully_verified snapshot is evidence of what the files held then, not proof they are "
    + "unchanged now, and a cached_unchanged_assumption snapshot was never byte-verified.";
exports.TRUNCATION_STATEMENT = "More records matched than the limit returns. The returned set is the first of the "
    + "deterministic order; narrow the query (root, artifact, predicate, class, text) rather "
    + "than paging.";
// ───────────────────────────── the pinned generation ─────────────────────────────
class QueryRefusal extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
/**
 * One generation, resolved once and read through its own pointer.
 *
 * Every read goes through `text()`: the path must be one `CURRENT.json` names,
 * must resolve inside the generation directory after symlinks (a link out of the
 * directory is an escape, not a file), and must hash to what the pointer recorded.
 */
class PinnedGeneration {
    constructor(outDir, current, directory) {
        this.outDir = outDir;
        this.current = current;
        this.directory = directory;
        // `readCorpusCurrent` checks the pointer's schema and ids, not its file list.
        // A pointer with no list, or a list entry without a path and a hash, cannot
        // vouch for anything and is refused as malformed rather than crashed on.
        const files = current.files;
        if (!Array.isArray(files) || files.some((file) => file === null || typeof file !== "object"
            || typeof file.path !== "string"
            || typeof file.content_hash !== "string")) {
            throw new QueryRefusal("query.pointer_malformed", "CURRENT.json does not carry a well-formed file list (each entry needs a path and a content_hash)");
        }
        this.hashes = new Map(current.files.map((file) => [file.path, file.content_hash]));
        this.realDirectory = fs.realpathSync(directory);
        const realOut = fs.realpathSync(outDir);
        if (this.realDirectory !== realOut && !this.realDirectory.startsWith(realOut + path.sep)) {
            throw new QueryRefusal("query.generation_outside_output", `CURRENT.json names generation '${current.generation_ref}', which resolves outside the output directory`);
        }
    }
    names(relative) {
        return this.hashes.has(relative);
    }
    text(relative) {
        const expected = this.hashes.get(relative);
        if (expected === undefined) {
            throw new QueryRefusal("query.file_not_in_generation", `CURRENT.json does not name '${relative}'`);
        }
        const segments = relative.split("/");
        if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
            throw new QueryRefusal("query.path_traversal", `'${relative}' is not a plain generation-relative path`);
        }
        const absolute = path.join(this.directory, ...segments);
        let real;
        try {
            if (fs.lstatSync(absolute).isSymbolicLink()) {
                throw new QueryRefusal("query.symlink_refused", `'${relative}' is a symbolic link and was not followed`);
            }
            real = fs.realpathSync(absolute);
        }
        catch (error) {
            if (error instanceof QueryRefusal)
                throw error;
            throw new QueryRefusal("query.file_missing", `'${relative}' is named by CURRENT.json and is not present`);
        }
        if (!real.startsWith(this.realDirectory + path.sep)) {
            throw new QueryRefusal("query.path_escape", `'${relative}' resolves outside the generation directory`);
        }
        const bytes = fs.readFileSync(real, "utf8");
        const actual = (0, repository_model_1.sha256TextPrefixed)(bytes);
        if (actual !== expected) {
            throw new QueryRefusal("query.file_hash_mismatch", `'${relative}' hashes to ${actual.slice(0, 19)}… and CURRENT.json recorded ${expected.slice(0, 19)}…`);
        }
        return bytes;
    }
    json(relative, schema) {
        let parsed;
        try {
            parsed = JSON.parse(this.text(relative));
        }
        catch (error) {
            if (error instanceof QueryRefusal)
                throw error;
            throw new QueryRefusal("query.file_not_json", `'${relative}' is not valid JSON`);
        }
        const declared = parsed?.schema;
        if (declared !== schema) {
            throw new QueryRefusal("query.schema_mismatch", `'${relative}' declares schema '${String(declared)}'; this query reads '${schema}'`);
        }
        return parsed;
    }
}
/** Resolve `CURRENT.json` once. Everything after this reads the generation it named. */
function pinGeneration(outDir) {
    const resolvedOut = path.resolve(outDir);
    const current = (0, corpus_publish_1.readCorpusCurrent)(resolvedOut);
    if (current === null) {
        throw new QueryRefusal("query.no_generation", `no readable ${corpus_publish_1.CORPUS_CURRENT_SCHEMA} pointer under the output directory; nothing has been published there`);
    }
    const segments = current.generation_ref.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
        throw new QueryRefusal("query.path_traversal", "CURRENT.json names a generation_ref that is not a plain relative path");
    }
    const directory = path.join(resolvedOut, ...segments);
    if (!fs.existsSync(directory)) {
        throw new QueryRefusal("query.generation_missing", `generation '${current.generation_ref}' is not present`);
    }
    return new PinnedGeneration(resolvedOut, current, directory);
}
// ───────────────────────────── reading the sources ─────────────────────────────
function parseJsonl(text, name) {
    const lines = text.length === 0 ? [] : text.split("\n");
    if (text.length > 0 && lines[lines.length - 1] !== "") {
        throw new QueryRefusal("query.payload_truncated", `${name} does not end with a newline`);
    }
    return lines
        .filter((line, index) => !(index === lines.length - 1 && line === ""))
        .map((line, index) => {
        try {
            return JSON.parse(line);
        }
        catch {
            throw new QueryRefusal("query.payload_not_json", `${name} line ${index + 1} is not valid JSON`);
        }
    });
}
/**
 * Read and verify every source the query may answer from.
 *
 * Verification is the same the scan performed before publishing — the payload
 * verifiers are imported, not reimplemented — plus the two checks only a reader
 * can make: that the bytes on disk are the bytes the pointer recorded, and that
 * each document agrees with the snapshot about which corpus it belongs to.
 */
function loadGeneration(pinned) {
    const snapshot = pinned.json("corpus-snapshot.json", corpus_snapshot_1.CORPUS_SNAPSHOT_SCHEMA);
    const index = pinned.json("document-index.json", corpus_documents_1.DOCUMENT_INDEX_SCHEMA);
    const signals = pinned.json("document-signals.json", corpus_document_signals_1.CORPUS_DOCUMENT_SIGNALS_SCHEMA);
    const sameCorpus = (name, document) => {
        if (document.corpus_source_snapshot_id !== snapshot.corpus_source_snapshot_id
            || document.corpus_analysis_id !== snapshot.analysis.corpus_analysis_id) {
            throw new QueryRefusal("query.corpus_mismatch", `${name} names a different corpus than corpus-snapshot.json`);
        }
    };
    sameCorpus("document-index.json", index);
    sameCorpus("document-signals.json", signals);
    const knownArtifactIds = new Set(snapshot.artifacts.map((artifact) => artifact.virtual_source_id));
    const knownNormalizedDocumentIds = new Set(index.documents.map((entry) => entry.normalized_document_id).filter((id) => id !== null));
    const sources = [];
    // Work signals: required in every generation this query reads.
    const workManifest = pinned.json(corpus_work_signal_export_1.DOCUMENT_WORK_SIGNALS_MANIFEST_FILE, corpus_work_signal_export_1.DOCUMENT_WORK_SIGNALS_MANIFEST_SCHEMA);
    sameCorpus(corpus_work_signal_export_1.DOCUMENT_WORK_SIGNALS_MANIFEST_FILE, workManifest);
    const workPayload = pinned.text(corpus_work_signal_export_1.DOCUMENT_WORK_SIGNALS_PAYLOAD_FILE);
    const workProblems = (0, corpus_work_signal_export_1.verifyDocumentWorkSignalExport)({
        manifest: workManifest,
        payloadJsonl: workPayload,
        knownArtifactIds,
        knownNormalizedDocumentIds,
        reportSignalCount: signals.block_signals.signal_count,
    });
    const workRef = snapshot.document_work_signals;
    if (workRef !== undefined && (workRef.payload_artifact_hash !== workManifest.payload_artifact_hash
        || workRef.payload_semantic_hash !== workManifest.payload_semantic_hash
        || workRef.record_count !== workManifest.record_count)) {
        workProblems.push("the snapshot's document_work_signals reference does not match the manifest");
    }
    if (workProblems.length > 0) {
        throw new QueryRefusal("query.work_signals_refused", `${corpus_work_signal_export_1.DOCUMENT_WORK_SIGNALS_PAYLOAD_FILE} failed verification: ${workProblems.join("; ")}`);
    }
    const workSignals = parseJsonl(workPayload, corpus_work_signal_export_1.DOCUMENT_WORK_SIGNALS_PAYLOAD_FILE);
    sources.push({
        source: "document_work_signals",
        schema: corpus_work_signal_export_1.DOCUMENT_WORK_SIGNALS_SCHEMA,
        status: "verified",
        record_count: workSignals.length,
        problems: [],
    });
    // Architecture evidence: opt-in, so absent is a state rather than a failure.
    let architecture = null;
    let architectureProfileVersion = null;
    if (snapshot.architecture_evidence !== undefined || pinned.names(corpus_architecture_evidence_1.ARCHITECTURE_EVIDENCE_PAYLOAD_FILE)) {
        const manifest = pinned.json(corpus_architecture_evidence_1.ARCHITECTURE_EVIDENCE_MANIFEST_FILE, corpus_architecture_evidence_1.ARCHITECTURE_EVIDENCE_MANIFEST_SCHEMA);
        sameCorpus(corpus_architecture_evidence_1.ARCHITECTURE_EVIDENCE_MANIFEST_FILE, manifest);
        architectureProfileVersion = manifest.profile_version;
        const payload = pinned.text(corpus_architecture_evidence_1.ARCHITECTURE_EVIDENCE_PAYLOAD_FILE);
        const problems = (0, corpus_architecture_evidence_1.verifyArchitectureEvidenceExport)({
            manifest,
            payloadJsonl: payload,
            knownArtifactIds,
            knownNormalizedDocumentIds,
        });
        const ref = snapshot.architecture_evidence;
        if (ref === undefined) {
            problems.push("the payload is present but the snapshot does not reference it");
        }
        else if (ref.payload_artifact_hash !== manifest.payload_artifact_hash
            || ref.payload_semantic_hash !== manifest.payload_semantic_hash
            || ref.record_count !== manifest.record_count) {
            problems.push("the snapshot's architecture_evidence reference does not match the manifest");
        }
        if (problems.length > 0) {
            throw new QueryRefusal("query.architecture_evidence_refused", `${corpus_architecture_evidence_1.ARCHITECTURE_EVIDENCE_PAYLOAD_FILE} failed verification: ${problems.join("; ")}`);
        }
        architecture = parseJsonl(payload, corpus_architecture_evidence_1.ARCHITECTURE_EVIDENCE_PAYLOAD_FILE);
        sources.push({
            source: "architecture_evidence",
            schema: corpus_architecture_evidence_1.ARCHITECTURE_EVIDENCE_SCHEMA,
            status: "verified",
            record_count: architecture.length,
            problems: [],
        });
    }
    else {
        sources.push({
            source: "architecture_evidence",
            schema: corpus_architecture_evidence_1.ARCHITECTURE_EVIDENCE_SCHEMA,
            status: "not_run",
            record_count: null,
            problems: ["the generation was produced without --architecture-evidence"],
        });
    }
    // Per-root packets: each must be the packet the snapshot says the root produced.
    const packets = [];
    for (const root of snapshot.roots) {
        if (root.observation_status !== "observed" || root.bundle_ref === null)
            continue;
        const relative = `${root.bundle_ref}/packet.json`;
        let packet;
        try {
            packet = JSON.parse(pinned.text(relative));
        }
        catch (error) {
            if (error instanceof QueryRefusal)
                throw error;
            throw new QueryRefusal("query.file_not_json", `'${relative}' is not valid JSON`);
        }
        if (packet.packet_type !== repository_model_1.REPOSITORY_MODEL_PACKET_TYPE) {
            throw new QueryRefusal("query.schema_mismatch", `'${relative}' is not a ${repository_model_1.REPOSITORY_MODEL_PACKET_TYPE} packet`);
        }
        // The declared id alone proves nothing about the contents: a rewritten
        // assertion with the pointer's hash updated to match would still carry the
        // old id. The packet's own validation recomputes the semantic hash the id
        // is derived from, and checks every referential invariant the producer
        // promised, so it is the same proof the scan ran before emitting it.
        const validation = (0, repository_model_1.validateRepositoryModelPacket)(packet);
        if (validation.status !== "passed") {
            const failed = validation.checks.filter((entry) => entry.status !== "passed").map((entry) => entry.rule);
            throw new QueryRefusal("query.packet_invalid", `${relative} failed its own packet validation: ${failed.join(", ")}`);
        }
        if (packet.packet_id !== root.rmp_packet_id) {
            throw new QueryRefusal("query.packet_mismatch", `${relative} is packet ${packet.packet_id}; the snapshot records ${root.rmp_packet_id} for root ${root.root_key}`);
        }
        packets.push({ root_id: root.root_id, root_key: root.root_key, packet });
    }
    sources.push({
        source: "repository_model_packet",
        schema: repository_model_1.REPOSITORY_MODEL_PACKET_TYPE,
        status: "verified",
        record_count: packets.reduce((sum, entry) => sum + entry.packet.payload.assertions.filter((a) => a.subject_id.startsWith("artifact:")).length, 0),
        problems: [],
    });
    sources.sort((a, b) => (0, ordering_1.compareCodePoints)(a.source, b.source));
    return { pinned, snapshot, index, signals, workSignals, architecture, architectureProfileVersion, packets, sources };
}
/** The join from both identity domains to the document, built from existing ids only. */
function documentContexts(loaded) {
    const rootKey = new Map(loaded.snapshot.roots.map((root) => [root.root_id, root.root_key]));
    const byArtifact = new Map();
    const byRmp = new Map();
    const byCorpusPath = new Map();
    for (const entry of loaded.index.documents) {
        const key = rootKey.get(entry.root_id) ?? entry.root_id;
        // The same helper the scan used, so this is a recomputation of an existing
        // identity rather than a parallel one.
        const rmp = (0, repository_model_1.repositoryModelArtifactId)(`repo:${key}`, entry.root_relative_path);
        byArtifact.set(entry.artifact_id, {
            entry,
            root_key: key,
            rmp_artifact_id: rmp,
            declarations: { kinds: [], statuses: [] },
        });
        byRmp.set(rmp, entry.artifact_id);
        byCorpusPath.set(entry.corpus_path, entry.artifact_id);
    }
    const declare = (artifactId, predicate, object, assertionId) => {
        const context = byArtifact.get(artifactId);
        if (context === undefined)
            return;
        if (predicate === "work.kind")
            context.declarations.kinds.push({ object, assertion_id: assertionId });
        if (predicate === "work.status")
            context.declarations.statuses.push({ object, assertion_id: assertionId });
    };
    for (const signal of loaded.workSignals)
        declare(signal.artifact_id, signal.predicate, signal.object, signal.signal_id);
    for (const { packet } of loaded.packets) {
        for (const assertion of packet.payload.assertions) {
            const artifactId = byRmp.get(assertion.subject_id);
            if (artifactId !== undefined)
                declare(artifactId, assertion.predicate, assertion.object, assertion.assertion_id);
        }
    }
    const order = (a, b) => (0, ordering_1.compareCodePoints)(a.object, b.object) || (0, ordering_1.compareCodePoints)(a.assertion_id, b.assertion_id);
    for (const context of byArtifact.values()) {
        context.declarations.kinds.sort(order);
        context.declarations.statuses.sort(order);
    }
    return { byArtifact, byRmp, byCorpusPath };
}
function excerptTruncatedAtSource(excerpt) {
    return excerpt.length === interpretation_1.MAX_EXCERPT_LENGTH && excerpt.endsWith("…");
}
function fromArchitecture(record, context) {
    return {
        source: "architecture_evidence",
        record_id: record.evidence_id,
        root_id: context.entry.root_id,
        root_key: context.root_key,
        artifact_id: record.artifact_id,
        rmp_artifact_id: record.rmp_artifact_id,
        corpus_path: context.entry.corpus_path,
        source_path: record.source_path,
        format: record.format,
        normalized_document_id: record.normalized_document_id,
        raw_content_hash: record.raw_content_hash,
        predicate: null,
        statement_class: record.statement_class,
        value: record.declared_text,
        value_truncated_at_source: record.declared_text_truncated,
        structured_locator: record.structured_locator,
        source_range: null,
        block_id: record.block_id,
        block_kind: record.block_kind,
        decoder_id: record.decoder_id,
        bounded_excerpt: record.bounded_excerpt,
        excerpt_truncated_at_source: excerptTruncatedAtSource(record.bounded_excerpt),
        excerpt_cut_by_query: false,
        evidence_class: "declared",
        authority: "source",
        confidence: null,
        extractor_id: record.extractor_id,
        epistemic_class: record.epistemic_class,
        authority_verified: false,
        document_declarations: context.declarations,
        selection: record.selection,
        recognition: record.recognition,
    };
}
function fromWorkSignal(record, context) {
    return {
        source: "document_work_signals",
        record_id: record.signal_id,
        root_id: context.entry.root_id,
        root_key: context.root_key,
        artifact_id: record.artifact_id,
        rmp_artifact_id: record.rmp_artifact_id,
        corpus_path: context.entry.corpus_path,
        source_path: record.source_path,
        format: record.format,
        normalized_document_id: record.normalized_document_id,
        raw_content_hash: record.raw_content_hash,
        predicate: record.predicate,
        statement_class: null,
        value: record.object,
        value_truncated_at_source: false,
        structured_locator: record.structured_locator,
        source_range: null,
        block_id: record.block_id,
        block_kind: record.block_kind,
        decoder_id: record.decoder_id,
        bounded_excerpt: record.bounded_excerpt,
        excerpt_truncated_at_source: excerptTruncatedAtSource(record.bounded_excerpt),
        excerpt_cut_by_query: false,
        evidence_class: record.evidence_class,
        authority: record.authority,
        confidence: record.confidence,
        extractor_id: record.extractor_id,
        epistemic_class: "source-declared",
        authority_verified: false,
        document_declarations: context.declarations,
        selection: null,
        recognition: null,
    };
}
function fromPacket(assertion, artifactId, context) {
    return {
        source: "repository_model_packet",
        record_id: assertion.assertion_id,
        root_id: context.entry.root_id,
        root_key: context.root_key,
        artifact_id: artifactId,
        rmp_artifact_id: assertion.subject_id,
        corpus_path: context.entry.corpus_path,
        source_path: assertion.source_path,
        format: context.entry.format,
        normalized_document_id: context.entry.normalized_document_id,
        raw_content_hash: assertion.source_content_hash,
        predicate: assertion.predicate,
        statement_class: null,
        value: assertion.object,
        value_truncated_at_source: false,
        structured_locator: null,
        source_range: { start_line: assertion.source_range.start_line, end_line: assertion.source_range.end_line },
        block_id: null,
        block_kind: null,
        decoder_id: context.entry.decoder_id,
        bounded_excerpt: assertion.evidence_excerpt,
        excerpt_truncated_at_source: excerptTruncatedAtSource(assertion.evidence_excerpt),
        excerpt_cut_by_query: false,
        evidence_class: assertion.evidence_class,
        authority: assertion.authority,
        confidence: assertion.confidence,
        extractor_id: assertion.extractor_id,
        epistemic_class: "source-declared",
        authority_verified: false,
        document_declarations: context.declarations,
        selection: null,
        recognition: null,
    };
}
/** Every record the generation holds, each joined to its document. */
function allRecords(loaded, contexts) {
    const out = [];
    for (const record of loaded.architecture ?? []) {
        const context = contexts.byArtifact.get(record.artifact_id);
        if (context !== undefined)
            out.push(fromArchitecture(record, context));
    }
    for (const record of loaded.workSignals) {
        const context = contexts.byArtifact.get(record.artifact_id);
        if (context !== undefined)
            out.push(fromWorkSignal(record, context));
    }
    for (const { packet } of loaded.packets) {
        for (const assertion of packet.payload.assertions) {
            const artifactId = contexts.byRmp.get(assertion.subject_id);
            if (artifactId === undefined)
                continue;
            const context = contexts.byArtifact.get(artifactId);
            if (context !== undefined)
                out.push(fromPacket(assertion, artifactId, context));
        }
    }
    return out;
}
const SOURCE_RANK = {
    architecture_evidence: 0,
    document_work_signals: 1,
    repository_model_packet: 2,
};
/** Total order over results: source, artifact, then the record's own id. */
function compareResults(a, b) {
    return (SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
        || (0, ordering_1.compareCodePoints)(a.artifact_id, b.artifact_id)
        || (0, ordering_1.compareCodePoints)(a.record_id, b.record_id));
}
/** Cut an excerpt at a UTF-8 byte bound without splitting a character. */
function cutExcerpt(excerpt, maxBytes) {
    if (Buffer.byteLength(excerpt, "utf8") <= maxBytes)
        return { excerpt, cut: false };
    let kept = "";
    for (const character of excerpt) {
        if (Buffer.byteLength(kept + character + "…", "utf8") > maxBytes)
            break;
        kept += character;
    }
    return { excerpt: `${kept}…`, cut: true };
}
// ───────────────────────────── the query ─────────────────────────────
function normalizeLimit(limit) {
    if (limit === undefined)
        return exports.DEFAULT_QUERY_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > exports.MAX_QUERY_LIMIT) {
        throw new QueryRefusal("query.bad_limit", `limit must be an integer in [1, ${exports.MAX_QUERY_LIMIT}]`);
    }
    return limit;
}
function normalizeExcerptBytes(bytes) {
    if (bytes === undefined)
        return exports.DEFAULT_MAX_EXCERPT_BYTES;
    if (!Number.isSafeInteger(bytes) || bytes < 16) {
        throw new QueryRefusal("query.bad_excerpt_bound", "max excerpt bytes must be an integer of at least 16");
    }
    return bytes;
}
function emptyText(value) {
    return value === undefined || value.length === 0 ? null : value;
}
/**
 * Ask one question of one generation.
 *
 * Never throws for a generation that is absent, corrupt or inconsistent: those
 * are `invalid` outcomes with the refusal named, because a caller who cannot
 * distinguish "nothing matched" from "nothing could be trusted" has been handed
 * a wrong answer with a confident shape.
 */
function queryCorpusEvidence(input) {
    const diagnostics = [];
    const query = {
        root: emptyText(input.root),
        artifact: emptyText(input.artifact),
        predicate: emptyText(input.predicate),
        statement_class: emptyText(input.statementClass),
        text: emptyText(input.text),
        kind: emptyText(input.kind),
        status: emptyText(input.status),
        source: input.source ?? null,
        ...(emptyText(input.role) !== null ? { role: emptyText(input.role) } : {}),
        ...(input.selectedOnly === true ? { selected_only: true } : {}),
        limit: exports.DEFAULT_QUERY_LIMIT,
        max_excerpt_bytes: exports.DEFAULT_MAX_EXCERPT_BYTES,
    };
    const refuse = (outcome, code, message, generation = null, sources = []) => ({
        schema: exports.CORPUS_EVIDENCE_QUERY_SCHEMA,
        query,
        generation,
        sources,
        outcome,
        match_count: null,
        returned_count: 0,
        truncated: false,
        truncation_statement: null,
        results: [],
        diagnostics: [...diagnostics, { code, severity: "error", message }],
    });
    try {
        query.limit = normalizeLimit(input.limit);
        query.max_excerpt_bytes = normalizeExcerptBytes(input.maxExcerptBytes);
        if (query.statement_class !== null && !architecture_statements_1.ARCHITECTURE_STATEMENT_CLASSES.includes(query.statement_class)) {
            return refuse("unsupported", "query.unknown_statement_class", `'${query.statement_class}' is not a statement class; the vocabulary is ${architecture_statements_1.ARCHITECTURE_STATEMENT_CLASSES.join(", ")}`);
        }
        if (query.source !== null && !exports.EVIDENCE_SOURCES.includes(query.source)) {
            return refuse("unsupported", "query.unknown_source", `'${String(query.source)}' is not an evidence source`);
        }
        if (query.role !== undefined && !corpus_architecture_evidence_1.ARCHITECTURE_DOCUMENT_ROLES.includes(query.role)) {
            return refuse("unsupported", "query.unknown_role", `'${query.role}' is not a document role; the policy's roles are ${corpus_architecture_evidence_1.ARCHITECTURE_DOCUMENT_ROLES.join(", ")}`);
        }
    }
    catch (error) {
        if (error instanceof QueryRefusal)
            return refuse("invalid", error.code, error.message);
        throw error;
    }
    let loaded;
    try {
        loaded = loadGeneration(pinGeneration(input.outDir));
    }
    catch (error) {
        if (error instanceof QueryRefusal)
            return refuse("invalid", error.code, error.message);
        throw error;
    }
    const { snapshot } = loaded;
    const generation = {
        generation_id: loaded.pinned.current.generation_id,
        generation_ref: loaded.pinned.current.generation_ref,
        corpus_id: snapshot.corpus_id,
        corpus_source_snapshot_id: snapshot.corpus_source_snapshot_id,
        corpus_analysis_id: snapshot.analysis.corpus_analysis_id,
        corpus_status: snapshot.corpus_status,
        missing_root_ids: [...snapshot.missing_root_ids].sort(ordering_1.compareCodePoints),
        verification: snapshot.verification,
        evidence_age_statement: exports.EVIDENCE_AGE_STATEMENT,
    };
    if (snapshot.verification.verification_class !== "fully_verified") {
        diagnostics.push({
            code: "query.verification_assumed",
            severity: "warning",
            message: `the pinned snapshot is ${snapshot.verification.verification_class}: ${snapshot.verification.statement}`,
        });
    }
    // A class filter over a generation that never read statements is a question
    // the generation cannot answer, which is different from answering "none".
    if (query.statement_class !== null && loaded.architecture === null) {
        return refuse("unsupported", "query.architecture_evidence_not_run", "the pinned generation was produced without --architecture-evidence, so statement classes cannot be queried from it", generation, loaded.sources);
    }
    // Root filter resolves against the snapshot: a key or id the snapshot does not
    // know is a wrong question; a root the snapshot names as missing is a known
    // absence and gets an explicit unavailable outcome rather than zero results.
    let rootIds = null;
    if (query.root !== null) {
        const matched = snapshot.roots.filter((root) => root.root_key === query.root || root.root_id === query.root);
        if (matched.length === 0) {
            return refuse("unavailable", "query.unknown_root", `root '${query.root}' is not in the pinned snapshot`, generation, loaded.sources);
        }
        const missing = matched.filter((root) => root.observation_status !== "observed");
        if (missing.length > 0) {
            return refuse("unavailable", "query.root_not_observed", `root '${query.root}' was requested but not observed in this generation (${missing[0]?.failure_reason ?? "missing"})`, generation, loaded.sources);
        }
        rootIds = new Set(matched.map((root) => root.root_id));
    }
    const contexts = documentContexts(loaded);
    // Roles and selection verdicts exist on architecture-evidence records and
    // nowhere else, as the generation recorded them. A question about them is
    // answered from that source only, from a generation that ran the projection,
    // and never by re-deriving a role from today's rules over yesterday's evidence.
    const roleFilter = query.role !== undefined || query.selected_only === true;
    if (roleFilter && query.source !== null && query.source !== "architecture_evidence") {
        return refuse("unsupported", "query.role_filter_source_unsupported", `--role and --selected-only apply to architecture_evidence records only; source ${query.source} carries no role or selection verdict`, generation, loaded.sources);
    }
    if (roleFilter && query.predicate !== null) {
        return refuse("unsupported", "query.role_filter_predicate_unsupported", "--role and --selected-only apply to architecture_evidence records, which carry a statement class and no predicate; drop --predicate or the role filter", generation, loaded.sources);
    }
    if (roleFilter && loaded.architecture === null) {
        return refuse("unsupported", "query.architecture_evidence_not_run", "--role and --selected-only ask for the selection profile's verdicts, and the pinned generation was produced without --architecture-evidence", generation, loaded.sources);
    }
    if (query.role !== undefined && query.selected_only === true && loaded.architecture !== null) {
        const unattributed = loaded.architecture.filter((record) => record.selection?.selected_for_roles === undefined);
        if (unattributed.length > 0) {
            return refuse("unsupported", "query.role_selection_not_recorded", `the pinned generation (profile ${loaded.architectureProfileVersion ?? "unknown"}) recorded only a global selected flag on `
                + `${unattributed.length} record(s), not which role selected each; --role with --selected-only needs that attribution, `
                + "and the query will not reconstruct it from today's rules", generation, loaded.sources);
        }
    }
    if (roleFilter && query.source === null) {
        diagnostics.push({
            code: "query.role_filter_architecture_only",
            severity: "info",
            message: "--role and --selected-only evaluate architecture_evidence records only; work-signal and packet records carry no role",
        });
    }
    let artifactId = null;
    if (query.artifact !== null) {
        artifactId = contexts.byArtifact.has(query.artifact)
            ? query.artifact
            : contexts.byRmp.get(query.artifact) ?? contexts.byCorpusPath.get(query.artifact) ?? null;
        if (artifactId === null) {
            return refuse("unavailable", "query.unknown_artifact", `artifact '${query.artifact}' is not in the pinned generation`, generation, loaded.sources);
        }
        if (rootIds !== null && !rootIds.has(contexts.byArtifact.get(artifactId)?.entry.root_id ?? "")) {
            return refuse("unavailable", "query.artifact_outside_root", `artifact '${query.artifact}' does not belong to root '${query.root}'`, generation, loaded.sources);
        }
    }
    const matches = allRecords(loaded, contexts).filter((record) => {
        if (query.source !== null && record.source !== query.source)
            return false;
        if (rootIds !== null && !rootIds.has(record.root_id))
            return false;
        if (artifactId !== null && record.artifact_id !== artifactId)
            return false;
        if (query.predicate !== null && record.predicate !== query.predicate)
            return false;
        if (query.statement_class !== null && record.statement_class !== query.statement_class)
            return false;
        if (query.kind !== null && !record.document_declarations.kinds.some((ref) => ref.object === query.kind))
            return false;
        if (query.status !== null && !record.document_declarations.statuses.some((ref) => ref.object === query.status))
            return false;
        if (query.text !== null && !record.value.includes(query.text) && !record.bounded_excerpt.includes(query.text))
            return false;
        if (roleFilter && record.source !== "architecture_evidence")
            return false;
        if (query.role !== undefined && !(record.selection?.roles ?? []).includes(query.role))
            return false;
        if (query.selected_only === true) {
            if (query.role !== undefined) {
                if (!(record.selection?.selected_for_roles ?? []).includes(query.role))
                    return false;
            }
            else if (record.selection?.selected !== true) {
                return false;
            }
        }
        return true;
    }).sort(compareResults);
    const returned = matches.slice(0, query.limit).map((record) => {
        const { excerpt, cut } = cutExcerpt(record.bounded_excerpt, query.max_excerpt_bytes);
        return cut ? { ...record, bounded_excerpt: excerpt, excerpt_cut_by_query: true } : record;
    });
    const truncated = matches.length > returned.length;
    let outcome = "ok";
    if (snapshot.corpus_status !== "complete") {
        outcome = "incomplete";
        diagnostics.push({
            code: "query.corpus_incomplete",
            severity: "warning",
            message: `the pinned snapshot is ${snapshot.corpus_status}; roots not observed: ${generation.missing_root_ids.join(", ") || "(none named)"}. The answer covers only the observed roots.`,
        });
    }
    else if (matches.length === 0) {
        outcome = "empty";
    }
    return {
        schema: exports.CORPUS_EVIDENCE_QUERY_SCHEMA,
        query,
        generation,
        sources: loaded.sources,
        outcome,
        match_count: matches.length,
        returned_count: returned.length,
        truncated,
        truncation_statement: truncated ? exports.TRUNCATION_STATEMENT : null,
        results: returned,
        diagnostics,
    };
}
/** Canonical bytes of a response: code-point key order, no clock, no absolute path. */
function renderEvidenceQueryResponse(response) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(response)}\n`;
}
//# sourceMappingURL=corpus_query.js.map