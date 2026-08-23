// corpus_cache.ts — content-addressed reuse of work already done.
//
// Rescanning a two-terabyte archive should not re-decode a document whose bytes
// have not moved since the last run. That is the whole purpose of this module,
// and the whole danger of it: a cache that can answer a question differently from
// the code it stands in front of has quietly become the source of truth.
//
// Four rules keep it a cache:
//
//   - A key is a function of content and of the rules applied to that content.
//     Never of a path, a mount point, a filename or a timestamp.
//   - A hit and a miss produce the same value. The miss computes it; the hit
//     reads back what a previous miss computed under an identical key.
//   - An entry that fails its own integrity check is discarded and recomputed.
//     A cache is allowed to be empty. It is not allowed to be wrong.
//   - Nothing is ever stored inside an observed source tree.
//
// `mtime` appears here exactly once, as a scheduling hint that is compared against
// the hash afterwards and reported on. It never decides identity, and no code path
// lets it skip a hash.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { canonicalCorpusJson } from "./corpus_analysis";
import { containmentBoundary, isInsideContainer, resolveForContainment } from "./corpus_roots";
import { compareCodePoints } from "./ordering";
import { sha256TextPrefixed, stableId } from "./repository_model";

/** Schema every persisted cache entry declares. */
export const CORPUS_CACHE_ENTRY_SCHEMA = "l9.corpus-cache-entry/v1";

/** Environment variable that overrides the default cache location. */
export const CORPUS_CACHE_ENV = "L9_CORPUS_CACHE";

export const CORPUS_CACHE_LAYERS = [
  "raw_identity",
  "normalized_document",
  "interpretation",
  "lexical_features",
  "embedding",
  "candidate_analysis",
] as const;

export type CorpusCacheLayer = (typeof CORPUS_CACHE_LAYERS)[number];

/**
 * Layers whose output is a pure function of their key.
 *
 * Cold and fully warm runs of these must be byte-identical, and the qualification
 * suite asserts exactly that. `embedding` is excluded because a remote model is
 * not a deterministic function this repository can promise anything about; it is
 * cached, and it is never claimed to be reproducible.
 */
export const DETERMINISTIC_CACHE_LAYERS: readonly CorpusCacheLayer[] = [
  "raw_identity",
  "normalized_document",
  "interpretation",
  "lexical_features",
  "candidate_analysis",
];

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

// ───────────────────────────── keys ─────────────────────────────

/** Key of the exact-bytes layer. The content hash is the identity. */
export function rawIdentityKey(input: { contentHash: string }): string {
  return stableId("raw", { exact_content_hash: input.contentHash });
}

/**
 * Key — and identity — of a decoded document.
 *
 * The decoder is part of the key because two decoders reading the same bytes
 * legitimately produce different text, and a cache that conflated them would
 * serve one decoder's output under the other's name.
 */
export function normalizedDocumentKey(input: {
  contentHash: string;
  decoderId: string;
  decoderVersion: string;
}): string {
  return stableId("normdoc", {
    decoder_id: input.decoderId,
    decoder_version: input.decoderVersion,
    exact_content_hash: input.contentHash,
  });
}

export function interpretationKey(input: {
  normalizedDocumentIdentity: string;
  interpretationProfileHash: string;
}): string {
  return stableId("interp", {
    interpretation_profile_hash: input.interpretationProfileHash,
    normalized_document_identity: input.normalizedDocumentIdentity,
  });
}

export function lexicalFeaturesKey(input: {
  normalizedDocumentIdentity: string;
  lexicalProfileHash: string;
}): string {
  return stableId("lexical", {
    lexical_profile_hash: input.lexicalProfileHash,
    normalized_document_identity: input.normalizedDocumentIdentity,
  });
}

export function embeddingKey(input: {
  normalizedDocumentIdentity: string;
  embeddingModelIdentity: string;
  embeddingChunkProfile: string;
}): string {
  return stableId("embedding", {
    embedding_chunk_profile: input.embeddingChunkProfile,
    embedding_model_identity: input.embeddingModelIdentity,
    normalized_document_identity: input.normalizedDocumentIdentity,
  });
}

/**
 * Key of a whole-set analysis.
 *
 * The inputs are sorted, so the order documents were reached in cannot change the
 * key; and every input identity is included, so adding one document to a corpus
 * invalidates the analysis rather than silently reusing the smaller one.
 */
