// corpus_embedding_http.test.ts — a real server, a real socket, a real vector.
//
// The provider interface was previously qualified against a fixture that handed
// back vectors it had been given. That proves the arithmetic downstream and
// proves nothing about the provider, because the fixture never opened a socket.
// So every test here starts an HTTP server on the loopback interface, lets the
// provider find it by URL, and reads what actually came back over the wire.
//
// The containment rules get the same treatment. A `local` provider aimed at a
// public host, a redirect to another origin, a bearer over cleartext, a response
// that never ends: each is a real attempt against a real server, refused.
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  EmbeddingProviderError,
  HTTP_JSON_PROVIDER,
  HttpJsonEmbeddingProvider,
  extractVector,
  isLoopbackEndpoint,
} from "../src/corpus_embedding_http";
import { runCorpusScan } from "../src/corpus_scan";

const servers: http.Server[] = [];
const scratch: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-embed-"));
  scratch.push(dir);
  return dir;
}

/** Start a loopback server and return the URL it is actually listening on. */
async function serve(
  handler: (request: http.IncomingMessage, response: http.ServerResponse, body: string) => void,
): Promise<{ url: string; requests: { path: string; body: unknown; auth: string | undefined }[] }> {
  const requests: { path: string; body: unknown; auth: string | undefined }[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = body;
      }
      requests.push({
        path: request.url ?? "",
        body: parsed,
        auth: request.headers.authorization,
      });
      handler(request, response, body);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { url: `http://127.0.0.1:${address.port}/embed`, requests };
}

/**
 * A deterministic stand-in for a model, computed from the text it is given.
 *
 * Not a model and not pretending to be one: it hashes the words into a small
 * fixed basis so that texts sharing vocabulary come out close and texts that do
 * not come out far apart. That is exactly enough structure for a cosine to mean
 * something in a test, and deliberately not enough to be mistaken for recall.
 */
