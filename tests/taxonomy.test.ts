// RAA-003 — the taxonomy authority declares ArtifactType canonical and maps the
// other vocabularies onto it. These tests lock the maps as TOTAL (every source
// value produces a valid canonical ArtifactType) so a new class cannot silently
// go unmapped.
import { semanticClassToArtifactType, inventoryTypeToArtifactType } from "../src/taxonomy";
import { PRIMITIVE_TAXONOMY, SemanticArtifactClass } from "../src/schema";
import { InventoryArtifactType } from "../src/inventory";

const CANONICAL = new Set(Object.keys(PRIMITIVE_TAXONOMY)); // the 10 ArtifactType values

const ALL_SEMANTIC: SemanticArtifactClass[] = [
  "source_module", "type_definitions", "test_suite", "schema", "configuration",
  "documentation", "contract", "build_manifest", "build_artifact", "fixture",
  "script", "pipeline", "prompt_template", "skill_definition", "governance_doctrine",
  "changelog", "unknown",
];
const ALL_INVENTORY: InventoryArtifactType[] = [
  "spec", "code", "schema", "prompt", "research_markdown", "research_pdf",
  "config", "test", "documentation", "archive", "folder", "unknown",
];

describe("RAA-003 — semantic class → canonical ArtifactType is total & valid", () => {
  test.each(ALL_SEMANTIC)("%s maps to a canonical ArtifactType", (cls) => {
    expect(CANONICAL.has(semanticClassToArtifactType(cls))).toBe(true);
  });
  test("representative mappings are stable", () => {
    expect(semanticClassToArtifactType("prompt_template")).toBe("prompt");
    expect(semanticClassToArtifactType("skill_definition")).toBe("skill");
    expect(semanticClassToArtifactType("governance_doctrine")).toBe("doctrine");
    expect(semanticClassToArtifactType("test_suite")).toBe("test");
    expect(semanticClassToArtifactType("unknown")).toBe("unknown");
  });
});

describe("RAA-003 — inventory type → canonical ArtifactType is total & valid", () => {
  test.each(ALL_INVENTORY)("%s maps to a canonical ArtifactType", (t) => {
    expect(CANONICAL.has(inventoryTypeToArtifactType(t))).toBe(true);
  });
  test("representative mappings are stable", () => {
    expect(inventoryTypeToArtifactType("code")).toBe("source");
    expect(inventoryTypeToArtifactType("prompt")).toBe("prompt");
    expect(inventoryTypeToArtifactType("test")).toBe("test");
    expect(inventoryTypeToArtifactType("folder")).toBe("unknown");
  });
});