export function candidateAnalysisKey(input: {
  inputFeatureIdentities: readonly string[];
  candidateProfileHash: string;
}): string {
  return stableId("candidate", {
    candidate_profile_hash: input.candidateProfileHash,
    input_feature_identities: [...input.inputFeatureIdentities].sort(compareCodePoints),
  });
}

// ───────────────────────────── integrity ─────────────────────────────

/** Hash of a payload, over its canonical rendering rather than its object identity. */
export function cachePayloadHash(payload: unknown): string {
  return sha256TextPrefixed(canonicalCorpusJson(payload, 0));
}

/** Why an entry cannot be trusted, or null when it can. */
export function cacheEntryDefect(
  entry: unknown,
  expected: { layer: CorpusCacheLayer; key: string },
): string | null {
  if (entry === null || typeof entry !== "object") return "entry is not an object";
  const record = entry as Partial<CorpusCacheEntry>;
  if (record.schema !== CORPUS_CACHE_ENTRY_SCHEMA) return `unexpected schema '${String(record.schema)}'`;
  if (record.layer !== expected.layer) return `entry belongs to layer '${String(record.layer)}'`;
  if (record.key !== expected.key) return "entry key does not match the key it was filed under";
  if (typeof record.producer_version !== "string") return "producer_version is missing";
  if (typeof record.payload_hash !== "string") return "payload_hash is missing";
  if (!("payload" in record)) return "payload is missing";
  let actual: string;
  try {
    actual = cachePayloadHash(record.payload);
  } catch (error) {
    return `payload is not serializable (${error instanceof Error ? error.message : String(error)})`;
  }
  if (actual !== record.payload_hash) return "payload_hash does not describe the stored payload";
  return null;
}

// ───────────────────────────── stats ─────────────────────────────

function emptyLayerStats(layer: CorpusCacheLayer): CorpusCacheLayerStats {
  return { layer, hits: 0, misses: 0, writes: 0, corrupt: 0, stale_producer: 0 };
}

class CacheAccounting {
  readonly layers = new Map<CorpusCacheLayer, CorpusCacheLayerStats>(
    CORPUS_CACHE_LAYERS.map((layer) => [layer, emptyLayerStats(layer)]),
  );
  readonly notes: CorpusCacheDiagnostic[] = [];

  bump(layer: CorpusCacheLayer, field: keyof Omit<CorpusCacheLayerStats, "layer">): void {
    const stats = this.layers.get(layer);
    if (stats !== undefined) stats[field] += 1;
  }

  note(diagnostic: CorpusCacheDiagnostic): void {
    this.notes.push(diagnostic);
  }

  snapshot(enabled: boolean): CorpusCacheStats {
    const layers = CORPUS_CACHE_LAYERS.map((layer) => ({
      ...(this.layers.get(layer) as CorpusCacheLayerStats),
    }));
    const total = (field: keyof Omit<CorpusCacheLayerStats, "layer">): number =>
      layers.reduce((sum, stats) => sum + stats[field], 0);
    const hits = total("hits");
    const misses = total("misses");
    const lookups = hits + misses;
    return {
      enabled,
      layers,
      hits,
      misses,
      writes: total("writes"),
      corrupt: total("corrupt"),
      stale_producer: total("stale_producer"),
      hit_ratio: lookups === 0 ? 0 : Math.round((hits / lookups) * 1e6) / 1e6,
    };
  }

  diagnostics(): CorpusCacheDiagnostic[] {
    return [...this.notes].sort(
      (a, b) =>
        compareCodePoints(a.code, b.code)
        || compareCodePoints(a.layer, b.layer)
        || compareCodePoints(a.key, b.key),
    );
  }
}

// ───────────────────────────── implementations ─────────────────────────────

/** A cache that never hits and never writes. The behavioral baseline. */
export class NullCorpusCache implements CorpusCache {
  readonly enabled = false;
  readonly root = null;
  private readonly accounting = new CacheAccounting();

  get<T>(layer: CorpusCacheLayer, _key: string): T | undefined {
    this.accounting.bump(layer, "misses");
    return undefined;
  }

  put<T>(_layer: CorpusCacheLayer, _key: string, _payload: T): void {
    // Deliberately empty: a disabled cache stores nothing, so a run with the
    // cache off is exactly a cold run.
  }

  stats(): CorpusCacheStats {
    return this.accounting.snapshot(false);
  }

  diagnostics(): CorpusCacheDiagnostic[] {
    return this.accounting.diagnostics();
  }
}

