"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpJsonEmbeddingProvider = exports.EmbeddingProviderError = exports.DEFAULT_EMBEDDING_MAX_RESPONSE_BYTES = exports.DEFAULT_EMBEDDING_TIMEOUT_MS = exports.HTTP_JSON_TOKEN_ENV = exports.HTTP_JSON_PROVIDER = void 0;
exports.isLoopbackEndpoint = isLoopbackEndpoint;
exports.extractVector = extractVector;
/** The provider name an operator passes to `--embedding-provider`. */
exports.HTTP_JSON_PROVIDER = "http-json";
/** Environment variable carrying the bearer token, when the server wants one. */
exports.HTTP_JSON_TOKEN_ENV = "L9_EMBEDDING_BEARER_TOKEN";
/** Defaults chosen to fail rather than hang, and to fail rather than swallow. */
exports.DEFAULT_EMBEDDING_TIMEOUT_MS = 30000;
exports.DEFAULT_EMBEDDING_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
class EmbeddingProviderError extends Error {
}
exports.EmbeddingProviderError = EmbeddingProviderError;
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
function isLoopbackEndpoint(endpoint) {
    let url;
    try {
        url = new URL(endpoint);
    }
    catch {
        return false;
    }
    const host = url.hostname.toLowerCase();
    if (LOOPBACK_HOSTS.has(host))
        return true;
    // The whole 127.0.0.0/8 block is loopback, not only the canonical address.
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
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
function extractVector(payload) {
    const asVector = (value) => {
        if (!Array.isArray(value) || value.length === 0)
            return null;
        const numbers = [];
        for (const entry of value) {
            if (typeof entry !== "number" || !Number.isFinite(entry))
                return null;
            numbers.push(entry);
        }
        return numbers;
    };
    const direct = asVector(payload);
    if (direct !== null)
        return direct;
    if (payload === null || typeof payload !== "object") {
        throw new EmbeddingProviderError(`embedding response is ${payload === null ? "null" : typeof payload}, not an object or an array`);
    }
    const record = payload;
    for (const key of ["embedding", "vector"]) {
        const value = asVector(record[key]);
        if (value !== null)
            return value;
    }
    // `{"data":[{"embedding":[...]}]}` — the shape most servers copied.
    const data = record.data;
    if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        if (first !== null && typeof first === "object") {
            const value = asVector(first.embedding);
            if (value !== null)
                return value;
        }
        const bare = asVector(first);
        if (bare !== null)
            return bare;
    }
    // `{"embeddings":[[...]]}` — a batch endpoint answering a batch of one.
    const embeddings = record.embeddings;
    if (Array.isArray(embeddings) && embeddings.length > 0) {
        const value = asVector(embeddings[0]);
        if (value !== null)
            return value;
    }
    throw new EmbeddingProviderError(`embedding response carries no numeric vector; keys were [${Object.keys(record).sort().join(", ")}]`);
}
/** The model revision the server reported, when it reported one. */
function extractRevision(payload) {
    if (payload === null || typeof payload !== "object")
        return null;
    const record = payload;
    for (const key of ["model_revision", "model_version", "model"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim().length > 0)
            return value.trim();
    }
    return null;
}
/** Read a response body under a hard cap, so an endless stream fails fast. */
async function readCapped(response, maxBytes) {
    const declared = response.headers.get("content-length");
    if (declared !== null && Number(declared) > maxBytes) {
        throw new EmbeddingProviderError(`embedding response declares ${declared} bytes, over the ${maxBytes}-byte cap`);
    }
    const body = response.body;
    if (body === null)
        return "";
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const step = await reader.read();
        if (step.done === true)
            break;
        const value = step.value;
        total += value.length;
        if (total > maxBytes) {
            await reader.cancel();
            throw new EmbeddingProviderError(`embedding response exceeded the ${maxBytes}-byte cap`);
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
class HttpJsonEmbeddingProvider {
    constructor(options) {
        /** The revision the server reported, learned from the first answer. */
        this.observedRevision = null;
        const endpoint = options.endpoint.trim();
        if (endpoint.length === 0) {
            throw new EmbeddingProviderError("http-json provider needs an endpoint");
        }
        let url;
        try {
            url = new URL(endpoint);
        }
        catch {
            throw new EmbeddingProviderError(`http-json endpoint is not a URL: '${endpoint}'`);
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            throw new EmbeddingProviderError(`http-json endpoint must be http:// or https://, got '${url.protocol}'`);
        }
        if (options.locality === "local" && !isLoopbackEndpoint(endpoint)) {
            throw new EmbeddingProviderError(`--embedding-locality local requires a loopback endpoint; '${url.host}' is not one. `
                + "A local provider that posts document text to another host is a remote provider, "
                + "and this one is declared remote or not used");
        }
        if (options.locality === "remote" && url.protocol !== "https:") {
            throw new EmbeddingProviderError(`a remote http-json provider must use https://, got '${url.protocol}'`);
        }
        const token = options.token === undefined
            ? process.env[exports.HTTP_JSON_TOKEN_ENV]
            : options.token;
        if (token !== undefined && token.length > 0 && url.protocol !== "https:") {
            // Loopback or not: a bearer over cleartext is a credential on the wire.
            throw new EmbeddingProviderError(`refusing to send the ${exports.HTTP_JSON_TOKEN_ENV} bearer over a cleartext endpoint`);
        }
        const modelId = options.modelId.trim();
        if (modelId.length === 0) {
            throw new EmbeddingProviderError("http-json provider needs a model id");
        }
        this.endpoint = endpoint;
        this.timeoutMs = options.timeoutMs ?? exports.DEFAULT_EMBEDDING_TIMEOUT_MS;
        this.maxResponseBytes = options.maxResponseBytes ?? exports.DEFAULT_EMBEDDING_MAX_RESPONSE_BYTES;
        this.token = token !== undefined && token.length > 0 ? token : undefined;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.configuration = {
            provider: exports.HTTP_JSON_PROVIDER,
            model_id: modelId,
            locality: options.locality,
            ...(options.modelRevision !== undefined ? { model_revision: options.modelRevision } : {}),
            endpoint,
        };
    }
    /** The revision the server reported, if the operator did not supply one. */
    get reportedRevision() {
        return this.configuration.model_revision ?? this.observedRevision;
    }
    async embed(text) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let response;
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
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const aborted = error instanceof Error && error.name === "AbortError";
            throw new EmbeddingProviderError(aborted
                ? `embedding request timed out after ${this.timeoutMs}ms`
                : `embedding request failed: ${message}`);
        }
        finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            // A short excerpt, so a 400 naming the wrong model is diagnosable, and no
            // more, so a server echoing the submitted text does not land in a log.
            let excerpt = "";
            try {
                excerpt = (await readCapped(response, 2048)).slice(0, 200).replace(/\s+/g, " ").trim();
            }
            catch {
                excerpt = "";
            }
            throw new EmbeddingProviderError(`embedding endpoint answered ${response.status}${excerpt.length > 0 ? `: ${excerpt}` : ""}`);
        }
        const raw = await readCapped(response, this.maxResponseBytes);
        let payload;
        try {
            payload = JSON.parse(raw);
        }
        catch (error) {
            throw new EmbeddingProviderError(`embedding response is not JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        const vector = extractVector(payload);
        const revision = extractRevision(payload);
        if (revision !== null)
            this.observedRevision = revision;
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
exports.HttpJsonEmbeddingProvider = HttpJsonEmbeddingProvider;
//# sourceMappingURL=corpus_embedding_http.js.map