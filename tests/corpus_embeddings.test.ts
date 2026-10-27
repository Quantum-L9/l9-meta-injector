// corpus_embeddings.test.ts — the guards, not the arithmetic.
//
// Cosine similarity is three lines and is tested here in passing. What is
// actually under test is everything around it, because the embedding pass is the
// first thing in this pipeline that can send a document off the machine:
//
//   - it is off unless asked for;
//   - a remote provider needs a second, separate permission;
//   - a credential-shaped document is never embedded at any setting;
//   - a raw vector never leaves the cache.
//
// Each of those is a property that fails silently if it regresses, which is
// exactly the kind that has to be asserted rather than reviewed.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMBEDDING_PAIR_THRESHOLD,
} from "../src/corpus_fusion";
import {
  EmbeddingConfigurationError,
  MAX_CHUNKS_PER_DOCUMENT,
  StaticEmbeddingProvider,
  assertEmbeddingConfiguration,
  chunkDocument,
  cosineSimilarity,
  disabledEmbeddingReport,
  embeddingCacheKey,
  reproducibilityClassOf,
  runEmbeddings,
  vectorDigest,
} from "../src/corpus_embeddings";
import type {
  EmbeddableDocument,
  EmbeddingCache,
  EmbeddingModelConfiguration,
} from "../src/corpus_embeddings";

const LOCAL: EmbeddingModelConfiguration = {
  provider: "fixture-local", model_id: "fixture-1", locality: "local",
};
const REMOTE: EmbeddingModelConfiguration = {
  provider: "fixture-remote", model_id: "fixture-1", locality: "remote",
  endpoint: "https://embeddings.example.com/v1",
};

function documents(): EmbeddableDocument[] {
  return [
    {
      artifact_id: "a", normalized_document_id: "normdoc:a", decoded: true,
      is_secret_candidate: false, title: "Temporal Assertion Persistence",
      body: "Persist temporal assertions in the knowledge graph.",
    },
    {
      artifact_id: "b", normalized_document_id: "normdoc:b", decoded: true,
      is_secret_candidate: false, title: "Durable Semantic Memory",
      body: "Store time-aware facts in durable semantic memory.",
    },
    {
      artifact_id: "secret", normalized_document_id: "normdoc:secret", decoded: true,
      is_secret_candidate: true, title: "Credentials",
      body: "aws_secret_access_key = REDACTED-IN-FIXTURE",
    },
    {
      artifact_id: "binary", normalized_document_id: null, decoded: false,
      is_secret_candidate: false,
    },
  ];
}

/** Two near-parallel vectors and one orthogonal, keyed by a phrase in each title. */
function provider(configuration: EmbeddingModelConfiguration): StaticEmbeddingProvider {
  return new StaticEmbeddingProvider(configuration, new Map([
    ["Temporal Assertion Persistence", [1, 0.9, 0.1, 0]],
    ["Durable Semantic Memory", [0.95, 1, 0.05, 0]],
    ["Credentials", [0, 0, 0, 1]],
  ]));
}

describe("the default", () => {
  it("is off, and says so in a report that carries no model", () => {
    const report = disabledEmbeddingReport();
    expect(report.enabled).toBe(false);
    expect(report.provider).toBeNull();
    expect(report.model_id).toBeNull();
    expect(report.embedded_artifact_count).toBe(0);
    expect(report.vector_digests).toEqual([]);
  });

  it("needs no configuration when embeddings are not enabled", () => {
    expect(() => assertEmbeddingConfiguration({
      embeddingsEnabled: false, allowRemoteEmbeddings: false,
    })).not.toThrow();
  });
});

