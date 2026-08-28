/** Schema every persisted cache entry declares. */
export declare const CORPUS_CACHE_ENTRY_SCHEMA = "l9.corpus-cache-entry/v1";
/** Environment variable that overrides the default cache location. */
export declare const CORPUS_CACHE_ENV = "L9_CORPUS_CACHE";
export declare const CORPUS_CACHE_LAYERS: readonly ["archive_manifest", "raw_identity", "normalized_document", "interpretation", "lexical_features", "embedding", "candidate_analysis"];
export type CorpusCacheLayer = (typeof CORPUS_CACHE_LAYERS)[number];
/**
 * Layers whose output is a pure function of their key.
 *
 * Cold and fully warm runs of these must be byte-identical, and the qualification
 * suite asserts exactly that. `embedding` is excluded because a remote model is
 * not a deterministic function this repository can promise anything about; it is
 * cached, and it is never claimed to be reproducible.
 */
export declare const DETERMINISTIC_CACHE_LAYERS: readonly CorpusCacheLayer[];
export interface CorpusCacheEntry<T = unknown> {
    schema: string;
    layer: CorpusCacheLayer;
    key: string;
    payload_hash: string;
    producer_version: string;
    payload: T;
}
export interface CorpusCacheLayerStats {
    layer: CorpusCacheLayer;
    hits: number;
    misses: number;
    writes: number;
    /** Entries discarded because they failed their own integrity check. */
    corrupt: number;
    /** Entries ignored because a different producer version wrote them. */
    stale_producer: number;
}
export interface CorpusCacheDiagnostic {
    code: string;
    severity: "info" | "warning" | "error";
    layer: CorpusCacheLayer;
    key: string;
    message: string;
}
export interface CorpusCacheStats {
    enabled: boolean;
    layers: CorpusCacheLayerStats[];
    hits: number;
    misses: number;
    writes: number;
    corrupt: number;
    stale_producer: number;
    /** Hits over lookups, rounded to six places. `0` when nothing was looked up. */
    hit_ratio: number;
}
export interface CorpusCache {
    readonly enabled: boolean;
    /** Absolute cache root, or null when the cache is disabled or in memory. */
    readonly root: string | null;
    get<T>(layer: CorpusCacheLayer, key: string): T | undefined;
    put<T>(layer: CorpusCacheLayer, key: string, payload: T): void;
    stats(): CorpusCacheStats;
    diagnostics(): CorpusCacheDiagnostic[];
}
/** Key of the exact-bytes layer. The content hash is the identity. */
/**
 * What an archive was found to contain, keyed on the archive's own bytes.
 *
 * An outer ZIP that has not changed does not need decompressing again merely to
 * rediscover member paths and hashes a previous run already established from
 * exactly those bytes. What makes that reuse safe is that the question being
 * asked is the same, and the question is the *resolved policy*, not its version
 * string. Two runs share `version: "1"` while permitting compression ratios of
 * 200 and 10; answering the stricter one out of the looser one's entry admits an
 * archive the operator has just forbidden. So the policy version no longer
 * contributes to identity at all -- not alongside the fingerprint, not as a
 * fallback -- because a key it can influence is a key that can carry that
 * confusion.
 *
 * The fingerprint is required. While callers were being rewired it was optional,
 * and an absent one produced a nonce-carrying key that could never be satisfied
 * -- safe, but only discoverable as a cache that silently never hit. Every caller
 * now supplies it, so the parameter is mandatory and the unqualified branch is
 * gone: omitting the fingerprint is a compile-time error rather than a runtime
 * miss, and there is no longer any path that yields a key without one. The
 * policy version is not a parameter at all, so it cannot be passed, defaulted,
 * or fallen back to.
 */
export declare function archiveManifestKey(input: {
    archiveContentHash: string;
    archiveReaderVersion: string;
    /** Fingerprint of the fully resolved policy. Required: see above. */
    archivePolicyFingerprint: string;
}): string;
export declare function rawIdentityKey(input: {
    contentHash: string;
}): string;
/**
 * Key — and identity — of a decoded document.
 *
 * The decoder is part of the key because two decoders reading the same bytes
 * legitimately produce different text, and a cache that conflated them would
 * serve one decoder's output under the other's name.
 */
export declare function normalizedDocumentKey(input: {
    contentHash: string;
    decoderId: string;
    decoderVersion: string;
}): string;
export declare function interpretationKey(input: {
    normalizedDocumentIdentity: string;
    interpretationProfileHash: string;
}): string;
export declare function lexicalFeaturesKey(input: {
    normalizedDocumentIdentity: string;
    lexicalProfileHash: string;
}): string;
export declare function embeddingKey(input: {
    normalizedDocumentIdentity: string;
    embeddingModelIdentity: string;
    embeddingChunkProfile: string;
}): string;
/**
 * Key of a whole-set analysis.
 *
 * The inputs are sorted, so the order documents were reached in cannot change the
 * key; and every input identity is included, so adding one document to a corpus
 * invalidates the analysis rather than silently reusing the smaller one.
 */
