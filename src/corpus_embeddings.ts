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
import { compareCodePoints } from "./ordering";
import { stableId } from "./repository_model";
import { normalizeForAnalysis } from "./corpus_analysis";

export const EMBEDDING_CHUNK_PROFILE_ID = "semantic-chunking/v1";
export const EMBEDDING_CHUNK_PROFILE_VERSION = "1.0.0";

/** Characters per chunk, and the fixed overlap between consecutive chunks. */
export const EMBEDDING_CHUNK_CHARACTERS = 1_000;
export const EMBEDDING_CHUNK_OVERLAP_CHARACTERS = 100;

/** Chunks embedded per document. Bounded so one long file cannot dominate a run. */
export const MAX_CHUNKS_PER_DOCUMENT = 8;

/** Decimal places a reported cosine is rounded to, so replays are byte-identical. */
const SCORE_PRECISION = 6;

export function embeddingChunkProfileHash(): string {
  return stableId("embedding-chunk-profile", {
    chunk_characters: EMBEDDING_CHUNK_CHARACTERS,
    max_chunks_per_document: MAX_CHUNKS_PER_DOCUMENT,
    overlap_characters: EMBEDDING_CHUNK_OVERLAP_CHARACTERS,
    profile_id: EMBEDDING_CHUNK_PROFILE_ID,
    profile_version: EMBEDDING_CHUNK_PROFILE_VERSION,
  });
}

// ───────────────────────────── provider interface ─────────────────────────────

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

export function embeddingModelIdentityHash(identity: EmbeddingModelIdentity): string {
  return stableId("embedding-model", {
    chunk_profile: identity.chunk_profile,
    dimension: identity.dimension,
    model_id: identity.model_id,
    model_revision: identity.model_revision,
    provider: identity.provider,
  });
}

/**
 * Reproducibility class of a set of embeddings.
 *
 * Stated rather than assumed. A pinned local model replays bit-identically given
 * the same runtime; a remote provider does not promise that and this package will
 * not claim it does. What is guaranteed either way is replay *from the cache*,
 * which is why the cache is content-addressed.
 */
export type EmbeddingReproducibilityClass =
  | "reproducible_when_runtime_pinned"
  | "provider_bound";

export function reproducibilityClassOf(
  configuration: EmbeddingModelConfiguration,
): EmbeddingReproducibilityClass {
  return configuration.locality === "local"
    ? "reproducible_when_runtime_pinned"
    : "provider_bound";
}

// ───────────────────────────── egress guard ─────────────────────────────

export class EmbeddingConfigurationError extends Error {}

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
export function assertEmbeddingConfiguration(options: EmbeddingEnableOptions): void {
  if (!options.embeddingsEnabled) return;
  const configuration = options.configuration;
  if (configuration === undefined) {
    throw new EmbeddingConfigurationError(
      "embeddings are enabled but no provider is configured: pass --embedding-provider and "
      + "--embedding-model, or drop --embeddings",
    );
  }
  if (configuration.provider.trim().length === 0 || configuration.model_id.trim().length === 0) {
    throw new EmbeddingConfigurationError(
      "embeddings are enabled but the provider or model id is empty: both must be named explicitly",
    );
  }
  if (configuration.locality === "remote") {
    if (!options.allowRemoteEmbeddings) {
      throw new EmbeddingConfigurationError(
        `provider '${configuration.provider}' is remote, which sends bounded document text off this `
        + "machine. That needs --allow-remote-embeddings, which enabling embeddings alone does not imply",
      );
    }
    const endpoint = configuration.endpoint ?? "";
    if (!endpoint.startsWith("https://")) {
      throw new EmbeddingConfigurationError(
        `remote provider '${configuration.provider}' must use an https:// endpoint; got `
        + `'${endpoint.length === 0 ? "(none)" : endpoint}'`,
      );
    }
  }
}