describe("the configuration guard", () => {
  it("refuses embeddings with no provider, and names the flag that fixes it", () => {
    expect(() => assertEmbeddingConfiguration({
      embeddingsEnabled: true, allowRemoteEmbeddings: false,
    })).toThrow(/--embedding-provider/);
  });

  it("refuses a remote provider without the separate remote opt-in", () => {
    expect(() => assertEmbeddingConfiguration({
      embeddingsEnabled: true, allowRemoteEmbeddings: false, configuration: REMOTE,
    })).toThrow(EmbeddingConfigurationError);
    expect(() => assertEmbeddingConfiguration({
      embeddingsEnabled: true, allowRemoteEmbeddings: false, configuration: REMOTE,
    })).toThrow(/--allow-remote-embeddings/);
  });

  it("accepts the same remote provider once the operator opts in", () => {
    expect(() => assertEmbeddingConfiguration({
      embeddingsEnabled: true, allowRemoteEmbeddings: true, configuration: REMOTE,
    })).not.toThrow();
  });

  it("refuses a remote endpoint that is not https", () => {
    expect(() => assertEmbeddingConfiguration({
      embeddingsEnabled: true,
      allowRemoteEmbeddings: true,
      configuration: { ...REMOTE, endpoint: "http://embeddings.example.com/v1" },
    })).toThrow(/https:\/\//);
  });

  it("lets a local provider run without the remote flag, because nothing leaves", () => {
    expect(() => assertEmbeddingConfiguration({
      embeddingsEnabled: true, allowRemoteEmbeddings: false, configuration: LOCAL,
    })).not.toThrow();
  });
});

describe("what gets embedded", () => {
  it("never embeds a secret-candidate document, and counts the refusal", async () => {
    const result = await runEmbeddings({
      documents: documents(), provider: provider(LOCAL),
      pairThreshold: DEFAULT_EMBEDDING_PAIR_THRESHOLD,
    });
    expect(result.report.secret_candidates_skipped).toBe(1);
    const embedded = new Set(result.report.vector_digests.map((entry) => entry.artifact_id));
    expect(embedded.has("secret")).toBe(false);
    for (const pair of result.pairs) {
      expect(pair.artifact_a_id).not.toBe("secret");
      expect(pair.artifact_b_id).not.toBe("secret");
    }
  });

  it("skips an artifact no decoder opened", async () => {
    const result = await runEmbeddings({
      documents: documents(), provider: provider(LOCAL),
      pairThreshold: DEFAULT_EMBEDDING_PAIR_THRESHOLD,
    });
    const embedded = new Set(result.report.vector_digests.map((entry) => entry.artifact_id));
    expect(embedded.has("binary")).toBe(false);
    // Eligibility is "there was text to embed and it was allowed to be sent".
    // The undecoded artifact fails the first half and the secret-candidate one
    // fails the second, so two of the four documents are eligible and the
    // refusal is counted where it means something rather than absorbed here.
    expect(result.report.eligible_artifact_count).toBe(2);
    expect(result.report.secret_candidates_skipped).toBe(1);
    expect(result.report.embedded_artifact_count).toBe(2);
  });

  it("reports what was sent, without sending a path or any content", async () => {
    const result = await runEmbeddings({
      documents: documents(), provider: provider(LOCAL),
      pairThreshold: DEFAULT_EMBEDDING_PAIR_THRESHOLD,
    });
    expect(result.report.artifact_count_sent).toBe(2);
    expect(result.report.chunk_count_sent).toBeGreaterThan(0);

    const rendered = JSON.stringify(result.report);
    expect(rendered).not.toContain("aws_secret_access_key");
    expect(rendered).not.toContain("/");
  });

  it("puts vector digests in the report and never a raw vector", async () => {
    const result = await runEmbeddings({
      documents: documents(), provider: provider(LOCAL),
      pairThreshold: DEFAULT_EMBEDDING_PAIR_THRESHOLD,
    });
    for (const entry of result.report.vector_digests) {
      expect(entry.vector_digest).toMatch(/^vector:[0-9a-f]{16,}$/);
    }
    // A raw vector is an array of numbers; nothing in the report is one.
    const rendered = JSON.stringify(result.report);
    expect(rendered).not.toMatch(/\[\s*-?\d+\.\d+\s*,/);
  });
});

describe("similarity", () => {
  it("finds the paraphrase pair the lexical layer misses", async () => {
    const result = await runEmbeddings({
      documents: documents(), provider: provider(LOCAL),
      pairThreshold: DEFAULT_EMBEDDING_PAIR_THRESHOLD,
    });
    const pair = result.pairs.find(
      (entry) => entry.artifact_a_id === "a" && entry.artifact_b_id === "b",
    );
    expect(pair).toBeDefined();
    expect(pair!.score).toBeGreaterThan(DEFAULT_EMBEDDING_PAIR_THRESHOLD);
  });

  it("is bounded, rounded, and zero for a vector with no magnitude", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    expect(String(cosineSimilarity([1, 2], [2, 1])).split(".")[1]?.length ?? 0)
      .toBeLessThanOrEqual(6);
  });
});

describe("chunking", () => {
  it("is bounded and deterministic", () => {
    const body = "sentence. ".repeat(5_000);
    const first = chunkDocument({ artifactId: "a", normalizedDocumentId: "normdoc:a", body });
    const second = chunkDocument({ artifactId: "a", normalizedDocumentId: "normdoc:a", body });
    expect(first.length).toBeLessThanOrEqual(MAX_CHUNKS_PER_DOCUMENT);
    expect(second.map((chunk) => chunk.text)).toEqual(first.map((chunk) => chunk.text));
  });

  it("keeps artifact identity and a block id on every chunk", () => {
    const chunks = chunkDocument({
      artifactId: "a", normalizedDocumentId: "normdoc:a",
      title: "Title", headings: ["One", "Two"], body: "body text",
    });
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.artifact_id).toBe("a");
      expect(chunk.normalized_document_id).toBe("normdoc:a");
      expect(chunk.block_id).toBe(`normdoc:a#${chunk.block_index}`);
    }
  });

  it("produces nothing for a document with no text", () => {
    expect(chunkDocument({ artifactId: "a", normalizedDocumentId: null })).toEqual([]);
  });
});

