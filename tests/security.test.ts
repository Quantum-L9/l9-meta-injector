import { parseCanonicalYaml } from "../src/meta_schema";
import { resolveNamespace, NamespaceConfig } from "../src/namespace";
import { makeOpenAIAdapter, LlmDiagnostic } from "../src/llm";

describe("SEC-001 — parsed YAML cannot pollute Object.prototype", () => {
  test("a __proto__ key lands on a null-prototype bag, not Object.prototype", () => {
    const parsed = parseCanonicalYaml("__proto__: pwned\nname: ok\n") as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(parsed.name).toBe("ok");
    // Object.prototype is untouched; a fresh object gains no injected key.
    expect(({} as Record<string, unknown>).name).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("pwned");
  });
});

describe("SEC-002 — namespace globs with regex metacharacters are safe", () => {
  const base: NamespaceConfig = {
    namespace: "l9", authority: "a", nearDupThreshold: 0.9, hashPrefixLength: 16,
    outputDir: ".", indexDir: ".",
  };
  test("an unbalanced-bracket glob neither throws nor matches", () => {
    const cfg = { ...base, namespaceGlobs: [{ glob: "plastos/[unclosed(+", namespace: "x" }] };
    expect(() => resolveNamespace("plastos/foo.md", cfg)).not.toThrow();
    expect(resolveNamespace("plastos/foo.md", cfg).namespace).toBe("l9"); // no false match
  });
  test("a normal ** glob still matches", () => {
    const cfg = { ...base, namespaceGlobs: [{ glob: "plastos/**", namespace: "plastos" }] };
    expect(resolveNamespace("plastos/deep/file.md", cfg).namespace).toBe("plastos");
  });
});

describe("SEC-003 — no bearer token over cleartext", () => {
  test("non-https baseUrl refuses and reports, without a network call", async () => {
    const diags: LlmDiagnostic[] = [];
    const a = makeOpenAIAdapter({ baseUrl: "http://insecure.test", apiKey: "k", model: "m", onDiagnostic: (d) => diags.push(d) });
    const out = await a.classify!("prompt");
    expect(out).toBeNull();
    expect(diags[0].outcome).toBe("network_error");
    expect(diags[0].detail).toMatch(/non-https/);
  });
});
