// corpus_embedding_http.ts — the one provider this package can actually run.
//
// `corpus_embeddings.ts` defines what a provider is. Until this file existed the
// only implementation was a fixture that returned vectors it had been handed,
// and the CLI refused `--embeddings` outright — which meant the whole embedding
// path was an interface with a note attached, and an operator with a model
// server running on their own machine had no way to point this at it.
//
// This provider speaks the shape those servers already speak: an HTTP POST
// carrying JSON, a JSON body back with a vector in it. It is deliberately not
// specific to one vendor. Four response shapes are accepted because the servers
// people actually run emit four shapes, and rejecting three of them would have
// made this a provider for one product rather than a provider for the protocol.
//
// The containment rules from `corpus_embeddings.ts` are enforced here as
// mechanism rather than restated as documentation:
//
//   - `local` means local. The endpoint must resolve to a loopback literal, and
//     a `local` provider pointed at a public host is refused before any request
//     is made. "Local" that quietly posts a disk's contents to a datacentre is
//     the exact failure the locality flag exists to prevent.
//   - Redirects are errors, never followed. A loopback server answering 302 with
//     a public Location would otherwise turn a local run into a remote one after
//     the operator's decision had already been taken.
//   - A credential comes from the environment and never from a flag, so it does
//     not land in a shell history or a process listing, and it is never recorded
//     in a report. Over cleartext it is refused outright.
//   - The response is read under a hard byte cap, so a server that answers with
//     an endless stream fails instead of exhausting the process.
//
// What this file does NOT do is decide anything about the vectors. It returns
// numbers. Whether a cosine between two of them means anything is settled in
// `corpus_fusion.ts`, and the answer there is still "it is a candidate".
import { EmbeddingModelConfiguration, EmbeddingProvider, EmbeddingResult } from "./corpus_embeddings";
import { compareCodePoints } from "./ordering";

/** The provider name an operator passes to `--embedding-provider`. */
export const HTTP_JSON_PROVIDER = "http-json";

/** Environment variable carrying the bearer token, when the server wants one. */
export const HTTP_JSON_TOKEN_ENV = "L9_EMBEDDING_BEARER_TOKEN";

/** Defaults chosen to fail rather than hang, and to fail rather than swallow. */
export const DEFAULT_EMBEDDING_TIMEOUT_MS = 30_000;
export const DEFAULT_EMBEDDING_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class EmbeddingProviderError extends Error {}

/**
 * Hosts a `local` provider may talk to.
 *
 * Literals only, and no name resolution: a hostname that resolves to 127.0.0.1
 * today can resolve elsewhere tomorrow, and a containment guarantee that depends
 * on a DNS answer is not a guarantee. `localhost` is admitted as the one name
 * every platform pins, and even that is a concession rather than a principle.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/** Whether this URL's host is a loopback literal. */
export function isLoopbackEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  // The whole 127.0.0.0/8 block is loopback, not only the canonical address.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

export interface HttpJsonProviderOptions {
  /** Where to POST. `http://` is permitted only for a loopback `local` provider. */
  endpoint: string;
  /** Sent as `model` in the request body, and recorded as the model identity. */
  modelId: string;
  /** `local` refuses a non-loopback endpoint; `remote` requires https. */
  locality: "local" | "remote";
  /** Recorded when the operator knows it; the server may also report one. */
  modelRevision?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /**
   * Bearer token. Defaults to `process.env[HTTP_JSON_TOKEN_ENV]`.
   *
   * Injectable so a test can supply one without touching the environment, not so
   * a caller can pass one from a command line.
   */
  token?: string | undefined;
  /** Injection seam for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Pull a vector out of whatever shape the server answered with.
 *
 * Four shapes, in the order a reader should think about them: the flat one, the
 * OpenAI-style envelope, a batch of one, and the bare array. Anything else is an
 * error naming what was received, because a provider that silently returned an
 * empty vector for an unrecognized shape would report a successful run that
 * embedded nothing.
 */
export function extractVector(payload: unknown): number[] {
  const asVector = (value: unknown): number[] | null => {
    if (!Array.isArray(value) || value.length === 0) return null;
    const numbers: number[] = [];
    for (const entry of value) {
      if (typeof entry !== "number" || !Number.isFinite(entry)) return null;
      numbers.push(entry);
    }
    return numbers;
  };

  const direct = asVector(payload);
  if (direct !== null) return direct;

  if (payload === null || typeof payload !== "object") {
    throw new EmbeddingProviderError(
      `embedding response is ${payload === null ? "null" : typeof payload}, not an object or an array`,
    );
  }
  const record = payload as Record<string, unknown>;

  for (const key of ["embedding", "vector"]) {
    const value = asVector(record[key]);
    if (value !== null) return value;
  }

  // `{"data":[{"embedding":[...]}]}` — the shape most servers copied.
  const data = record.data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (first !== null && typeof first === "object") {
      const value = asVector((first as Record<string, unknown>).embedding);
      if (value !== null) return value;
    }
    const bare = asVector(first);
    if (bare !== null) return bare;
  }

