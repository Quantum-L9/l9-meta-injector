import { getAdapter, setAdapter, resetAdapter, localAdapter, makeOpenAIAdapter } from "../src/llm";

afterEach(() => resetAdapter());

// Behavior: the default (local) adapter has no classify function, which means
// reconcileFieldsAsync falls back to the sync content-size heuristic. This is
// the no-external-call contract relied on by all non-LLM pipeline paths.
test("default adapter has no classify — sync reconcile path is used", () => {
  expect(getAdapter().classify).toBeUndefined();
});

test("estimateTokens is proportional to text length", () => {
  const short = getAdapter().estimateTokens("hi");
  const longer = getAdapter().estimateTokens("hello world this is a longer sentence with more tokens");
  expect(longer).toBeGreaterThan(short);
});

test("estimateTokens never returns zero for any input", () => {
  expect(getAdapter().estimateTokens("")).toBeGreaterThan(0);
  expect(getAdapter().estimateTokens("x")).toBeGreaterThan(0);
});

test("setAdapter replaces active adapter", () => {
  const mock = { estimateTokens: () => 1, classify: async () => "ok" };
  setAdapter(mock);
  expect(getAdapter()).toBe(mock);
});

test("resetAdapter restores localAdapter and removes classify", () => {
  setAdapter({ estimateTokens: () => 9, classify: async () => "x" });
  resetAdapter();
  expect(getAdapter()).toBe(localAdapter);
  expect(getAdapter().classify).toBeUndefined();
});

test("makeOpenAIAdapter returns an adapter with a classify function", () => {
  const a = makeOpenAIAdapter({ baseUrl: "http://localhost", apiKey: "k", model: "m" });
  expect(typeof a.classify).toBe("function");
});

test("makeOpenAIAdapter.classify returns null when fetch throws (network error)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network error"); };
  try {
    const a = makeOpenAIAdapter({ baseUrl: "http://localhost:0", apiKey: "k", model: "m" });
    const result = await a.classify!("test prompt");
    expect(result).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 5000);

test("makeOpenAIAdapter.classify returns null on non-OK HTTP response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) } as Response);
  try {
    const a = makeOpenAIAdapter({ baseUrl: "http://localhost:0", apiKey: "k", model: "m" });
    expect(await a.classify!("test prompt")).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("makeOpenAIAdapter.classify sends max_tokens+temperature for non-reasoning models", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse((init as RequestInit).body as string);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }) } as unknown as Response;
  };
  try {
    const a = makeOpenAIAdapter({ baseUrl: "https://localhost", apiKey: "k", model: "gpt-4o-mini" });
    await a.classify!("test prompt");
    expect(capturedBody).toMatchObject({ model: "gpt-4o-mini", max_tokens: 80, temperature: 0 });
    expect(capturedBody).not.toHaveProperty("max_completion_tokens");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Regression: gpt-5/o-series ("reasoning") models reject max_tokens/temperature
// with a 400 unsupported_parameter error and require max_completion_tokens
// instead (discovered via a live self-test run against gpt-5-nano).
test("makeOpenAIAdapter.classify sends max_completion_tokens (no temperature) for gpt-5/o-series models", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse((init as RequestInit).body as string);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }) } as unknown as Response;
  };
  try {
    for (const model of ["gpt-5-nano", "gpt-5", "gpt-5-mini", "o1", "o3-mini", "o4-mini"]) {
      capturedBody = null;
      const a = makeOpenAIAdapter({ baseUrl: "https://localhost", apiKey: "k", model });
      await a.classify!("test prompt");
      expect(capturedBody).toMatchObject({ model, max_completion_tokens: 80 });
      expect(capturedBody).not.toHaveProperty("max_tokens");
      expect(capturedBody).not.toHaveProperty("temperature");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("makeOpenAIAdapter.classify returns null when response has no choices", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [] }),
  } as unknown as Response);
  try {
    const a = makeOpenAIAdapter({ baseUrl: "http://localhost:0", apiKey: "k", model: "m" });
    expect(await a.classify!("test prompt")).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