export declare function candidateAnalysisKey(input: {
    inputFeatureIdentities: readonly string[];
    candidateProfileHash: string;
}): string;
/** Hash of a payload, over its canonical rendering rather than its object identity. */
export declare function cachePayloadHash(payload: unknown): string;
/** Why an entry cannot be trusted, or null when it can. */
export declare function cacheEntryDefect(entry: unknown, expected: {
    layer: CorpusCacheLayer;
    key: string;
}): string | null;
/** A cache that never hits and never writes. The behavioral baseline. */
export declare class NullCorpusCache implements CorpusCache {
    readonly enabled = false;
    readonly root: null;
    private readonly accounting;
    get<T>(layer: CorpusCacheLayer, _key: string): T | undefined;
    put<T>(_layer: CorpusCacheLayer, _key: string, _payload: T): void;
    stats(): CorpusCacheStats;
    diagnostics(): CorpusCacheDiagnostic[];
}
/** Process-lifetime cache. Used by tests and by callers that own no disk. */
export declare class MemoryCorpusCache implements CorpusCache {
    private readonly producerVersion;
    readonly enabled = true;
    readonly root: null;
    private readonly entries;
    private readonly accounting;
    constructor(producerVersion: string);
    get<T>(layer: CorpusCacheLayer, key: string): T | undefined;
    put<T>(layer: CorpusCacheLayer, key: string, payload: T): void;
    /** Overwrite an entry's payload hash. Exists so corruption can be qualified. */
    corrupt(layer: CorpusCacheLayer, key: string): boolean;
    stats(): CorpusCacheStats;
    diagnostics(): CorpusCacheDiagnostic[];
}
export interface FileCorpusCacheOptions {
    root: string;
    producerVersion: string;
    /** Roots the cache must not live inside. */
    observedRootPaths?: readonly string[];
}
/** The default cache root: `$L9_CORPUS_CACHE`, else `~/.l9/corpus-cache`. */
export declare function defaultCorpusCacheDir(env?: NodeJS.ProcessEnv): string;
/** Path of one entry, sharded so a large corpus does not build one huge directory. */
export declare function cacheEntryPath(root: string, layer: CorpusCacheLayer, key: string): string;
/** Disk-backed cache. Atomic writes, verified reads, self-healing on corruption. */
/** Owner-only, because the cache holds decoded text from private documents. */
export declare const CACHE_DIRECTORY_MODE = 448;
export declare const CACHE_FILE_MODE = 384;
export declare class FileCorpusCache implements CorpusCache {
    readonly enabled = true;
    readonly root: string;
    private readonly producerVersion;
    private readonly accounting;
    /** Distinguishes concurrent staging files written by one process. */
    private stagingCounter;
    constructor(options: FileCorpusCacheOptions);
    private discard;
    get<T>(layer: CorpusCacheLayer, key: string): T | undefined;
    put<T>(layer: CorpusCacheLayer, key: string, payload: T): void;
    stats(): CorpusCacheStats;
    diagnostics(): CorpusCacheDiagnostic[];
}
/**
 * The accounting one run added to a cache that other runs have already used.
 *
 * A cache instance accumulates counters for its whole lifetime, so a process that
 * scans twice would otherwise report the second scan's hit ratio as the average
 * of both. Every reported ratio in this package is a delta taken across one run.
 */
export declare function cacheStatsDelta(before: CorpusCacheStats, after: CorpusCacheStats): CorpusCacheStats;
/**
 * Read a cached value or compute it, storing what was computed.
 *
 * The single seam every layer goes through. A hit returns what a previous miss
 * stored under an identical key; a miss returns exactly what `compute` produced.
 * Nothing here can make the two differ.
 */
export declare function cached<T>(cache: CorpusCache, layer: CorpusCacheLayer, key: string, compute: () => T): T;
export interface StatPrecheck {
    size_bytes: number;
    mtime_ms: number;
}
export interface PrecheckAccuracy {
    /** Files whose stat matched the previous snapshot's stat. */
    predicted_unchanged: number;
    /** Of those, the ones whose content hash then confirmed it. */
    confirmed_unchanged: number;
    /** Of those, the ones whose content hash contradicted it. */
    contradicted: number;
}
/**
 * A hint that a file is probably unchanged, for scheduling only.
 *
 * Deliberately unable to skip a hash. Every file is hashed on every run, the
 * hint is compared against the result, and disagreements are counted and
 * reported. The reuse this module exists for comes from the layers keyed on the
 * hash — decode, interpret, lexical, embedding — not from trusting the clock.
 */
export declare function statPrecheckMatches(previous: StatPrecheck | undefined, current: StatPrecheck): boolean;