/** Process-lifetime cache. Used by tests and by callers that own no disk. */
export class MemoryCorpusCache implements CorpusCache {
  readonly enabled = true;
  readonly root = null;
  private readonly entries = new Map<string, CorpusCacheEntry>();
  private readonly accounting = new CacheAccounting();

  constructor(private readonly producerVersion: string) {}

  get<T>(layer: CorpusCacheLayer, key: string): T | undefined {
    const slot = `${layer}/${key}`;
    const entry = this.entries.get(slot);
    if (entry === undefined) {
      this.accounting.bump(layer, "misses");
      return undefined;
    }
    if (entry.producer_version !== this.producerVersion) {
      this.accounting.bump(layer, "stale_producer");
      this.accounting.bump(layer, "misses");
      this.entries.delete(slot);
      return undefined;
    }
    const defect = cacheEntryDefect(entry, { layer, key });
    if (defect !== null) {
      this.accounting.bump(layer, "corrupt");
      this.accounting.bump(layer, "misses");
      this.accounting.note({
        code: "corpus-cache.entry_corrupt",
        severity: "warning",
        layer,
        key,
        message: `${defect}; the entry was discarded and the value recomputed`,
      });
      this.entries.delete(slot);
      return undefined;
    }
    this.accounting.bump(layer, "hits");
    return entry.payload as T;
  }

  put<T>(layer: CorpusCacheLayer, key: string, payload: T): void {
    this.entries.set(`${layer}/${key}`, {
      schema: CORPUS_CACHE_ENTRY_SCHEMA,
      layer,
      key,
      payload_hash: cachePayloadHash(payload),
      producer_version: this.producerVersion,
      payload,
    });
    this.accounting.bump(layer, "writes");
  }

  /** Overwrite an entry's payload hash. Exists so corruption can be qualified. */
  corrupt(layer: CorpusCacheLayer, key: string): boolean {
    const slot = `${layer}/${key}`;
    const entry = this.entries.get(slot);
    if (entry === undefined) return false;
    this.entries.set(slot, { ...entry, payload_hash: `sha256:${"0".repeat(64)}` });
    return true;
  }

  stats(): CorpusCacheStats {
    return this.accounting.snapshot(true);
  }

  diagnostics(): CorpusCacheDiagnostic[] {
    return this.accounting.diagnostics();
  }
}

export interface FileCorpusCacheOptions {
  root: string;
  producerVersion: string;
  /** Roots the cache must not live inside. */
  observedRootPaths?: readonly string[];
}

/** The default cache root: `$L9_CORPUS_CACHE`, else `~/.l9/corpus-cache`. */
export function defaultCorpusCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const declared = env[CORPUS_CACHE_ENV];
  if (typeof declared === "string" && declared.trim().length > 0) return path.resolve(declared.trim());
  return path.join(os.homedir(), ".l9", "corpus-cache");
}

/** Path of one entry, sharded so a large corpus does not build one huge directory. */
export function cacheEntryPath(root: string, layer: CorpusCacheLayer, key: string): string {
  const digest = crypto.createHash("sha256").update(`${layer} ${key}`, "utf8").digest("hex");
  return path.join(root, layer, digest.slice(0, 2), digest.slice(2, 4), `${digest}.json`);
}

/** Disk-backed cache. Atomic writes, verified reads, self-healing on corruption. */
export class FileCorpusCache implements CorpusCache {
  readonly enabled = true;
  readonly root: string;
  private readonly producerVersion: string;
  private readonly accounting = new CacheAccounting();

  constructor(options: FileCorpusCacheOptions) {
    // Resolved through `realpath`, like every other writable location this
    // package approves: a symlinked cache directory pointing into an observed
    // tree would otherwise pass a lexical check and then write through it.
    const absolute = resolveForContainment(options.root);
    for (const rootPath of options.observedRootPaths ?? []) {
      if (isInsideContainer(containmentBoundary(rootPath), absolute)) {
        throw new Error(
          `corpus-cache: refusing a cache root inside an observed source tree: ${absolute}`,
        );
      }
    }
    this.root = absolute;
    this.producerVersion = options.producerVersion;
    fs.mkdirSync(this.root, { recursive: true });
  }

