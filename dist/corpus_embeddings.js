"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticEmbeddingProvider = exports.EmbeddingConfigurationError = exports.MAX_CHUNKS_PER_DOCUMENT = exports.EMBEDDING_CHUNK_OVERLAP_CHARACTERS = exports.EMBEDDING_CHUNK_CHARACTERS = exports.EMBEDDING_CHUNK_PROFILE_VERSION = exports.EMBEDDING_CHUNK_PROFILE_ID = void 0;
exports.embeddingChunkProfileHash = embeddingChunkProfileHash;
exports.embeddingModelIdentityHash = embeddingModelIdentityHash;
exports.reproducibilityClassOf = reproducibilityClassOf;
exports.assertEmbeddingConfiguration = assertEmbeddingConfiguration;
exports.chunkDocument = chunkDocument;
exports.vectorDigest = vectorDigest;
exports.cosineSimilarity = cosineSimilarity;
exports.meanVector = meanVector;
exports.embeddingCacheKey = embeddingCacheKey;
exports.runEmbeddings = runEmbeddings;
exports.disabledEmbeddingReport = disabledEmbeddingReport;
// corpus_embeddings.ts — optional semantic recall, and the guards that keep it optional.
//
// Lexical analysis finds documents that share words. It cannot find the two that
// say the same thing in different words — "persist temporal assertions in the
// knowledge graph" and "store time-aware facts in durable semantic memory" share
// almost no vocabulary and are plainly about one subject. Embeddings exist in this
// package for that case and for no other.
//
// Everything else here is about containment, because an embedding pass is the
// first thing in this pipeline that can leave the machine.
//
//   - It is **off by default**. A corpus is somebody's private disk.
//   - A remote provider additionally needs an explicit operator flag. Enabling
//     embeddings is not the same decision as agreeing to upload document text,
//     and the code refuses to treat it as one.
//   - Secret-candidate documents are never embedded, at any setting. That check
//     happens before chunking, not inside the provider.
//   - What leaves is bounded normalized text — titles, headings, a capped number
//     of body chunks — never raw bytes, never a whole archive, never a path.
//
// And the epistemic rule, which no amount of cosine changes: a high similarity is
// a `model_derived_candidate`. It never becomes a fact, and on its own it never
// creates a project candidate. `corpus_fusion.ts` enforces that; this module just
// produces the number honestly.
//
// No model ships with this package. `EmbeddingProvider` is an interface an
// operator supplies, and the one implementation here is a fixture that returns
// vectors it was handed — enough to qualify the contract deterministically,
// and deliberately not enough to be mistaken for a model.
const ordering_1 = require("./ordering");
const repository_model_1 = require("./repository_model");
const corpus_analysis_1 = require("./corpus_analysis");
exports.EMBEDDING_CHUNK_PROFILE_ID = "semantic-chunking/v1";
exports.EMBEDDING_CHUNK_PROFILE_VERSION = "1.0.0";
/** Characters per chunk, and the fixed overlap between consecutive chunks. */
exports.EMBEDDING_CHUNK_CHARACTERS = 1000;
exports.EMBEDDING_CHUNK_OVERLAP_CHARACTERS = 100;
/** Chunks embedded per document. Bounded so one long file cannot dominate a run. */
exports.MAX_CHUNKS_PER_DOCUMENT = 8;
/** Decimal places a reported cosine is rounded to, so replays are byte-identical. */
const SCORE_PRECISION = 6;
function embeddingChunkProfileHash() {
    return (0, repository_model_1.stableId)("embedding-chunk-profile", {
        chunk_characters: exports.EMBEDDING_CHUNK_CHARACTERS,
        max_chunks_per_document: exports.MAX_CHUNKS_PER_DOCUMENT,
        overlap_characters: exports.EMBEDDING_CHUNK_OVERLAP_CHARACTERS,
        profile_id: exports.EMBEDDING_CHUNK_PROFILE_ID,
        profile_version: exports.EMBEDDING_CHUNK_PROFILE_VERSION,
    });
}
function embeddingModelIdentityHash(identity) {
    return (0, repository_model_1.stableId)("embedding-model", {
        chunk_profile: identity.chunk_profile,
        dimension: identity.dimension,
        model_id: identity.model_id,
        model_revision: identity.model_revision,
        provider: identity.provider,
    });
}
function reproducibilityClassOf(configuration) {
    return configuration.locality === "local"
        ? "reproducible_when_runtime_pinned"
        : "provider_bound";
}
// ───────────────────────────── egress guard ─────────────────────────────
class EmbeddingConfigurationError extends Error {
}
exports.EmbeddingConfigurationError = EmbeddingConfigurationError;
/**
 * Decide whether an embedding pass may run, and fail closed with a reason.
 *
 * Every refusal here names the exact flag that would change it, because a guard
 * that only says "not permitted" gets disabled wholesale by the next person who
 * hits it.
 */
