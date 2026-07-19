// QTE-005 — validated narrowing at the meta-bag boundary replaces `as unknown as`
// double-casts. coerceNormalizedMeta must accept a well-formed identity block and
// reject drift (missing field / wrong runtime type) at the boundary, not downstream.
import { asRecord, coerceNormalizedMeta, NormalizedMeta } from "../src/schema";

function fullHeader(): Record<string, unknown> {
  return {
    id: "l9.source.x", title: "X", artifact_type: "source",
    mcp_primitive: "resource", callable: false, retrievable: true, injectable: true,
    namespace: "l9", sharing_scope: "agnostic", source_path: "a/x.ts",
    content_hash: "abc", token_cost_estimate: 0, authority: "auto",
    created_or_detected_at: "2026-07-19",
  };
}

describe("QTE-005 — coerceNormalizedMeta validates the identity block", () => {
  test("a complete header coerces and preserves extra fields", () => {
    const bag = { ...fullHeader(), inventory_type: "code", evidence: "e" };
    const meta = coerceNormalizedMeta(bag);
    expect(meta.id).toBe("l9.source.x");
    // Extra (non-identity) keys ride along untouched.
    expect((meta as unknown as Record<string, unknown>).inventory_type).toBe("code");
  });

  test("a missing identity field throws at the boundary", () => {
    const bag = fullHeader();
    delete bag.content_hash;
    expect(() => coerceNormalizedMeta(bag)).toThrow(/content_hash.*string.*undefined/);
  });

  test("a wrong-typed identity field throws at the boundary", () => {
    const bag = { ...fullHeader(), callable: "yes" };
    expect(() => coerceNormalizedMeta(bag)).toThrow(/callable.*boolean/);
  });

  test("asRecord widens a meta union to a readable bag without laundering", () => {
    const meta = coerceNormalizedMeta(fullHeader());
    const bag = asRecord(meta as NormalizedMeta);
    expect(bag.namespace).toBe("l9");
    expect(bag.token_cost_estimate).toBe(0);
  });
});

// DWL-007 — "intent" was dead vocabulary (not a schema field). Guard against it
// creeping back into the prose-origin set that drives LLM assist / reconcile.
import { PROSE_ORIGIN_FIELDS } from "../src/assist";

describe("DWL-007 — no dead 'intent' field in the prose vocabulary", () => {
  test("PROSE_ORIGIN_FIELDS excludes the removed 'intent' field", () => {
    expect(PROSE_ORIGIN_FIELDS.has("intent")).toBe(false);
    // The real schema-backed prose fields remain.
    expect(PROSE_ORIGIN_FIELDS.has("description")).toBe(true);
    expect(PROSE_ORIGIN_FIELDS.has("input_contract")).toBe(true);
  });
});
