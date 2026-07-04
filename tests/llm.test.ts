import { getAdapter, setAdapter, resetAdapter, localAdapter, makeOpenAIAdapter } from "../src/llm";

afterEach(() => resetAdapter());

test("default adapter has no classify", () => expect(getAdapter().classify).toBeUndefined());
test("estimateTokens basic", () => expect(getAdapter().estimateTokens("hello world")).toBeGreaterThan(0));
test("setAdapter replaces active", () => {
  const mock = { estimateTokens: () => 1, classify: async () => "ok" };
  setAdapter(mock);
  expect(getAdapter()).toBe(mock);
});
test("resetAdapter restores local", () => {
  setAdapter({ estimateTokens: () => 9, classify: async () => "x" });
  resetAdapter();
  expect(getAdapter()).toBe(localAdapter);
});
test("makeOpenAIAdapter returns object with classify", () => {
  const a = makeOpenAIAdapter({ baseUrl: "http://localhost", apiKey: "k", model: "m" });
  expect(typeof a.classify).toBe("function");
});
