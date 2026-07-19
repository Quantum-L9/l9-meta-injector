import { buildMaterialityPrompt, parseMaterialityReply } from "../src/materiality";
import type { FieldDiff as SchemaFieldDiff, ReconcileAction as SchemaAction } from "../src/schema";
import type { FieldDiff as ReconcileFieldDiff, ReconcileAction as ReconcileActionAlias } from "../src/reconcile_fields";
import type { SharingScope as SchemaScope } from "../src/schema";
import type { SharingScope as NamespaceScope } from "../src/namespace";

describe("materiality primitive (ICC-003)", () => {
  test("buildMaterialityPrompt is the single canonical prompt", () => {
    const p = buildMaterialityPrompt("description", "a", "bb");
    expect(p).toBe('Field: description\nA: "a"\nB: "bb"\nIs B materially more informative than A? Reply only: yes or no');
  });

  test("parseMaterialityReply maps replies to booleans", () => {
    expect(parseMaterialityReply("yes")).toBe(true);
    expect(parseMaterialityReply("  YES, clearly")).toBe(true);
    expect(parseMaterialityReply("no")).toBe(false);
    expect(parseMaterialityReply("maybe")).toBe(false);
    expect(parseMaterialityReply(null)).toBe(false);
    expect(parseMaterialityReply(undefined)).toBe(false);
    expect(parseMaterialityReply("")).toBe(false);
  });
});

describe("single-source-of-truth contracts (ICC-001/ACA-004, ICC-002/RAA-002)", () => {
  test("FieldDiff from reconcile_fields is the schema type (assignable both ways)", () => {
    const a: SchemaFieldDiff = { field: "x", action: "add", oldValue: 1, newValue: 2, reason: "r" };
    const b: ReconcileFieldDiff = a; // compiles only if identical
    const c: SchemaFieldDiff = b;
    expect(c.action).toBe("add");
    const action: ReconcileActionAlias = "revise";
    const schemaAction: SchemaAction = action;
    expect(schemaAction).toBe("revise");
  });

  test("SharingScope from namespace is the schema type", () => {
    const s: SchemaScope = "shared";
    const n: NamespaceScope = s; // compiles only if identical
    const back: SchemaScope = n;
    expect(back).toBe("shared");
  });
});
