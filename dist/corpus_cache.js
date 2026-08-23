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
exports.FileCorpusCache = exports.MemoryCorpusCache = exports.NullCorpusCache = exports.DETERMINISTIC_CACHE_LAYERS = exports.CORPUS_CACHE_LAYERS = exports.CORPUS_CACHE_ENV = exports.CORPUS_CACHE_ENTRY_SCHEMA = void 0;
exports.rawIdentityKey = rawIdentityKey;
exports.normalizedDocumentKey = normalizedDocumentKey;
exports.interpretationKey = interpretationKey;
exports.lexicalFeaturesKey = lexicalFeaturesKey;
exports.embeddingKey = embeddingKey;
exports.candidateAnalysisKey = candidateAnalysisKey;
exports.cachePayloadHash = cachePayloadHash;
exports.cacheEntryDefect = cacheEntryDefect;
exports.defaultCorpusCacheDir = defaultCorpusCacheDir;
exports.cacheEntryPath = cacheEntryPath;
exports.cacheStatsDelta = cacheStatsDelta;
exports.cached = cached;
exports.statPrecheckMatches = statPrecheckMatches;
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
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const corpus_analysis_1 = require("./corpus_analysis");
const ordering_1 = require("./ordering");
const repository_model_1 = require("./repository_model");
/** Schema every persisted cache entry declares. */
exports.CORPUS_CACHE_ENTRY_SCHEMA = "l9.corpus-cache-entry/v1";
/** Environment variable that overrides the default cache location. */
exports.CORPUS_CACHE_ENV = "L9_CORPUS_CACHE";
exports.CORPUS_CACHE_LAYERS = [
    "raw_identity",
    "normalized_document",
    "interpretation",
    "lexical_features",
    "embedding",
    "candidate_analysis",
];
/**
 * Layers whose output is a pure function of their key.
 *
 * Cold and fully warm runs of these must be byte-identical, and the qualification
 * suite asserts exactly that. `embedding` is excluded because a remote model is
 * not a deterministic function this repository can promise anything about; it is
 * cached, and it is never claimed to be reproducible.
 */
exports.DETERMINISTIC_CACHE_LAYERS = [
    "raw_identity",
    "normalized_document",
    "interpretation",
    "lexical_features",
    "candidate_analysis",
];
// ───────────────────────────── keys ─────────────────────────────
/** Key of the exact-bytes layer. The content hash is the identity. */
function rawIdentityKey(input) {
    return (0, repository_model_1.stableId)("raw", { exact_content_hash: input.contentHash });
}
/**
 * Key — and identity — of a decoded document.
 *
 * The decoder is part of the key because two decoders reading the same bytes
 * legitimately produce different text, and a cache that conflated them would
 * serve one decoder's output under the other's name.
 */
