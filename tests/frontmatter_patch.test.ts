import { inspectFrontMatterDocument, patchManagedFrontMatter } from "../src/frontmatter_patch";

describe("byte-preserving managed frontmatter", () => {
  test("creates one exact LF frontmatter block without changing body bytes", () => {
    const body = "# Title\n\nBody Ω\n";
    const result = patchManagedFrontMatter(body, { title: "Managed", active: true });
    expect(result.safe).toBe(true);
    expect(result.content).toBe(`---\ntitle: "Managed"\nactive: true\n---\n${body}`);
    expect(result.body).toBe(body);
    expect((result.content.match(/^---$/gm) ?? []).length).toBe(2);
  });

  test("preserves BOM, CRLF, comments, order, unrelated fields, and body", () => {
    const raw = "\uFEFF---\r\n# owner note\r\nowner: 'alice'\r\ndescription: old  # keep this comment\r\ntags:\r\n  # list note\r\n  - one\r\n  - two\r\n\r\n---\r\n# Body\r\n";
    const result = patchManagedFrontMatter(raw, { description: "new", tags: ["x", "y"] });
    expect(result.safe).toBe(true);
    expect(result.content.startsWith("\uFEFF---\r\n")).toBe(true);
    expect(result.content).toContain("# owner note\r\nowner: 'alice'\r\n");
    expect(result.content).toContain('description: "new"  # keep this comment\r\n');
    expect(result.content).toContain("tags:\r\n  # list note\r\n  - \"x\"\r\n  - \"y\"\r\n\r\n");
    expect(result.body).toBe("# Body\r\n");
    expect(result.content.endsWith(result.body)).toBe(true);
  });

  test("is byte-idempotent", () => {
    const once = patchManagedFrontMatter("# Body\n", { description: "same", activation_signals: ["a", "b"] });
    const twice = patchManagedFrontMatter(once.content, { description: "same", activation_signals: ["a", "b"] });
    expect(once.safe).toBe(true);
    expect(twice.safe).toBe(true);
    expect(twice.changed).toBe(false);
    expect(twice.content).toBe(once.content);
  });

  test("appends missing managed fields before the closing fence", () => {
    const raw = "---\nowner: bob\n---\nBody";
    const result = patchManagedFrontMatter(raw, { description: "d", active: false });
    expect(result.content).toBe("---\nowner: bob\ndescription: \"d\"\nactive: false\n---\nBody");
  });

  test.each([
    ["duplicate key", "---\na: 1\na: 2\n---\nBody", "FRONTMATTER_DUPLICATE_KEY"],
    ["nested map", "---\na:\n  b: 1\n---\nBody", "FRONTMATTER_COMPLEX_YAML"],
    ["block scalar", "---\na: |\n  text\n---\nBody", "FRONTMATTER_COMPLEX_YAML"],
    ["anchor", "---\na: &x value\n---\nBody", "FRONTMATTER_COMPLEX_YAML"],
    ["missing close", "---\na: 1\nBody", "FRONTMATTER_CLOSING_FENCE_MISSING"],
    ["nonexact open", "--- # yaml\na: 1\n---\nBody", "FRONTMATTER_OPENING_FENCE_NOT_EXACT"],
    ["duplicate block", "---\na: 1\n---\n\n---\nb: 2\n---\nBody", "FRONTMATTER_DUPLICATE_BLOCK"],
    ["mixed newline", "---\r\na: 1\n---\r\nBody", "FRONTMATTER_MIXED_NEWLINES"],
    ["tab", "---\na:\t1\n---\nBody", "FRONTMATTER_TAB_CHARACTER"],
    ["interleaved list comment", "---\na:\n  - one\n  # between\n  - two\n---\nBody", "FRONTMATTER_COMPLEX_YAML"],
  ])("fails closed for %s", (_name, raw, code) => {
    const result = patchManagedFrontMatter(raw, { description: "new" });
    expect(result.safe).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(raw);
    expect(result.issue?.code).toBe(code);
  });

  test("preserves inline comments and all bytes outside managed values", () => {
    const raw = "---\n# before\nowner: bob # owner\ndescription: old   # description\n# after\n---\n\nBody\n";
    const result = patchManagedFrontMatter(raw, { description: "new" });
    expect(result.content).toBe("---\n# before\nowner: bob # owner\ndescription: \"new\"   # description\n# after\n---\n\nBody\n");
  });

  test("inspection returns existing safe fields without normalizing bytes", () => {
    const raw = "---\nname: 'skill'\nactivation_signals: [one, \"two\"]\n---\nBody";
    const inspected = inspectFrontMatterDocument(raw);
    expect(inspected.safe).toBe(true);
    expect(inspected.meta.name).toBe("skill");
    expect(inspected.meta.activation_signals).toEqual(["one", "two"]);
    expect(inspected.body).toBe("Body");
  });

  test("rejects unsupported managed values without touching input", () => {
    const raw = "---\na: 1\n---\nBody";
    const result = patchManagedFrontMatter(raw, { a: { nested: true } });
    expect(result.safe).toBe(false);
    expect(result.issue?.code).toBe("FRONTMATTER_UNSUPPORTED_VALUE");
    expect(result.content).toBe(raw);
  });
});