describe("the cache", () => {
  it("is keyed on the document and the model, not on where the file lives", () => {
    const identity = {
      provider: "p", model_id: "m", model_revision: null, dimension: 0, chunk_profile: "cp",
    };
    const left = embeddingCacheKey({
      normalizedDocumentId: "normdoc:x", artifactId: "one", chunkProfile: "cp", identity,
    });
    const right = embeddingCacheKey({
      normalizedDocumentId: "normdoc:x", artifactId: "two", chunkProfile: "cp", identity,
    });
    // Same document, two artifacts: one key, so a duplicate is embedded once.
    expect(right).toBe(left);

    const otherModel = embeddingCacheKey({
      normalizedDocumentId: "normdoc:x", artifactId: "one", chunkProfile: "cp",
      identity: { ...identity, model_id: "m2" },
    });
    expect(otherModel).not.toBe(left);
  });

  it("replays a run without calling the provider again", async () => {
    const store = new Map<string, number[]>();
    const cache: EmbeddingCache = {
      get: (key) => store.get(key),
      put: (key, vector) => { store.set(key, vector); },
    };

    let calls = 0;
    const counting = provider(LOCAL);
    const wrapped = {
      configuration: counting.configuration,
      embed: async (text: string) => { calls += 1; return counting.embed(text); },
    };

    const cold = await runEmbeddings({
      documents: documents(), provider: wrapped, cache,
      pairThreshold: DEFAULT_EMBEDDING_PAIR_THRESHOLD,
    });
    const coldCalls = calls;
    expect(coldCalls).toBeGreaterThan(0);

    const warm = await runEmbeddings({
      documents: documents(), provider: wrapped, cache,
      pairThreshold: DEFAULT_EMBEDDING_PAIR_THRESHOLD,
    });
    expect(calls).toBe(coldCalls);
    expect(warm.report.cache_hits).toBe(2);
    expect(warm.pairs).toEqual(cold.pairs);
  });
});

describe("reproducibility", () => {
  it("is claimed only for a pinned local model", () => {
    expect(reproducibilityClassOf(LOCAL)).toBe("reproducible_when_runtime_pinned");
    expect(reproducibilityClassOf(REMOTE)).toBe("provider_bound");
  });

  it("records a digest of every returned vector, so a replay can be checked", async () => {
    const result = await runEmbeddings({
      documents: documents(), provider: provider(REMOTE),
      pairThreshold: DEFAULT_EMBEDDING_PAIR_THRESHOLD,
    });
    expect(result.report.reproducibility_class).toBe("provider_bound");
    expect(result.report.remote).toBe(true);
    expect(result.report.vector_digests).toHaveLength(2);
    expect(vectorDigest([1, 0.9, 0.1, 0])).toBe(vectorDigest([1, 0.9, 0.1, 0]));
    expect(vectorDigest([1, 0.9, 0.1, 0])).not.toBe(vectorDigest([1, 0.9, 0.1, 0.5]));
  });
});

