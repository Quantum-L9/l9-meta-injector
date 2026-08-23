// corpus_cache.test.ts — the cache as a cache, never as an authority.
//
// The properties under test are the ones that make reuse safe: a key is a
// function of content and of the rules applied to it, an entry proves its own
// integrity before it is believed, a broken entry is deleted rather than served,
// and the store is never allowed to live inside a tree the tool observes.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CORPUS_CACHE_ENTRY_SCHEMA,
  CORPUS_CACHE_LAYERS,
  DETERMINISTIC_CACHE_LAYERS,
  FileCorpusCache,
  MemoryCorpusCache,
  NullCorpusCache,
  cacheEntryPath,
  cachePayloadHash,
  cacheStatsDelta,
  cached,
  candidateAnalysisKey,
  defaultCorpusCacheDir,
  embeddingKey,
  rawIdentityKey,
  statPrecheckMatches,
} from "../src/corpus_cache";

const scratch: string[] = [];
function tmp(prefix = "l9-cache-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

describe("keys", () => {
  it("are stable, ordered and rule-bound", () => {
    const hash = `sha256:${"c".repeat(64)}`;
    expect(rawIdentityKey({ contentHash: hash })).toBe(rawIdentityKey({ contentHash: hash }));
    // The order documents were reached in cannot change a whole-set analysis key.
    expect(
      candidateAnalysisKey({ inputFeatureIdentities: ["b", "a"], candidateProfileHash: "p" }),
    ).toBe(candidateAnalysisKey({ inputFeatureIdentities: ["a", "b"], candidateProfileHash: "p" }));
    // …but adding a document does.
    expect(
      candidateAnalysisKey({ inputFeatureIdentities: ["a", "b", "c"], candidateProfileHash: "p" }),
    ).not.toBe(candidateAnalysisKey({ inputFeatureIdentities: ["a", "b"], candidateProfileHash: "p" }));
    expect(
      embeddingKey({
        normalizedDocumentIdentity: "n",
        embeddingModelIdentity: "m1",
        embeddingChunkProfile: "c",
      }),
    ).not.toBe(
      embeddingKey({
        normalizedDocumentIdentity: "n",
        embeddingModelIdentity: "m2",
        embeddingChunkProfile: "c",
      }),
    );
  });

  it("name every layer the contract declares, and mark which are reproducible", () => {
    expect([...CORPUS_CACHE_LAYERS]).toEqual([
      "raw_identity",
      "normalized_document",
      "interpretation",
      "lexical_features",
      "embedding",
      "candidate_analysis",
    ]);
    // A remote model is not a function this repository can promise anything about.
    expect(DETERMINISTIC_CACHE_LAYERS).not.toContain("embedding");
  });
});

describe("a disabled cache", () => {
  it("never hits, never stores, and reports itself as disabled", () => {
    const cache = new NullCorpusCache();
    cache.put("lexical_features", "k", { value: 1 });
    expect(cache.get("lexical_features", "k")).toBeUndefined();
    expect(cache.stats().enabled).toBe(false);
    expect(cache.stats().writes).toBe(0);
    let computed = 0;
    expect(cached(cache, "lexical_features", "k", () => ++computed)).toBe(1);
    expect(cached(cache, "lexical_features", "k", () => ++computed)).toBe(2);
  });
});

describe("an in-memory cache", () => {
  it("returns exactly what a miss computed", () => {
    const cache = new MemoryCorpusCache("v1");
    let computed = 0;
    const first = cached(cache, "interpretation", "k", () => ({ n: ++computed }));
    const second = cached(cache, "interpretation", "k", () => ({ n: ++computed }));
    expect(second).toEqual(first);
    expect(computed).toBe(1);
    expect(cache.stats().hits).toBe(1);
  });

  it("ignores an entry written by a different producer version", () => {
    const cache = new MemoryCorpusCache("v1");
    cache.put("interpretation", "k", { n: 1 });
    const later = new MemoryCorpusCache("v2");
    later.put("interpretation", "k", { n: 2 });
    expect(later.get("interpretation", "k")).toEqual({ n: 2 });
    expect(cache.get("interpretation", "k")).toEqual({ n: 1 });
  });
});

describe("a file-backed cache", () => {
  it("writes a self-describing entry and reads it back", () => {
    const root = tmp();
    const cache = new FileCorpusCache({ root, producerVersion: "v1" });
    cache.put("normalized_document", "normdoc:abc", { token_count: 4 });
    const file = cacheEntryPath(root, "normalized_document", "normdoc:abc");
    const entry = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(entry.schema).toBe(CORPUS_CACHE_ENTRY_SCHEMA);
    expect(entry.layer).toBe("normalized_document");
    expect(entry.key).toBe("normdoc:abc");
    expect(entry.producer_version).toBe("v1");
    expect(entry.payload_hash).toBe(cachePayloadHash({ token_count: 4 }));
    expect(cache.get("normalized_document", "normdoc:abc")).toEqual({ token_count: 4 });
    // Nothing is left behind by the staged write.
    expect(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("discards a tampered entry, reports it, and recomputes", () => {
    const root = tmp();
    const cache = new FileCorpusCache({ root, producerVersion: "v1" });
    cache.put("lexical_features", "lexical:abc", { token_count: 4 });
    const file = cacheEntryPath(root, "lexical_features", "lexical:abc");
    const entry = JSON.parse(fs.readFileSync(file, "utf8"));
    entry.payload = { token_count: 9999 };
    fs.writeFileSync(file, JSON.stringify(entry), "utf8");

    expect(cache.get("lexical_features", "lexical:abc")).toBeUndefined();
    expect(fs.existsSync(file)).toBe(false);
    expect(cache.stats().corrupt).toBe(1);
    expect(cache.diagnostics()[0].code).toBe("corpus-cache.entry_corrupt");
    expect(cache.diagnostics()[0].message).toContain("payload_hash does not describe");
  });

  it("discards an entry that is not JSON at all", () => {
    const root = tmp();
    const cache = new FileCorpusCache({ root, producerVersion: "v1" });
    cache.put("interpretation", "interp:abc", { assertions: [] });
    const file = cacheEntryPath(root, "interpretation", "interp:abc");
    fs.writeFileSync(file, "{ truncated", "utf8");
    expect(cache.get("interpretation", "interp:abc")).toBeUndefined();
    expect(cache.stats().corrupt).toBe(1);
  });

  it("refuses to live inside an observed source tree", () => {
    const source = tmp("l9-cache-source-");
    expect(
      () =>
        new FileCorpusCache({
          root: path.join(source, "nested", "cache"),
          producerVersion: "v1",
          observedRootPaths: [source],
        }),
    ).toThrow(/refusing a cache root inside an observed source tree/);
    // A sibling directory is fine.
    expect(
      () => new FileCorpusCache({ root: tmp(), producerVersion: "v1", observedRootPaths: [source] }),
    ).not.toThrow();
  });

  it("defaults to ~/.l9/corpus-cache, and honours the environment override", () => {
    expect(defaultCorpusCacheDir({})).toBe(path.join(os.homedir(), ".l9", "corpus-cache"));
    expect(defaultCorpusCacheDir({ L9_CORPUS_CACHE: "/var/l9cache" })).toBe("/var/l9cache");
    expect(defaultCorpusCacheDir({ L9_CORPUS_CACHE: "   " })).toBe(
      path.join(os.homedir(), ".l9", "corpus-cache"),
    );
  });
});

describe("accounting", () => {
  it("reports one run's own hits rather than the cache's whole history", () => {
    const cache = new MemoryCorpusCache("v1");
    cached(cache, "raw_identity", "a", () => 1);
    const afterFirst = cache.stats();
    cached(cache, "raw_identity", "a", () => 1);
    const delta = cacheStatsDelta(afterFirst, cache.stats());
    expect(delta.hits).toBe(1);
    expect(delta.misses).toBe(0);
    expect(delta.hit_ratio).toBe(1);
    // The lifetime figure still sees both.
    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().misses).toBe(1);
  });
});

describe("the mtime precheck", () => {
  it("is a hint that requires both size and mtime, and has no prior by default", () => {
    expect(statPrecheckMatches(undefined, { size_bytes: 1, mtime_ms: 2 })).toBe(false);
    expect(statPrecheckMatches({ size_bytes: 1, mtime_ms: 2 }, { size_bytes: 1, mtime_ms: 2 })).toBe(true);
    expect(statPrecheckMatches({ size_bytes: 1, mtime_ms: 2 }, { size_bytes: 1, mtime_ms: 3 })).toBe(false);
    expect(statPrecheckMatches({ size_bytes: 9, mtime_ms: 2 }, { size_bytes: 1, mtime_ms: 2 })).toBe(false);
  });
});