  // `{"embeddings":[[...]]}` — a batch endpoint answering a batch of one.
  const embeddings = record.embeddings;
  if (Array.isArray(embeddings) && embeddings.length > 0) {
    const value = asVector(embeddings[0]);
    if (value !== null) return value;
  }

  throw new EmbeddingProviderError(
    `embedding response carries no numeric vector; keys were [${Object.keys(record).sort(compareCodePoints).join(", ")}]`,
  );
}

/** The model revision the server reported, when it reported one. */
function extractRevision(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["model_revision", "model_version", "model"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Read a response body under a hard cap, so an endless stream fails fast. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    throw new EmbeddingProviderError(
      `embedding response declares ${declared} bytes, over the ${maxBytes}-byte cap`,
    );
  }
  const body = response.body;
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done === true) break;
    const value = step.value as Uint8Array;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new EmbeddingProviderError(
        `embedding response exceeded the ${maxBytes}-byte cap`,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

/**
 * A provider that POSTs `{model, input}` and reads a vector back.
 *
 * Construction is where the containment decisions are enforced, so a
 * misconfiguration fails before a single document has been read, rather than
 * after the scan has already opened the disk.
 */
export class HttpJsonEmbeddingProvider implements EmbeddingProvider {
  readonly configuration: EmbeddingModelConfiguration;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  /** The revision the server reported, learned from the first answer. */
  private observedRevision: string | null = null;

  constructor(options: HttpJsonProviderOptions) {
    const endpoint = options.endpoint.trim();
    if (endpoint.length === 0) {
      throw new EmbeddingProviderError("http-json provider needs an endpoint");
    }
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new EmbeddingProviderError(`http-json endpoint is not a URL: '${endpoint}'`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new EmbeddingProviderError(
        `http-json endpoint must be http:// or https://, got '${url.protocol}'`,
      );
    }
    if (options.locality === "local" && !isLoopbackEndpoint(endpoint)) {
      throw new EmbeddingProviderError(
        `--embedding-locality local requires a loopback endpoint; '${url.host}' is not one. `
        + "A local provider that posts document text to another host is a remote provider, "
        + "and this one is declared remote or not used",
      );
    }
    if (options.locality === "remote" && url.protocol !== "https:") {
      throw new EmbeddingProviderError(
        `a remote http-json provider must use https://, got '${url.protocol}'`,
      );
    }

    const token = options.token === undefined
      ? process.env[HTTP_JSON_TOKEN_ENV]
      : options.token;
    if (token !== undefined && token.length > 0 && url.protocol !== "https:") {
      // Loopback or not: a bearer over cleartext is a credential on the wire.
      throw new EmbeddingProviderError(
        `refusing to send the ${HTTP_JSON_TOKEN_ENV} bearer over a cleartext endpoint`,
      );
    }

    const modelId = options.modelId.trim();
    if (modelId.length === 0) {
      throw new EmbeddingProviderError("http-json provider needs a model id");
    }

    this.endpoint = endpoint;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_EMBEDDING_MAX_RESPONSE_BYTES;
    this.token = token !== undefined && token.length > 0 ? token : undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.configuration = {
      provider: HTTP_JSON_PROVIDER,
      model_id: modelId,
      locality: options.locality,
      ...(options.modelRevision !== undefined ? { model_revision: options.modelRevision } : {}),
      endpoint,
    };
  }

  /** The revision the server reported, if the operator did not supply one. */
  get reportedRevision(): string | null {
    return this.configuration.model_revision ?? this.observedRevision;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(this.token !== undefined ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ model: this.configuration.model_id, input: text }),
        signal: controller.signal,
        // Never followed. A 302 to a public host would turn an operator's local
        // decision into a remote transfer after the fact.
        redirect: "error",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new EmbeddingProviderError(
        aborted
          ? `embedding request timed out after ${this.timeoutMs}ms`
          : `embedding request failed: ${message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // A short excerpt, so a 400 naming the wrong model is diagnosable, and no
      // more, so a server echoing the submitted text does not land in a log.
      let excerpt = "";
      try {
        excerpt = (await readCapped(response, 2_048)).slice(0, 200).replace(/\s+/g, " ").trim();
      } catch {
        excerpt = "";
      }
      throw new EmbeddingProviderError(
        `embedding endpoint answered ${response.status}${excerpt.length > 0 ? `: ${excerpt}` : ""}`,
      );
    }

    const raw = await readCapped(response, this.maxResponseBytes);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      throw new EmbeddingProviderError(
        `embedding response is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const vector = extractVector(payload);
    const revision = extractRevision(payload);
    if (revision !== null) this.observedRevision = revision;

    return {
      vector,
      // Metadata, not content: what answered and how, never what was sent.
      provider_metadata: {
        endpoint_host: new URL(this.endpoint).host,
        locality: this.configuration.locality,
        ...(revision !== null ? { reported_model: revision } : {}),
      },
    };
  }
}