function toyVector(text: string, dimension = 16): number[] {
  const vector = new Array<number>(dimension).fill(0);
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)) {
    let hash = 0;
    for (const character of word) hash = (hash * 31 + character.charCodeAt(0)) % 100_003;
    vector[hash % dimension] = (vector[hash % dimension] as number) + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

describe("the http-json embedding provider", () => {
  it("posts the text and reads the vector back over a real socket", async () => {
    const { url, requests } = await serve((_request, response, body) => {
      const input = (JSON.parse(body) as { input: string }).input;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ model: "toy-v3", embedding: toyVector(input) }));
    });

    const provider = new HttpJsonEmbeddingProvider({
      endpoint: url, modelId: "toy", locality: "local",
    });
    const result = await provider.embed("content-addressed storage for an archive");

    expect(result.vector).toHaveLength(16);
    expect(result.vector.every((value) => Number.isFinite(value))).toBe(true);
    expect(provider.configuration.provider).toBe(HTTP_JSON_PROVIDER);
    expect(provider.configuration.locality).toBe("local");
    // The revision the server reported, learned rather than assumed.
    expect(result.provider_metadata.reported_model).toBe("toy-v3");
    expect(provider.reportedRevision).toBe("toy-v3");

    // What actually went over the wire: the model name and the text, and no
    // credential, because none was configured.
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({
      model: "toy",
      input: "content-addressed storage for an archive",
    });
    expect(requests[0]?.auth).toBeUndefined();
  });

  it("reads every response shape a real server emits", async () => {
    const shapes: Record<string, unknown> = {
      flat: { embedding: [1, 2, 3] },
      vector: { vector: [1, 2, 3] },
      openai: { data: [{ embedding: [1, 2, 3] }] },
      batch: { embeddings: [[1, 2, 3]] },
      bare: [1, 2, 3],
    };
    for (const [name, payload] of Object.entries(shapes)) {
      expect(extractVector(payload), name).toEqual([1, 2, 3]);
    }
  });

  it("refuses a response with no vector rather than returning an empty one", () => {
    // An empty vector would flow all the way to a cosine of zero and be reported
    // as a successful embedding that found nothing similar.
    expect(() => extractVector({ result: "ok" })).toThrow(EmbeddingProviderError);
    expect(() => extractVector({ embedding: ["a", "b"] })).toThrow(EmbeddingProviderError);
    expect(() => extractVector({ embedding: [1, Number.NaN] })).toThrow(EmbeddingProviderError);
    expect(() => extractVector({ embedding: [] })).toThrow(EmbeddingProviderError);
    expect(() => extractVector(null)).toThrow(EmbeddingProviderError);
  });

  it("refuses a local provider aimed at a host that is not this machine", () => {
    expect(isLoopbackEndpoint("http://127.0.0.1:9000/embed")).toBe(true);
    expect(isLoopbackEndpoint("http://127.6.6.6:9000/embed")).toBe(true);
    expect(isLoopbackEndpoint("http://localhost:9000/embed")).toBe(true);
    expect(isLoopbackEndpoint("https://embeddings.example.com/v1")).toBe(false);
    // A name that merely contains a loopback literal is not a loopback host.
    expect(isLoopbackEndpoint("https://127.0.0.1.example.com/v1")).toBe(false);

    expect(() => new HttpJsonEmbeddingProvider({
      endpoint: "https://embeddings.example.com/v1", modelId: "m", locality: "local",
    })).toThrow(/loopback/);
  });

  it("requires https of a remote provider, and refuses a bearer over cleartext", () => {
    expect(() => new HttpJsonEmbeddingProvider({
      endpoint: "http://embeddings.example.com/v1", modelId: "m", locality: "remote",
    })).toThrow(/https/);

    expect(() => new HttpJsonEmbeddingProvider({
      endpoint: "http://127.0.0.1:9000/embed", modelId: "m", locality: "local", token: "secret",
    })).toThrow(/cleartext/);

    // And over https the same token is accepted.
    const provider = new HttpJsonEmbeddingProvider({
      endpoint: "https://127.0.0.1:9000/embed", modelId: "m", locality: "local", token: "secret",
    });
    expect(provider.configuration.endpoint).toBe("https://127.0.0.1:9000/embed");
  });

  it("never follows a redirect out of the origin the operator named", async () => {
    const { url } = await serve((_request, response) => {
      response.writeHead(302, { location: "https://elsewhere.example.com/collect" });
      response.end();
    });
    const provider = new HttpJsonEmbeddingProvider({
      endpoint: url, modelId: "toy", locality: "local",
    });
    // The failure is the point: a followed redirect would have posted the
    // document text to a host the operator never approved.
    await expect(provider.embed("some text")).rejects.toThrow(EmbeddingProviderError);
  });

  it("reports an error status instead of treating it as an empty vector", async () => {
    const { url } = await serve((_request, response) => {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unknown model 'toy'" }));
    });
    const provider = new HttpJsonEmbeddingProvider({
      endpoint: url, modelId: "toy", locality: "local",
    });
    await expect(provider.embed("text")).rejects.toThrow(/answered 400.*unknown model/);
  });

  it("stops reading a response that exceeds its cap", async () => {
    const { url } = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      // No content-length: the cap has to hold on the stream itself.
      response.write("[");
      for (let i = 0; i < 5_000; i += 1) response.write("1,");
      response.end("1]");
    });
    const provider = new HttpJsonEmbeddingProvider({
      endpoint: url, modelId: "toy", locality: "local", maxResponseBytes: 512,
    });
    await expect(provider.embed("text")).rejects.toThrow(/cap/);
  });

  it("sends the configured bearer, and only over https", async () => {
    const { url, requests } = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ embedding: [1, 0, 0] }));
    });
    // The loopback server is cleartext, so the constructor would refuse a token.
    // Declaring the endpoint as https and injecting a fetch that reaches the real
    // server is how the header can be observed without a TLS fixture.
    const provider = new HttpJsonEmbeddingProvider({
      endpoint: url.replace("http://", "https://"),
      modelId: "toy",
      locality: "local",
      token: "s3cret",
      fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) =>
        fetch(String(input).replace("https://", "http://"), init)) as typeof fetch,
    });
    await provider.embed("text");
    expect(requests[0]?.auth).toBe("Bearer s3cret");
  });
});