describe("a failing or malformed provider stops the pass", () => {
  /** A provider whose answers, delays and failures are scripted per call. */
  class ScriptedProvider {
    readonly configuration = LOCAL;
    readonly calls: { text: string; at: number }[] = [];
    constructor(
      private readonly answer: (text: string, call: number) => Promise<{ vector: number[]; observed_model_revision?: string }>,
    ) {}
    async embed(text: string) {
      this.calls.push({ text, at: Date.now() });
      const { vector, observed_model_revision } = await this.answer(text, this.calls.length);
      return {
        vector,
        provider_metadata: {},
        ...(observed_model_revision !== undefined ? { observed_model_revision } : {}),
      };
    }
  }
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const doc = (id: string, body: string): EmbeddableDocument => ({
    artifact_id: id, normalized_document_id: `normdoc:${id}`, decoded: true,
    is_secret_candidate: false, title: id, body,
  });
  const numbered = (count: number): EmbeddableDocument[] =>
    Array.from({ length: count }, (_, i) => doc(`doc-${String(i + 1).padStart(2, "0")}`, `body ${i}`));

  it("REG-WU-051-RC-080-a: a failure at width 4 starts no further request and rejects once workers settle", async () => {
    let failedAt = Number.POSITIVE_INFINITY;
    const failure = new Error("provider refused doc-03");
    const scripted = new ScriptedProvider(async (text) => {
      await delay(10);
      if (text.startsWith("doc-03")) {
        failedAt = Date.now();
        throw failure;
      }
      return { vector: [1, 0, 0] };
    });
    await expect(runEmbeddings({
      documents: numbered(20), provider: scripted, pairThreshold: 0.5, maxParallelRequests: 4,
    })).rejects.toBe(failure);
    const callsAtRejection = scripted.calls.length;
    // Give any stray worker time to show itself.
    await delay(60);
    expect(scripted.calls.length).toBe(callsAtRejection);
    expect(scripted.calls.filter((call) => call.at > failedAt)).toHaveLength(0);
    // doc-03 is the third document; at most `width` were in flight beside it.
    expect(scripted.calls.length).toBeLessThanOrEqual(3 + 4);
  });

  it("REG-WU-051-RC-080-b: at width 1 the calls stop at the failing document", async () => {
    const scripted = new ScriptedProvider(async (text) => {
      if (text.startsWith("doc-03")) throw new Error("refused");
      return { vector: [1, 0, 0] };
    });
    await expect(runEmbeddings({
      documents: numbered(20), provider: scripted, pairThreshold: 0.5, maxParallelRequests: 1,
    })).rejects.toThrow("refused");
    expect(scripted.calls.map((call) => call.text.slice(0, 6))).toEqual(["doc-01", "doc-02", "doc-03"]);
  });

  it("REG-WU-051-RC-080-c: a successful pass says the same thing at width 1 and width 8", async () => {
    const answer = async (text: string) => ({
      vector: [text.length % 7, (text.length * 3) % 5, 1],
    });
    const one = await runEmbeddings({
      documents: numbered(12), provider: new ScriptedProvider(answer), pairThreshold: 0.1, maxParallelRequests: 1,
    });
    const eight = await runEmbeddings({
      documents: numbered(12), provider: new ScriptedProvider(answer), pairThreshold: 0.1, maxParallelRequests: 8,
    });
    expect(JSON.stringify(eight)).toBe(JSON.stringify(one));
  });

  it("REG-WU-051-RC-080-d: another worker mid-document sends no further chunk after a failure", async () => {
    // Long enough for several chunks; every chunk carries its document's word.
    const long = (word: string) => Array.from({ length: 600 }, () => word).join(" ");
    let failedAt = Number.POSITIVE_INFINITY;
    let alphaCalls = 0;
    const scripted = new ScriptedProvider(async (text) => {
      if (text.includes("alphaword")) {
        alphaCalls += 1;
        await delay(5);
        if (alphaCalls === 2) {
          failedAt = Date.now();
          throw new Error("second chunk refused");
        }
        return { vector: [1, 0] };
      }
      await delay(25);
      return { vector: [0, 1] };
    });
    await expect(runEmbeddings({
      documents: [doc("a-doc", long("alphaword")), doc("b-doc", long("betaword"))],
      provider: scripted, pairThreshold: 0.5, maxParallelRequests: 2,
    })).rejects.toThrow("second chunk refused");
    await delay(60);
    const betaAfter = scripted.calls.filter(
      (call) => call.text.includes("betaword") && call.at > failedAt,
    );
    expect(betaAfter).toHaveLength(0);
    expect(scripted.calls.filter((call) => call.text.includes("betaword")).length).toBe(1);
  });

  it("REG-WU-051-RC-084-a: documents answered in different dimensions fail the pass by name", async () => {
    const scripted = new ScriptedProvider(async (text) => ({
      vector: text.startsWith("doc-01") ? [1, 0, 0] : [1, 0],
    }));
    await expect(runEmbeddings({
      documents: numbered(2), provider: scripted, pairThreshold: 0.5,
    })).rejects.toThrow(/dimension/);
  });

  it("REG-WU-051-RC-084-b: one document's chunks in mixed dimensions fail rather than average", async () => {
    const long = Array.from({ length: 600 }, () => "word").join(" ");
    const scripted = new ScriptedProvider(async (_text, call) => ({
      vector: call === 1 ? [1, 0, 0] : [0, 1],
    }));
    await expect(runEmbeddings({
      documents: [doc("mixed", long)], provider: scripted, pairThreshold: 0.5,
    })).rejects.toThrow(/dimension/);
  });

  it("REG-WU-051-RC-084-b: a non-finite or mismatched cached vector is refused too", async () => {
    const scripted = new ScriptedProvider(async () => ({ vector: [Number.NaN, 1, 0] }));
    await expect(runEmbeddings({
      documents: numbered(1), provider: scripted, pairThreshold: 0.5,
    })).rejects.toThrow(/non-finite/);

    const cache: EmbeddingCache = {
      get: (key) => (key.length > 0 ? [1, 0] : undefined),
      put: () => undefined,
    };
    let second = 0;
    const cachedThenFresh: EmbeddingCache = {
      get: () => (second++ === 0 ? [1, 0, 0] : [1, 0]),
      put: () => undefined,
    };
    await expect(runEmbeddings({
      documents: numbered(2), provider: new ScriptedProvider(async () => ({ vector: [1, 0, 0] })),
      cache: cachedThenFresh, pairThreshold: 0.5,
    })).rejects.toThrow(/dimension/);
    // A consistent cache still replays.
    await expect(runEmbeddings({
      documents: numbered(2), provider: new ScriptedProvider(async () => ({ vector: [1, 0] })),
      cache, pairThreshold: 0.5,
    })).resolves.toBeDefined();
  });

  it("REG-WU-051-RC-084-c: cosine of huge vectors stays finite", () => {
    expect(cosineSimilarity([1e200, 1e200], [1e200, 1e200])).toBe(1);
    expect(cosineSimilarity([1e200, 0], [0, 1e200])).toBe(0);
    expect(Number.isNaN(cosineSimilarity([1e308, 1e308], [-1e308, -1e308]))).toBe(false);
    expect(cosineSimilarity([1e308, 1e308], [-1e308, -1e308])).toBe(-1);
  });

  it("REG-WU-051-RC-084-d: a zero-magnitude vector still scores 0", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("REG-WU-051-RC-085-c: the configured revision stays the identity; an observed one is recorded beside it", async () => {
    const configured = new ScriptedProvider(async () => ({ vector: [1, 0], observed_model_revision: "r2" }));
    Object.assign(configured, { configuration: { ...LOCAL, model_revision: "r1" } });
    const run = await runEmbeddings({ documents: numbered(2), provider: configured, pairThreshold: 0.5 });
    expect(run.report.model_revision).toBe("r1");
    expect(run.report.reported_model_revision).toBe("r2");
  });

  it("REG-WU-051-RC-085-c: answers disagreeing on the revision within one pass fail it", async () => {
    const scripted = new ScriptedProvider(async (_text, call) => ({
      vector: [1, 0], observed_model_revision: call === 1 ? "r2" : "r3",
    }));
    await expect(runEmbeddings({
      documents: numbered(2), provider: scripted, pairThreshold: 0.5,
    })).rejects.toThrow(/more than one model revision/);
  });

  it("REG-WU-051-RC-085-d: a disabled pass reports no observed revision", () => {
    expect(disabledEmbeddingReport().reported_model_revision).toBeNull();
  });
});