  private discard(file: string): void {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // A cache entry that cannot be removed is still not trusted; the run
      // recomputes the value either way, so the failure is not escalated.
    }
  }

  get<T>(layer: CorpusCacheLayer, key: string): T | undefined {
    const file = cacheEntryPath(this.root, layer, key);
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      this.accounting.bump(layer, "misses");
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.accounting.bump(layer, "corrupt");
      this.accounting.bump(layer, "misses");
      this.accounting.note({
        code: "corpus-cache.entry_corrupt",
        severity: "warning",
        layer,
        key,
        message: `entry is not valid JSON (${error instanceof Error ? error.message : String(error)}); `
          + "the entry was discarded and the value recomputed",
      });
      this.discard(file);
      return undefined;
    }
    const producerVersion = (parsed as Partial<CorpusCacheEntry> | null)?.producer_version;
    if (producerVersion !== this.producerVersion) {
      this.accounting.bump(layer, "stale_producer");
      this.accounting.bump(layer, "misses");
      this.discard(file);
      return undefined;
    }
    const defect = cacheEntryDefect(parsed, { layer, key });
    if (defect !== null) {
      this.accounting.bump(layer, "corrupt");
      this.accounting.bump(layer, "misses");
      this.accounting.note({
        code: "corpus-cache.entry_corrupt",
        severity: "warning",
        layer,
        key,
        message: `${defect}; the entry was discarded and the value recomputed`,
      });
      this.discard(file);
      return undefined;
    }
    this.accounting.bump(layer, "hits");
    return (parsed as CorpusCacheEntry<T>).payload;
  }

  put<T>(layer: CorpusCacheLayer, key: string, payload: T): void {
    const entry: CorpusCacheEntry<T> = {
      schema: CORPUS_CACHE_ENTRY_SCHEMA,
      layer,
      key,
      payload_hash: cachePayloadHash(payload),
      producer_version: this.producerVersion,
      payload,
    };
    const file = cacheEntryPath(this.root, layer, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Written to a sibling and renamed: a half-written entry that a later run
    // could read as complete is the one corruption a cache can cause itself.
    const staging = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(staging, `${canonicalCorpusJson(entry)}\n`, "utf8");
    fs.renameSync(staging, file);
    this.accounting.bump(layer, "writes");
  }

  stats(): CorpusCacheStats {
    return this.accounting.snapshot(true);
  }

  diagnostics(): CorpusCacheDiagnostic[] {
    return this.accounting.diagnostics();
  }
}

/**
 * The accounting one run added to a cache that other runs have already used.
 *
 * A cache instance accumulates counters for its whole lifetime, so a process that
 * scans twice would otherwise report the second scan's hit ratio as the average
 * of both. Every reported ratio in this package is a delta taken across one run.
 */
export function cacheStatsDelta(before: CorpusCacheStats, after: CorpusCacheStats): CorpusCacheStats {
  const beforeByLayer = new Map(before.layers.map((layer) => [layer.layer, layer]));
  const layers = after.layers.map((layer) => {
    const start = beforeByLayer.get(layer.layer);
    return {
      layer: layer.layer,
      hits: layer.hits - (start?.hits ?? 0),
      misses: layer.misses - (start?.misses ?? 0),
      writes: layer.writes - (start?.writes ?? 0),
      corrupt: layer.corrupt - (start?.corrupt ?? 0),
      stale_producer: layer.stale_producer - (start?.stale_producer ?? 0),
    };
  });
  const total = (field: keyof Omit<CorpusCacheLayerStats, "layer">): number =>
    layers.reduce((sum, layer) => sum + layer[field], 0);
  const hits = total("hits");
  const misses = total("misses");
  const lookups = hits + misses;
  return {
    enabled: after.enabled,
    layers,
    hits,
    misses,
    writes: total("writes"),
    corrupt: total("corrupt"),
    stale_producer: total("stale_producer"),
    hit_ratio: lookups === 0 ? 0 : Math.round((hits / lookups) * 1e6) / 1e6,
  };
}

/**
 * Read a cached value or compute it, storing what was computed.
 *
 * The single seam every layer goes through. A hit returns what a previous miss
 * stored under an identical key; a miss returns exactly what `compute` produced.
 * Nothing here can make the two differ.
 */
export function cached<T>(
  cache: CorpusCache,
  layer: CorpusCacheLayer,
  key: string,
  compute: () => T,
): T {
  const hit = cache.get<T>(layer, key);
  if (hit !== undefined) return hit;
  const value = compute();
  cache.put(layer, key, value);
  return value;
}

// ───────────────────────────── the mtime precheck ─────────────────────────────

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
export function statPrecheckMatches(
  previous: StatPrecheck | undefined,
  current: StatPrecheck,
): boolean {
  if (previous === undefined) return false;
  return previous.size_bytes === current.size_bytes && previous.mtime_ms === current.mtime_ms;
}