function assertEmbeddingConfiguration(options) {
    if (!options.embeddingsEnabled)
        return;
    const configuration = options.configuration;
    if (configuration === undefined) {
        throw new EmbeddingConfigurationError("embeddings are enabled but no provider is configured: pass --embedding-provider and "
            + "--embedding-model, or drop --embeddings");
    }
    if (configuration.provider.trim().length === 0 || configuration.model_id.trim().length === 0) {
        const missing = [
            configuration.provider.trim().length === 0 ? "--embedding-provider" : null,
            configuration.model_id.trim().length === 0 ? "--embedding-model" : null,
        ].filter((flag) => flag !== null);
        throw new EmbeddingConfigurationError(`embeddings are enabled but ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} `
            + "empty: a provider and a model must both be named explicitly, because the identity of what "
            + "produced a vector is part of what makes the vector meaningful");
    }
    if (configuration.locality === "remote") {
        if (!options.allowRemoteEmbeddings) {
            throw new EmbeddingConfigurationError(`provider '${configuration.provider}' is remote, which sends bounded document text off this `
                + "machine. That needs --allow-remote-embeddings, which enabling embeddings alone does not imply");
        }
        const endpoint = configuration.endpoint ?? "";
        if (!endpoint.startsWith("https://")) {
            throw new EmbeddingConfigurationError(`remote provider '${configuration.provider}' must use an https:// endpoint; got `
                + `'${endpoint.length === 0 ? "(none)" : endpoint}'`);
        }
    }
}
/**
 * Split one document into deterministic overlapping chunks.
 *
 * Title and headings lead, because they are the densest statement of what a
 * document is; the body follows, capped. Overlap is fixed by the profile so two
 * runs cut in the same places.
 */
