import { makeOpenAIAdapter, LlmDiagnostic } from "../src/llm";

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function adapterWithFetch(fetchImpl: typeof fetch) {
  global.fetch = fetchImpl as typeof fetch;
  const diags: LlmDiagnostic[] = [];
  const a = makeOpenAIAdapter({ baseUrl: "https://api.test", apiKey: "k", model: "m", onDiagnostic: (d) => diags.push(d) });
  return { a, diags };
}

test("ok outcome — returns content and reports ok (OBS-001)", async () => {
  const { a, diags } = adapterWithFetch(async () => ({
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content: "yes" } }] }),
  }) as unknown as Response);
  const out = await a.classify!("prompt");
  expect(out).toBe("yes");
  expect(diags).toHaveLength(1);
  expect(diags[0].outcome).toBe("ok");
  expect(diags[0].status).toBe(200);
});

test("http_error outcome — non-2xx yields null and a diagnostic with status+body", async () => {
  const { a, diags } = adapterWithFetch(async () => ({
    ok: false, status: 429,
    text: async () => "rate limited",
  }) as unknown as Response);
  const out = await a.classify!("prompt");
  expect(out).toBeNull();
  expect(diags[0].outcome).toBe("http_error");
  expect(diags[0].status).toBe(429);
  expect(diags[0].detail).toContain("rate limited");
});

test("parse_error outcome — malformed body yields null and is distinguished from a 'no'", async () => {
  const { a, diags } = adapterWithFetch(async () => ({
    ok: true, status: 200,
    json: async () => { throw new Error("Unexpected token"); },
  }) as unknown as Response);
  const out = await a.classify!("prompt");
  expect(out).toBeNull();
  expect(diags[0].outcome).toBe("parse_error");
});

test("timeout outcome — AbortError is reported as timeout", async () => {
  const { a, diags } = adapterWithFetch(async () => {
    const err = new Error("aborted"); err.name = "AbortError"; throw err;
  });
  const out = await a.classify!("prompt");
  expect(out).toBeNull();
  expect(diags[0].outcome).toBe("timeout");
});

test("network_error outcome — a generic throw is reported as network_error", async () => {
  const { a, diags } = adapterWithFetch(async () => { throw new Error("ECONNREFUSED"); });
  const out = await a.classify!("prompt");
  expect(out).toBeNull();
  expect(diags[0].outcome).toBe("network_error");
  expect(diags[0].detail).toContain("ECONNREFUSED");
});

test("every diagnostic carries a duration", async () => {
  const { a, diags } = adapterWithFetch(async () => ({
    ok: true, status: 200, json: async () => ({ choices: [] }),
  }) as unknown as Response);
  await a.classify!("prompt");
  expect(typeof diags[0].durationMs).toBe("number");
  expect(diags[0].durationMs).toBeGreaterThanOrEqual(0);
});