function normalizedDocumentKey(input) {
    return (0, repository_model_1.stableId)("normdoc", {
        decoder_id: input.decoderId,
        decoder_version: input.decoderVersion,
        exact_content_hash: input.contentHash,
    });
}
function interpretationKey(input) {
    return (0, repository_model_1.stableId)("interp", {
        interpretation_profile_hash: input.interpretationProfileHash,
        normalized_document_identity: input.normalizedDocumentIdentity,
    });
}
function lexicalFeaturesKey(input) {
    return (0, repository_model_1.stableId)("lexical", {
        lexical_profile_hash: input.lexicalProfileHash,
        normalized_document_identity: input.normalizedDocumentIdentity,
    });
}
function embeddingKey(input) {
    return (0, repository_model_1.stableId)("embedding", {
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
function candidateAnalysisKey(input) {
    return (0, repository_model_1.stableId)("candidate", {
        candidate_profile_hash: input.candidateProfileHash,
        input_feature_identities: [...input.inputFeatureIdentities].sort(ordering_1.compareCodePoints),
    });
}
// ───────────────────────────── integrity ─────────────────────────────
/** Hash of a payload, over its canonical rendering rather than its object identity. */
function cachePayloadHash(payload) {
    return (0, repository_model_1.sha256TextPrefixed)((0, corpus_analysis_1.canonicalCorpusJson)(payload, 0));
}
/** Why an entry cannot be trusted, or null when it can. */
function cacheEntryDefect(entry, expected) {
    if (entry === null || typeof entry !== "object")
        return "entry is not an object";
    const record = entry;
    if (record.schema !== exports.CORPUS_CACHE_ENTRY_SCHEMA)
        return `unexpected schema '${String(record.schema)}'`;
    if (record.layer !== expected.layer)
        return `entry belongs to layer '${String(record.layer)}'`;
    if (record.key !== expected.key)
        return "entry key does not match the key it was filed under";
    if (typeof record.producer_version !== "string")
        return "producer_version is missing";
    if (typeof record.payload_hash !== "string")
        return "payload_hash is missing";
    if (!("payload" in record))
        return "payload is missing";
    let actual;
    try {
        actual = cachePayloadHash(record.payload);
    }
    catch (error) {
        return `payload is not serializable (${error instanceof Error ? error.message : String(error)})`;
    }
    if (actual !== record.payload_hash)
        return "payload_hash does not describe the stored payload";
    return null;
}
// ───────────────────────────── stats ─────────────────────────────
function emptyLayerStats(layer) {
    return { layer, hits: 0, misses: 0, writes: 0, corrupt: 0, stale_producer: 0 };
}
class CacheAccounting {
    constructor() {
        this.layers = new Map(exports.CORPUS_CACHE_LAYERS.map((layer) => [layer, emptyLayerStats(layer)]));
        this.notes = [];
    }
    bump(layer, field) {
        const stats = this.layers.get(layer);
        if (stats !== undefined)
            stats[field] += 1;
    }
    note(diagnostic) {
        this.notes.push(diagnostic);
    }
    snapshot(enabled) {
        const layers = exports.CORPUS_CACHE_LAYERS.map((layer) => ({
            ...this.layers.get(layer),
        }));
        const total = (field) => layers.reduce((sum, stats) => sum + stats[field], 0);
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
    diagnostics() {
        return [...this.notes].sort((a, b) => (0, ordering_1.compareCodePoints)(a.code, b.code)
            || (0, ordering_1.compareCodePoints)(a.layer, b.layer)
            || (0, ordering_1.compareCodePoints)(a.key, b.key));
    }
}
// ───────────────────────────── implementations ─────────────────────────────
/** A cache that never hits and never writes. The behavioral baseline. */
class NullCorpusCache {
    constructor() {
        this.enabled = false;
        this.root = null;
        this.accounting = new CacheAccounting();
    }
    get(layer, _key) {
        this.accounting.bump(layer, "misses");
        return undefined;
    }
    put(_layer, _key, _payload) {
        // Deliberately empty: a disabled cache stores nothing, so a run with the
        // cache off is exactly a cold run.
    }
    stats() {
        return this.accounting.snapshot(false);
    }
    diagnostics() {
        return this.accounting.diagnostics();
    }
}
exports.NullCorpusCache = NullCorpusCache;
/** Process-lifetime cache. Used by tests and by callers that own no disk. */
class MemoryCorpusCache {
    constructor(producerVersion) {
        this.producerVersion = producerVersion;
        this.enabled = true;
        this.root = null;
        this.entries = new Map();
        this.accounting = new CacheAccounting();
    }
    get(layer, key) {
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
        return entry.payload;
    }
    put(layer, key, payload) {
        this.entries.set(`${layer}/${key}`, {
            schema: exports.CORPUS_CACHE_ENTRY_SCHEMA,
            layer,
            key,
            payload_hash: cachePayloadHash(payload),
            producer_version: this.producerVersion,
            payload,
        });
        this.accounting.bump(layer, "writes");
    }
    /** Overwrite an entry's payload hash. Exists so corruption can be qualified. */
    corrupt(layer, key) {
        const slot = `${layer}/${key}`;
        const entry = this.entries.get(slot);
        if (entry === undefined)
            return false;
        this.entries.set(slot, { ...entry, payload_hash: `sha256:${"0".repeat(64)}` });
        return true;
    }
    stats() {
        return this.accounting.snapshot(true);
    }
    diagnostics() {
        return this.accounting.diagnostics();
    }
}
exports.MemoryCorpusCache = MemoryCorpusCache;
/** The default cache root: `$L9_CORPUS_CACHE`, else `~/.l9/corpus-cache`. */
function defaultCorpusCacheDir(env = process.env) {
    const declared = env[exports.CORPUS_CACHE_ENV];
    if (typeof declared === "string" && declared.trim().length > 0)
        return path.resolve(declared.trim());
    return path.join(os.homedir(), ".l9", "corpus-cache");
}
/** Path of one entry, sharded so a large corpus does not build one huge directory. */
function cacheEntryPath(root, layer, key) {
    const digest = crypto.createHash("sha256").update(`${layer} ${key}`, "utf8").digest("hex");
    return path.join(root, layer, digest.slice(0, 2), digest.slice(2, 4), `${digest}.json`);
}
/** Disk-backed cache. Atomic writes, verified reads, self-healing on corruption. */
class FileCorpusCache {
    constructor(options) {
        this.enabled = true;
        this.accounting = new CacheAccounting();
        const absolute = path.resolve(options.root);
        for (const rootPath of options.observedRootPaths ?? []) {
            const observed = path.resolve(rootPath);
            const container = fs.existsSync(observed) && fs.statSync(observed).isDirectory()
                ? observed
                : path.dirname(observed);
            if (absolute === container || absolute.startsWith(container + path.sep)) {
                throw new Error(`corpus-cache: refusing a cache root inside an observed source tree: ${absolute}`);
            }
        }
        this.root = absolute;
        this.producerVersion = options.producerVersion;
        fs.mkdirSync(this.root, { recursive: true });
    }
    discard(file) {
        try {
            fs.rmSync(file, { force: true });
        }
        catch {
            // A cache entry that cannot be removed is still not trusted; the run
            // recomputes the value either way, so the failure is not escalated.
        }
    }
    get(layer, key) {
        const file = cacheEntryPath(this.root, layer, key);
        let raw;
        try {
            raw = fs.readFileSync(file, "utf8");
        }
        catch {
            this.accounting.bump(layer, "misses");
            return undefined;
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (error) {
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
        const producerVersion = parsed?.producer_version;
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
        return parsed.payload;
    }
    put(layer, key, payload) {
        const entry = {
            schema: exports.CORPUS_CACHE_ENTRY_SCHEMA,
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
        fs.writeFileSync(staging, `${(0, corpus_analysis_1.canonicalCorpusJson)(entry)}\n`, "utf8");
        fs.renameSync(staging, file);
        this.accounting.bump(layer, "writes");
    }
    stats() {
        return this.accounting.snapshot(true);
    }
    diagnostics() {
        return this.accounting.diagnostics();
    }
}
exports.FileCorpusCache = FileCorpusCache;
/**
 * The accounting one run added to a cache that other runs have already used.
 *
 * A cache instance accumulates counters for its whole lifetime, so a process that
 * scans twice would otherwise report the second scan's hit ratio as the average
 * of both. Every reported ratio in this package is a delta taken across one run.
 */
function cacheStatsDelta(before, after) {
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
    const total = (field) => layers.reduce((sum, layer) => sum + layer[field], 0);
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
function cached(cache, layer, key, compute) {
    const hit = cache.get(layer, key);
    if (hit !== undefined)
        return hit;
    const value = compute();
    cache.put(layer, key, value);
    return value;
}
/**
 * A hint that a file is probably unchanged, for scheduling only.
 *
 * Deliberately unable to skip a hash. Every file is hashed on every run, the
 * hint is compared against the result, and disagreements are counted and
 * reported. The reuse this module exists for comes from the layers keyed on the
 * hash — decode, interpret, lexical, embedding — not from trusting the clock.
 */
function statPrecheckMatches(previous, current) {
    if (previous === undefined)
        return false;
    return previous.size_bytes === current.size_bytes && previous.mtime_ms === current.mtime_ms;
}
//# sourceMappingURL=corpus_cache.js.map