function chunkDocument(input) {
    const lead = [input.title ?? "", ...(input.headings ?? [])]
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .join("\n");
    const body = (0, corpus_analysis_1.normalizeForAnalysis)(input.body ?? "").trim();
    const text = [lead, body].filter((part) => part.length > 0).join("\n");
    if (text.length === 0)
        return [];
    const chunks = [];
    const stride = exports.EMBEDDING_CHUNK_CHARACTERS - exports.EMBEDDING_CHUNK_OVERLAP_CHARACTERS;
    for (let offset = 0, index = 0; offset < text.length && index < exports.MAX_CHUNKS_PER_DOCUMENT; offset += stride, index += 1) {
        const slice = text.slice(offset, offset + exports.EMBEDDING_CHUNK_CHARACTERS);
        if (slice.trim().length === 0)
            break;
        chunks.push({
            artifact_id: input.artifactId,
            normalized_document_id: input.normalizedDocumentId,
            block_index: index,
            block_id: `${input.normalizedDocumentId ?? input.artifactId}#${index}`,
            text: slice,
        });
    }
    return chunks;
}
// ───────────────────────────── vectors ─────────────────────────────
function vectorDigest(vector) {
    // Fixed-precision strings, for the same reason every other identity here uses
    // them: the canonical hasher takes integers only, and a rounded float is still
    // a float.
    return (0, repository_model_1.stableId)("vector", { values: vector.map((value) => value.toFixed(6)) });
}
/** Cosine similarity in [-1, 1]. Zero when either vector has no magnitude. */
function cosineSimilarity(a, b) {
    if (a.length === 0 || a.length !== b.length)
        return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
        const left = a[i];
        const right = b[i];
        dot += left * right;
        normA += left * left;
        normB += right * right;
    }
    if (normA === 0 || normB === 0)
        return 0;
    const raw = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    const clamped = Math.max(-1, Math.min(1, raw));
    return Math.round(clamped * 10 ** SCORE_PRECISION) / 10 ** SCORE_PRECISION;
}
/** Mean of a document's chunk vectors: one vector per document, for pair scoring. */
function meanVector(vectors) {
    if (vectors.length === 0)
        return [];
    const dimension = vectors[0].length;
    const out = new Array(dimension).fill(0);
    for (const vector of vectors) {
        if (vector.length !== dimension)
            continue;
        for (let i = 0; i < dimension; i += 1)
            out[i] = out[i] + vector[i];
    }
    return out.map((value) => value / vectors.length);
}
function embeddingCacheKey(input) {
    return (0, repository_model_1.stableId)("embedding-doc", {
        chunk_profile: input.chunkProfile,
        model_id: input.identity.model_id,
        model_revision: input.identity.model_revision,
        normalized_document_id: input.normalizedDocumentId ?? input.artifactId,
        provider: input.identity.provider,
    });
}
/**
 * Embed the eligible documents and score every pair above the threshold.
 *
 * Pair scoring here is exhaustive over *embedded* documents, which is affordable
 * because the embedded set is bounded by what a decoder opened and by the secret
 * filter. The result is a candidate list handed to `corpus_pairs.ts`, never a
 * conclusion.
 */