describe("a corpus scan with an embedding provider", () => {
  /** Two documents about one subject in different words, and one about neither. */
  function embeddingCorpus(): string {
    const root = tmp();
    fs.writeFileSync(
      path.join(root, "graph-memory.md"),
      "# Temporal knowledge graph\n\n"
      + "Persist temporal assertions in the knowledge graph so that a later query can "
      + "recover what was believed at a given moment. Assertions are versioned, never "
      + "overwritten, and every edge carries the interval it was valid over.\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "durable-facts.md"),
      "# Time-aware durable memory\n\n"
      + "Store time-aware facts in durable semantic memory so a later question can "
      + "recover what was believed at a given moment. Facts are versioned, never "
      + "overwritten, and every relation carries the interval it was valid over.\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "billing.md"),
      "# Invoice reconciliation\n\n"
      + "Match settled payments against outstanding invoices and raise a discrepancy "
      + "when the totals differ by more than the rounding tolerance.\n",
      "utf8",
    );
    // Never embedded, at any setting, and proven so below.
    fs.writeFileSync(
      path.join(root, "secrets.yaml"),
      "database:\n  password: hunter2-not-a-real-password\n",
      "utf8",
    );
    return root;
  }

  it("runs the pass end to end and reports what it sent", async () => {
    const { url, requests } = await serve((_request, response, body) => {
      const input = (JSON.parse(body) as { input: string }).input;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ model: "toy-v3", data: [{ embedding: toyVector(input, 24) }] }));
    });

    const result = await runCorpusScan({
      roots: [{ path: embeddingCorpus() }],
      producerVersion: "test",
      embeddingProvider: new HttpJsonEmbeddingProvider({
        endpoint: url, modelId: "toy", locality: "local",
      }),
      embeddingPairThreshold: 0.5,
    });

    const embeddings = result.coverage.embeddings;
    expect(embeddings.enabled).toBe(true);
    // Three documents had text to embed. The fourth is `secrets.yaml`, which was
    // refused for its name before a byte of it was read, so it is not eligible —
    // and it is still counted, below, where the count means something.
    expect(embeddings.embedded_count).toBe(3);
    expect(embeddings.eligible_count).toBe(3);
    expect(embeddings.provider_failure_count).toBe(0);
    // And the count of what was refused before it could be sent, carried in the
    // coverage document as well as in the embedding report, because this is the
    // document an operator reads to find out what left the machine.
    expect(embeddings.secret_skipped_count).toBe(1);
    expect(result.coverage.embedding_coverage_when_enabled).not.toBeNull();

    const report = result.semantic?.embeddingReport;
    expect(report?.provider).toBe(HTTP_JSON_PROVIDER);
    expect(report?.model_id).toBe("toy");
    expect(report?.dimension).toBe(24);
    expect(report?.remote).toBe(false);
    expect(report?.artifact_count_sent).toBe(3);
    expect(report?.chunk_count_sent).toBeGreaterThanOrEqual(3);
    expect(report?.secret_candidates_skipped).toBe(1);
    // Digests only. A raw vector never leaves the process.
    expect(report?.vector_digests).toHaveLength(3);
    for (const entry of report?.vector_digests ?? []) {
      expect(entry.vector_digest).toMatch(/^vector:[0-9a-f]{64}$/);
    }

    // The server saw the normalized text and never the secret document, never a
    // path, and never a whole file's raw bytes.
    expect(requests.length).toBeGreaterThanOrEqual(3);
    for (const request of requests) {
      const sent = JSON.stringify(request.body);
      expect(sent).not.toContain("hunter2");
      expect(sent).not.toContain(os.tmpdir());
    }
    const everythingSent = requests.map((r) => JSON.stringify(r.body)).join(" ");
    expect(everythingSent).toContain("temporal assertions");
  });

  it("finds the pair that shares a subject and not a vocabulary", async () => {
    const { url } = await serve((_request, response, body) => {
      const input = (JSON.parse(body) as { input: string }).input;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ embedding: toyVector(input, 24) }));
    });

    const result = await runCorpusScan({
      roots: [{ path: embeddingCorpus() }],
      producerVersion: "test",
      embeddingProvider: new HttpJsonEmbeddingProvider({
        endpoint: url, modelId: "toy", locality: "local",
      }),
      embeddingPairThreshold: 0.5,
    });

    // An embedding pair is a candidate and stays one: it appears as a signal on a
    // relation, and it never becomes a fact or a project.
    const pairs = result.semantic?.relations.pairs ?? [];
    const embeddingSignals = pairs.filter((pair) =>
      pair.signals.some((signal) => signal.kind === "embedding_similarity"));
    expect(embeddingSignals.length).toBeGreaterThan(0);
    for (const pair of embeddingSignals) {
      for (const signal of pair.signals) {
        if (signal.kind !== "embedding_similarity") continue;
        // Never a fact. Exact duplication is the one decidable signal in this
        // package, and a cosine is not it however high it goes.
        expect(signal.fact).toBe(false);
        expect(signal.method).toBe("cosine/v1");
        expect(signal.score).toBeGreaterThanOrEqual(0.5);
      }
    }
    // And no project candidate was created out of one: an embedding pair can
    // support a project a declared identifier already established, and cannot
    // establish one on its own.
    for (const candidate of result.candidates.project_candidates) {
      expect(candidate.identifier_is_declared).toBe(true);
    }
  });

  it("says the same thing at one worker as at eight", async () => {
    const { url } = await serve((_request, response, body) => {
      const input = (JSON.parse(body) as { input: string }).input;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ embedding: toyVector(input, 24) }));
    });
    const root = embeddingCorpus();
    const scan = async (workers: number): ReturnType<typeof runCorpusScan> => runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
      embeddingProvider: new HttpJsonEmbeddingProvider({
        endpoint: url, modelId: "toy", locality: "local",
      }),
      embeddingPairThreshold: 0.5,
      budgets: { max_parallel_embedding_requests: workers },
    });

    const sequential = await scan(1);
    const parallel = await scan(8);

    // The bound changes when requests are issued and nothing else. Vector
    // digests, the reported dimension and the pair list are all identical,
    // which is what makes raising it safe rather than merely faster.
    expect(parallel.semantic?.embeddingReport.vector_digests)
      .toEqual(sequential.semantic?.embeddingReport.vector_digests);
    expect(parallel.semantic?.embeddingReport.dimension)
      .toBe(sequential.semantic?.embeddingReport.dimension);
    expect(parallel.semantic?.embeddingReport.artifact_count_sent)
      .toBe(sequential.semantic?.embeddingReport.artifact_count_sent);
    expect(parallel.coverage.embeddings).toEqual(sequential.coverage.embeddings);
  });

  it("actually issues requests concurrently when allowed to", async () => {
    let inFlight = 0;
    let peak = 0;
    const { url } = await serve((_request, response, body) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const input = (JSON.parse(body) as { input: string }).input;
      // Held open briefly so overlap is observable rather than inferred.
      setTimeout(() => {
        inFlight -= 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ embedding: toyVector(input, 24) }));
      }, 25);
    });

    const root = tmp();
    for (let i = 0; i < 8; i += 1) {
      fs.writeFileSync(
        path.join(root, `note-${i}.md`),
        `# Note ${i}\n\nA short document about subject number ${i} and nothing else.\n`,
        "utf8",
      );
    }
    await runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
      embeddingProvider: new HttpJsonEmbeddingProvider({
        endpoint: url, modelId: "toy", locality: "local",
      }),
      budgets: { max_parallel_embedding_requests: 4 },
    });

    // The flag does something: more than one request was open at once, and never
    // more than the bound the operator set.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("stays sequential when the bound says one", async () => {
    let inFlight = 0;
    let peak = 0;
    const { url } = await serve((_request, response, body) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const input = (JSON.parse(body) as { input: string }).input;
      setTimeout(() => {
        inFlight -= 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ embedding: toyVector(input, 24) }));
      }, 5);
    });

    const root = tmp();
    for (let i = 0; i < 6; i += 1) {
      fs.writeFileSync(path.join(root, `note-${i}.md`), `# Note ${i}\n\nText ${i}.\n`, "utf8");
    }
    await runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
      embeddingProvider: new HttpJsonEmbeddingProvider({
        endpoint: url, modelId: "toy", locality: "local",
      }),
      budgets: { max_parallel_embedding_requests: 1 },
    });
    expect(peak).toBe(1);
  });

  it("fails the scan when the provider fails, rather than reporting embeddings off", async () => {
    const { url } = await serve((_request, response) => {
      response.writeHead(503);
      response.end("model server is restarting");
    });
    await expect(runCorpusScan({
      roots: [{ path: embeddingCorpus() }],
      producerVersion: "test",
      embeddingProvider: new HttpJsonEmbeddingProvider({
        endpoint: url, modelId: "toy", locality: "local",
      }),
    })).rejects.toThrow(/embedding pass failed.*503/);
  });

  it("changes the analysis identity, and not the source snapshot", async () => {
    const { url } = await serve((_request, response, body) => {
      const input = (JSON.parse(body) as { input: string }).input;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ embedding: toyVector(input, 24) }));
    });
    const root = embeddingCorpus();

    const without = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const with_ = await runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
      embeddingProvider: new HttpJsonEmbeddingProvider({
        endpoint: url, modelId: "toy", locality: "local",
      }),
    });

    // The bytes on the disk did not change, so the source snapshot must not.
    expect(with_.snapshot.corpus_source_snapshot_id)
      .toBe(without.snapshot.corpus_source_snapshot_id);
    // What was computed over them did, so the analysis identity must — and the
    // embedding profile is the field that carries the difference.
    expect(with_.snapshot.analysis.corpus_analysis_id)
      .not.toBe(without.snapshot.analysis.corpus_analysis_id);
    expect(without.snapshot.analysis.embedding_profile).toBeNull();
    expect(with_.snapshot.analysis.embedding_profile).not.toBeNull();
  });
});
