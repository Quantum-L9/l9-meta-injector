import { EmbeddingModelConfiguration, EmbeddingProvider, EmbeddingResult } from "./corpus_embeddings";
/** The provider name an operator passes to `--embedding-provider`. */
export declare const HTTP_JSON_PROVIDER = "http-json";
/** Environment variable carrying the bearer token, when the server wants one. */
export declare const HTTP_JSON_TOKEN_ENV = "L9_EMBEDDING_BEARER_TOKEN";
/** Defaults chosen to fail rather than hang, and to fail rather than swallow. */
export declare const DEFAULT_EMBEDDING_TIMEOUT_MS = 30000;
export declare const DEFAULT_EMBEDDING_MAX_RESPONSE_BYTES: number;
export declare class EmbeddingProviderError extends Error {
}
/** Whether this URL's host is a loopback literal. */
export declare function isLoopbackEndpoint(endpoint: string): boolean;
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
export declare function extractVector(payload: unknown): number[];
/**
 * A provider that POSTs `{model, input}` and reads a vector back.
 *
 * Construction is where the containment decisions are enforced, so a
 * misconfiguration fails before a single document has been read, rather than
 * after the scan has already opened the disk.
 */
export declare class HttpJsonEmbeddingProvider implements EmbeddingProvider {
    readonly configuration: EmbeddingModelConfiguration;
    private readonly endpoint;
    private readonly timeoutMs;
    private readonly maxResponseBytes;
    private readonly token;
    private readonly fetchImpl;
    /** The revision the server reported, learned from the first answer. */
    private observedRevision;
    constructor(options: HttpJsonProviderOptions);
    /** The revision the server reported, if the operator did not supply one. */
    get reportedRevision(): string | null;
    embed(text: string): Promise<EmbeddingResult>;
}