async function runEmbeddings(input) {
    const configuration = input.provider.configuration;
    const chunkProfile = embeddingChunkProfileHash();
    // Secrets are counted over every document, not over the decoded ones.
    //
    // A caller that refuses to open a file named `secrets.yaml` hands it over here
    // as undecoded, so a tally taken inside the decoded set would report zero
    // secret documents skipped on a corpus full of them — a number that is always
    // right and never means anything. The guard below is still a real second
    // guard: a caller that did decode such a file finds it dropped here too.
    const secretsSkipped = input.documents.filter((document) => document.is_secret_candidate).length;
    const eligible = input.documents.filter((document) => document.decoded && !document.is_secret_candidate);
    const embeddable = eligible;
    const vectors = new Map();
    let chunksSent = 0;
    let artifactsSent = 0;
    let cacheHits = 0;
    const ordered = [...embeddable].sort((a, b) => (0, ordering_1.compareCodePoints)(a.artifact_id, b.artifact_id));
    const identity = {
        provider: configuration.provider,
        model_id: configuration.model_id,
        model_revision: configuration.model_revision ?? null,
        dimension: 0,
        chunk_profile: chunkProfile,
    };
    const embedOne = async (document) => {
        const key = embeddingCacheKey({
            normalizedDocumentId: document.normalized_document_id,
            artifactId: document.artifact_id,
            chunkProfile,
            identity,
        });
        const cached = input.cache?.get(key);
        if (cached !== undefined) {
            vectors.set(document.artifact_id, cached);
            cacheHits += 1;
            return;
        }
        const chunks = chunkDocument({
            artifactId: document.artifact_id,
            normalizedDocumentId: document.normalized_document_id,
            ...(document.title !== undefined ? { title: document.title } : {}),
            ...(document.headings !== undefined ? { headings: document.headings } : {}),
            ...(document.body !== undefined ? { body: document.body } : {}),
        });
        if (chunks.length === 0)
            return;
        // A document's own chunks stay sequential. The parallelism is across
        // documents, where the unit of work is the thing an operator sized the
        // bound against, and where a partial document cannot be left half-embedded.
        const chunkVectors = [];
        for (const chunk of chunks) {
            const result = await input.provider.embed(chunk.text);
            chunkVectors.push(result.vector);
            chunksSent += 1;
        }
        artifactsSent += 1;
        const mean = meanVector(chunkVectors);
        if (mean.length === 0)
            return;
        vectors.set(document.artifact_id, mean);
        input.cache?.put(key, mean);
    };
    // A fixed pool drawing from a shared cursor: `width` workers, each taking the
    // next document when it finishes one. Deliberately not `Promise.all` over
    // every document, which would issue ten thousand simultaneous requests and
    // make the bound a decoration.
    const width = Math.max(1, Math.floor(input.maxParallelRequests ?? 1));
    let cursor = 0;
    const worker = async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= ordered.length)
                return;
            await embedOne(ordered[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(width, Math.max(ordered.length, 1)) }, () => worker()));
    const ids = [...vectors.keys()].sort(ordering_1.compareCodePoints);
    // Taken from the sorted set rather than from whichever request finished first,
    // so the reported dimension is a property of the corpus and not of the
    // scheduling. Every other number here is a sum or a count and is already
    // order-free; this was the one field a wider pool could have changed.
    const dimension = ids.length === 0
        ? null
        : vectors.get(ids[0]).length;
    const pairs = [];
    for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
            const a = ids[i];
            const b = ids[j];
            const score = cosineSimilarity(vectors.get(a), vectors.get(b));
            if (score >= input.pairThreshold)
                pairs.push({ artifact_a_id: a, artifact_b_id: b, score });
        }
    }
    pairs.sort((x, y) => (0, ordering_1.compareCodePoints)(x.artifact_a_id, y.artifact_a_id)
        || (0, ordering_1.compareCodePoints)(x.artifact_b_id, y.artifact_b_id));
    return {
        pairs,
        report: {
            enabled: true,
            provider: configuration.provider,
            model_id: configuration.model_id,
            model_revision: configuration.model_revision ?? null,
            dimension,
            chunk_profile: chunkProfile,
            reproducibility_class: reproducibilityClassOf(configuration),
            remote: configuration.locality === "remote",
            artifact_count_sent: artifactsSent,
            chunk_count_sent: chunksSent,
            eligible_artifact_count: eligible.length,
            embedded_artifact_count: vectors.size,
            secret_candidates_skipped: secretsSkipped,
            cache_hits: cacheHits,
            vector_digests: ids.map((id) => ({
                artifact_id: id,
                vector_digest: vectorDigest(vectors.get(id)),
            })),
        },
    };
}
/** The report emitted when embeddings did not run, which is the default. */
function disabledEmbeddingReport() {
    return {
        enabled: false,
        provider: null,
        model_id: null,
        model_revision: null,
        dimension: null,
        chunk_profile: embeddingChunkProfileHash(),
        reproducibility_class: null,
        remote: false,
        artifact_count_sent: 0,
        chunk_count_sent: 0,
        eligible_artifact_count: 0,
        embedded_artifact_count: 0,
        secret_candidates_skipped: 0,
        cache_hits: 0,
        vector_digests: [],
    };
}
/**
 * A provider that returns vectors it was given.
 *
 * For qualification only. It is not a model and does not pretend to be one: it
 * exists so the contract's embedding behaviour — the guards, the cache, the
 * capped pair class, the report — can be tested deterministically without
 * shipping a model or reaching a network.
 */
class StaticEmbeddingProvider {
    constructor(configuration, vectorsByText, fallbackDimension = 4) {
        this.configuration = configuration;
        this.byText = new Map(vectorsByText);
        this.fallbackDimension = fallbackDimension;
    }
    embed(text) {
        for (const [needle, vector] of this.byText) {
            if (text.includes(needle)) {
                return Promise.resolve({ vector, provider_metadata: { matched: needle } });
            }
        }
        return Promise.resolve({
            vector: new Array(this.fallbackDimension).fill(0),
            provider_metadata: { matched: "none" },
        });
    }
}
exports.StaticEmbeddingProvider = StaticEmbeddingProvider;
//# sourceMappingURL=corpus_embeddings.js.map