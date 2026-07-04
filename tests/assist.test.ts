import { isGoodValue, PROSE_ORIGIN_FIELDS, GRAMMAR_ORIGIN_FIELDS, assistField, DEFAULT_ASSIST_CONFIG } from "../src/assist";
import { UNKNOWN } from "../src/schema";
import { resetAdapter, setAdapter } from "../src/llm";

afterEach(() => resetAdapter());

describe("isGoodValue", () => {
  it("rejects UNKNOWN", () => expect(isGoodValue(UNKNOWN)).toBe(false));
  it("rejects empty string", () => expect(isGoodValue("")).toBe(false));
  it("rejects short string", () => expect(isGoodValue("short value")).toBe(false));
  it("accepts well-formed sentence", () => expect(isGoodValue("This artifact processes documents and produces structured JSON chunks for downstream retrieval.")).toBe(true));
  it("accepts non-empty array", () => expect(isGoodValue(["text chunking", "document split", "retrieval prep"])).toBe(true));
  it("rejects array with UNKNOWN", () => expect(isGoodValue([UNKNOWN])).toBe(false));
});

describe("field classification", () => {
  it("description is prose-origin", () => expect(PROSE_ORIGIN_FIELDS.has("description")).toBe(true));
  it("activation_signals is prose-origin", () => expect(PROSE_ORIGIN_FIELDS.has("activation_signals")).toBe(true));
  it("role is grammar-origin", () => expect(GRAMMAR_ORIGIN_FIELDS.has("role")).toBe(true));
  it("validation_gates is grammar-origin", () => expect(GRAMMAR_ORIGIN_FIELDS.has("validation_gates")).toBe(true));
});

describe("assistField", () => {
  it("returns seed when disabled", async () => {
    const r = await assistField("description", UNKNOWN, "some body text here", { ...DEFAULT_ASSIST_CONFIG, enabled: false });
    expect(r).toBe(UNKNOWN);
  });

  it("skips LLM when seed already good", async () => {
    let called = false;
    setAdapter({ estimateTokens: (t) => t.length / 4, classify: async () => { called = true; return "x"; } });
    const good = "This artifact processes documents and emits structured JSON chunks for retrieval indexing.";
    await assistField("description", good, "body", { ...DEFAULT_ASSIST_CONFIG, enabled: true });
    expect(called).toBe(false);
  });

  it("calls LLM when seed is Unknown", async () => {
    let called = false;
    setAdapter({ estimateTokens: () => 1, classify: async () => { called = true; return "Processes documents and emits output for retrieval."; } });
    const r = await assistField("description", UNKNOWN, "processes docs", { ...DEFAULT_ASSIST_CONFIG, enabled: true });
    expect(called).toBe(true);
    expect(typeof r).toBe("string");
  });

  it("returns seed when LLM returns empty", async () => {
    setAdapter({ estimateTokens: () => 1, classify: async () => "" });
    const r = await assistField("description", UNKNOWN, "body", { ...DEFAULT_ASSIST_CONFIG, enabled: true });
    expect(r).toBe(UNKNOWN);
  });
});
