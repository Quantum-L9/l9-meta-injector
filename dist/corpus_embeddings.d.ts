export declare const EMBEDDING_CHUNK_PROFILE_ID = "semantic-chunking/v1";
export declare const EMBEDDING_CHUNK_PROFILE_VERSION = "1.0.0";
/** Characters per chunk, and the fixed overlap between consecutive chunks. */
export declare const EMBEDDING_CHUNK_CHARACTERS = 1000;
export declare const EMBEDDING_CHUNK_OVERLAP_CHARACTERS = 100;
/** Chunks embedded per document. Bounded so one long file cannot dominate a run. */
export declare const MAX_CHUNKS_PER_DOCUMENT = 8;
export declare function embeddingChunkProfileHash(): string;
export interface EmbeddingModelConfiguration {
    provider: string;
    model_id: string;
    /** Recorded when the provider exposes one. Absent is recorded as absent. */
    model_revision?: string;
    /** `local` never leaves the machine; `remote` requires the operator's flag. */
    locality: "local" | "remote";
    /** Required for a remote provider, and required to be HTTPS. */
    endpoint?: string;
}
export interface EmbeddingResult {
    vector: number[];
    provider_metadata: Record<string, string>;
}
export interface EmbeddingProvider {
    readonly configuration: EmbeddingModelConfiguration;
    embed(text: string): Promise<EmbeddingResult>;
}
/** Identity of the model that produced a vector, for cache keys and reports. */
export interface EmbeddingModelIdentity {
    provider: string;
    model_id: string;
    model_revision: string | null;
    dimension: number;
    chunk_profile: string;
}
export declare function embeddingModelIdentityHash(identity: EmbeddingModelIdentity): string;
/**
 * Reproducibility class of a set of embeddings.
 *
 * Stated rather than assumed. A pinned local model replays bit-identically given
 * the same runtime; a remote provider does not promise that and this package will
 * not claim it does. What is guaranteed either way is replay *from the cache*,
 * which is why the cache is content-addressed.
 */
export type EmbeddingReproducibilityClass = "reproducible_when_runtime_pinned" | "provider_bound";
export declare function reproducibilityClassOf(configuration: EmbeddingModelConfiguration): EmbeddingReproducibilityClass;
export declare class EmbeddingConfigurationError extends Error {
}
export interface EmbeddingEnableOptions {
    embeddingsEnabled: boolean;
    allowRemoteEmbeddings: boolean;
    configuration?: EmbeddingModelConfiguration;
}
/**
 * Decide whether an embedding pass may run, and fail closed with a reason.
 *
 * Every refusal here names the exact flag that would change it, because a guard
 * that only says "not permitted" gets disabled wholesale by the next person who
 * hits it.
 */
export declare function assertEmbeddingConfiguration(options: EmbeddingEnableOptions): void;
export interface DocumentChunk {
    artifact_id: string;
    normalized_document_id: string | null;
    /** Position of this chunk in its document, 0-based. Part of the block id. */
    block_index: number;
    block_id: string;
    text: string;
}
/**
 * Split one document into deterministic overlapping chunks.
 *
 * Title and headings lead, because they are the densest statement of what a
 * document is; the body follows, capped. Overlap is fixed by the profile so two
 * runs cut in the same places.
 */
export declare function chunkDocument(input: {
    artifactId: string;
    normalizedDocumentId: string | null;
    title?: string;
    headings?: readonly string[];
    body?: string;
}): DocumentChunk[];
export declare function vectorDigest(vector: readonly number[]): string;
/** Cosine similarity in [-1, 1]. Zero when either vector has no magnitude. */
export declare function cosineSimilarity(a: readonly number[], b: readonly number[]): number;
/** Mean of a document's chunk vectors: one vector per document, for pair scoring. */
export declare function meanVector(vectors: readonly (readonly number[])[]): number[];
export interface EmbeddableDocument {
    artifact_id: string;
    normalized_document_id: string | null;
    title?: string;
    headings?: readonly string[];
    body?: string;
    /** True when the path matched a secret pattern. Such documents are never embedded. */
    is_secret_candidate: boolean;
    /** True when the artifact never decoded: nothing to embed. */
    decoded: boolean;
}
export interface EmbeddingPairCandidate {
    artifact_a_id: string;
    artifact_b_id: string;
    score: number;
}
export interface EmbeddingRunReport {
    enabled: boolean;
    provider: string | null;
    model_id: string | null;
    model_revision: string | null;
    dimension: number | null;
    chunk_profile: string;
    reproducibility_class: EmbeddingReproducibilityClass | null;
    remote: boolean;
    /** What was sent, so a remote run can be audited. Never content, never paths. */
    artifact_count_sent: number;
    chunk_count_sent: number;
    eligible_artifact_count: number;
    embedded_artifact_count: number;
    secret_candidates_skipped: number;
    cache_hits: number;
    /** Digests only: a raw vector never appears in any emitted document. */
    vector_digests: {
        artifact_id: string;
        vector_digest: string;
    }[];
}
export interface EmbeddingCache {
    get(key: string): number[] | undefined;
    put(key: string, vector: number[]): void;
}
export declare function embeddingCacheKey(input: {
    normalizedDocumentId: string | null;
    artifactId: string;
    chunkProfile: string;
    identity: EmbeddingModelIdentity;
}): string;
export interface RunEmbeddingsInput {
    documents: readonly EmbeddableDocument[];
    provider: EmbeddingProvider;
    cache?: EmbeddingCache;
    /** Cosine at or above which a pair is offered to fusion at all. */
    pairThreshold: number;
}
export interface RunEmbeddingsResult {
    pairs: EmbeddingPairCandidate[];
    report: EmbeddingRunReport;
}
/**
 * Embed the eligible documents and score every pair above the threshold.
 *
 * Pair scoring here is exhaustive over *embedded* documents, which is affordable
 * because the embedded set is bounded by what a decoder opened and by the secret
 * filter. The result is a candidate list handed to `corpus_pairs.ts`, never a
 * conclusion.
 */
export declare function runEmbeddings(input: RunEmbeddingsInput): Promise<RunEmbeddingsResult>;
/** The report emitted when embeddings did not run, which is the default. */
export declare function disabledEmbeddingReport(): EmbeddingRunReport;
/**
 * A provider that returns vectors it was given.
 *
 * For qualification only. It is not a model and does not pretend to be one: it
 * exists so the contract's embedding behaviour — the guards, the cache, the
 * capped pair class, the report — can be tested deterministically without
 * shipping a model or reaching a network.
 */
export declare class StaticEmbeddingProvider implements EmbeddingProvider {
    readonly configuration: EmbeddingModelConfiguration;
    private readonly byText;
    private readonly fallbackDimension;
    constructor(configuration: EmbeddingModelConfiguration, vectorsByText: ReadonlyMap<string, number[]>, fallbackDimension?: number);
    embed(text: string): Promise<EmbeddingResult>;
}