// ───────────────────────────── chunking ─────────────────────────────

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
export function chunkDocument(input: {
  artifactId: string;
  normalizedDocumentId: string | null;
  title?: string;
  headings?: readonly string[];
  body?: string;
}): DocumentChunk[] {
  const lead = [input.title ?? "", ...(input.headings ?? [])]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n");
  const body = normalizeForAnalysis(input.body ?? "").trim();
  const text = [lead, body].filter((part) => part.length > 0).join("\n");
  if (text.length === 0) return [];

  const chunks: DocumentChunk[] = [];
  const stride = EMBEDDING_CHUNK_CHARACTERS - EMBEDDING_CHUNK_OVERLAP_CHARACTERS;
  for (let offset = 0, index = 0; offset < text.length && index < MAX_CHUNKS_PER_DOCUMENT; offset += stride, index += 1) {
    const slice = text.slice(offset, offset + EMBEDDING_CHUNK_CHARACTERS);
    if (slice.trim().length === 0) break;
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

export function vectorDigest(vector: readonly number[]): string {
  // Fixed-precision strings, for the same reason every other identity here uses
  // them: the canonical hasher takes integers only, and a rounded float is still
  // a float.
  return stableId("vector", { values: vector.map((value) => value.toFixed(6)) });
}

/** Cosine similarity in [-1, 1]. Zero when either vector has no magnitude. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] as number;
    const right = b[i] as number;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return 0;
  const raw = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  const clamped = Math.max(-1, Math.min(1, raw));
  return Math.round(clamped * 10 ** SCORE_PRECISION) / 10 ** SCORE_PRECISION;
}

/** Mean of a document's chunk vectors: one vector per document, for pair scoring. */
export function meanVector(vectors: readonly (readonly number[])[]): number[] {
  if (vectors.length === 0) return [];
  const dimension = (vectors[0] as readonly number[]).length;
  const out = new Array<number>(dimension).fill(0);
  for (const vector of vectors) {
    if (vector.length !== dimension) continue;
    for (let i = 0; i < dimension; i += 1) out[i] = (out[i] as number) + (vector[i] as number);
  }
  return out.map((value) => value / vectors.length);
}

// ───────────────────────────── the pass ─────────────────────────────

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
  vector_digests: { artifact_id: string; vector_digest: string }[];
}

export interface EmbeddingCache {
  get(key: string): number[] | undefined;
  put(key: string, vector: number[]): void;
}

export function embeddingCacheKey(input: {
  normalizedDocumentId: string | null;
  artifactId: string;
  chunkProfile: string;
  identity: EmbeddingModelIdentity;
}): string {
  return stableId("embedding-doc", {
    chunk_profile: input.chunkProfile,
    model_id: input.identity.model_id,
    model_revision: input.identity.model_revision,
    normalized_document_id: input.normalizedDocumentId ?? input.artifactId,
    provider: input.identity.provider,
  });
}

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
export async function runEmbeddings(input: RunEmbeddingsInput): Promise<RunEmbeddingsResult> {
  const configuration = input.provider.configuration;
  const chunkProfile = embeddingChunkProfileHash();

  const eligible = input.documents.filter((document) => document.decoded);
  const secretsSkipped = eligible.filter((document) => document.is_secret_candidate).length;
  const embeddable = eligible.filter((document) => !document.is_secret_candidate);

  const vectors = new Map<string, number[]>();
  let chunksSent = 0;
  let artifactsSent = 0;
  let cacheHits = 0;
  let dimension: number | null = null;

  for (const document of [...embeddable].sort((a, b) => compareCodePoints(a.artifact_id, b.artifact_id))) {
    const identity: EmbeddingModelIdentity = {
      provider: configuration.provider,
      model_id: configuration.model_id,
      model_revision: configuration.model_revision ?? null,
      dimension: dimension ?? 0,
      chunk_profile: chunkProfile,
    };
    const key = embeddingCacheKey({
      normalizedDocumentId: document.normalized_document_id,
      artifactId: document.artifact_id,
      chunkProfile,
      identity: { ...identity, dimension: 0 },
    });
    const cached = input.cache?.get(key);
    if (cached !== undefined) {
      vectors.set(document.artifact_id, cached);
      dimension = dimension ?? cached.length;
      cacheHits += 1;
      continue;
    }

    const chunks = chunkDocument({
      artifactId: document.artifact_id,
      normalizedDocumentId: document.normalized_document_id,
      ...(document.title !== undefined ? { title: document.title } : {}),
      ...(document.headings !== undefined ? { headings: document.headings } : {}),
      ...(document.body !== undefined ? { body: document.body } : {}),
    });
    if (chunks.length === 0) continue;

    const chunkVectors: number[][] = [];
    for (const chunk of chunks) {
      const result = await input.provider.embed(chunk.text);
      chunkVectors.push(result.vector);
      chunksSent += 1;
    }
    artifactsSent += 1;
    const mean = meanVector(chunkVectors);
    if (mean.length === 0) continue;
    dimension = dimension ?? mean.length;
    vectors.set(document.artifact_id, mean);
    input.cache?.put(key, mean);
  }

  const ids = [...vectors.keys()].sort(compareCodePoints);
  const pairs: EmbeddingPairCandidate[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i] as string;
      const b = ids[j] as string;
      const score = cosineSimilarity(vectors.get(a) as number[], vectors.get(b) as number[]);
      if (score >= input.pairThreshold) pairs.push({ artifact_a_id: a, artifact_b_id: b, score });
    }
  }

  return {
    pairs: pairs.sort(
      (x, y) => compareCodePoints(x.artifact_a_id, y.artifact_a_id)
        || compareCodePoints(x.artifact_b_id, y.artifact_b_id),
    ),
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
        vector_digest: vectorDigest(vectors.get(id) as number[]),
      })),
    },
  };
}

/** The report emitted when embeddings did not run, which is the default. */
export function disabledEmbeddingReport(): EmbeddingRunReport {
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
export class StaticEmbeddingProvider implements EmbeddingProvider {
  readonly configuration: EmbeddingModelConfiguration;
  private readonly byText: Map<string, number[]>;
  private readonly fallbackDimension: number;

  constructor(
    configuration: EmbeddingModelConfiguration,
    vectorsByText: ReadonlyMap<string, number[]>,
    fallbackDimension = 4,
  ) {
    this.configuration = configuration;
    this.byText = new Map(vectorsByText);
    this.fallbackDimension = fallbackDimension;
  }

  embed(text: string): Promise<EmbeddingResult> {
    for (const [needle, vector] of this.byText) {
      if (text.includes(needle)) {
        return Promise.resolve({ vector, provider_metadata: { matched: needle } });
      }
    }
    return Promise.resolve({
      vector: new Array<number>(this.fallbackDimension).fill(0),
      provider_metadata: { matched: "none" },
    });
  }
}
