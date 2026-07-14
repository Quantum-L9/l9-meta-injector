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
