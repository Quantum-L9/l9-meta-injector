import * as fs from "fs";
import {
  compilePlacementPlan,
  compilePlacementPlans,
} from "../src/placement_policy";
import {
  CLASS_PLACEMENT_HINTS,
  SEMANTIC_ARTIFACT_CLASSES,
  placementHintFor,
  QUARANTINE_DIRECTORY,
} from "../src/artifact_class";

// --- placement wiring -------------------------------------------------------

test("every semantic class has a placement hint", () =>
  expect(SEMANTIC_ARTIFACT_CLASSES.every((c) => c in CLASS_PLACEMENT_HINTS)).toBe(true));

test.each([...SEMANTIC_ARTIFACT_CLASSES])(
  "placementHintFor(%s) yields a non-empty directory and layer",
  (c) => {
    const h = placementHintFor(c);
    expect(h.directory.length).toBeGreaterThan(0);
    expect(h.layer.length).toBeGreaterThan(0);
  }
);

// --- compilePlacementPlan ---------------------------------------------------

test("source module places under src/", () => {
  const p = compilePlacementPlan("src/inject.ts");
  expect(p.artifactClass).toBe("source_module");
  expect(p.targetDirectory).toBe("src");
  expect(p.targetPath).toBe("src/inject.ts");
  expect(p.quarantined).toBe(false);
  expect(p.layer).toBe("implementation");
});

test("schema places under schemas/", () =>
  expect(compilePlacementPlan("schemas/l9_meta_v3.schema.yaml").targetPath).toBe(
    "schemas/l9_meta_v3.schema.yaml"
  ));

test("test file places under tests/", () =>
  expect(compilePlacementPlan("foo.test.ts").targetDirectory).toBe("tests"));

test("contract places under docs/contracts/", () =>
  expect(compilePlacementPlan("PR004.contract.json").targetDirectory).toBe("docs/contracts"));

test("unknown artifact is quarantined", () => {
  const p = compilePlacementPlan("mystery.qzx");
  expect(p.artifactClass).toBe("unknown");
  expect(p.quarantined).toBe(true);
  expect(p.targetDirectory).toBe(QUARANTINE_DIRECTORY);
  expect(p.targetPath).toBe(`${QUARANTINE_DIRECTORY}/mystery.qzx`);
  expect(p.layer).toBe("quarantine");
});

test("writesRequired is always false (plans only)", () => {
  expect(compilePlacementPlan("src/inject.ts").writesRequired).toBe(false);
  expect(compilePlacementPlan("mystery.qzx").writesRequired).toBe(false);
});

test("namespace defaults to l9 and is overridable", () => {
  expect(compilePlacementPlan("src/a.ts").namespace).toBe("l9");
  expect(compilePlacementPlan("src/a.ts", "", { namespace: "acme" }).namespace).toBe("acme");
});

test("rootDir is prefixed onto the target path", () => {
  const p = compilePlacementPlan("src/a.ts", "", { rootDir: "packages/core" });
  expect(p.targetDirectory).toBe("packages/core/src");
  expect(p.targetPath).toBe("packages/core/src/a.ts");
});

test("quarantineAtOrBelow can quarantine medium-confidence artifacts", () => {
  const p = compilePlacementPlan("src/a.ts", "", { quarantineAtOrBelow: "medium" });
  expect(p.confidence).toBe("medium");
  expect(p.quarantined).toBe(true);
  expect(p.targetDirectory).toBe(QUARANTINE_DIRECTORY);
});

test("high-confidence artifacts are not quarantined at the default threshold", () =>
  expect(compilePlacementPlan("tests/x.test.ts").quarantined).toBe(false));

test("rationale is a non-empty string array", () => {
  const r = compilePlacementPlan("src/a.ts").rationale;
  expect(Array.isArray(r)).toBe(true);
  expect(r.length).toBeGreaterThan(0);
  expect(r.every((line) => typeof line === "string")).toBe(true);
});

test("deterministic: identical inputs produce identical plans", () =>
  expect(compilePlacementPlan("docs/x.md")).toEqual(compilePlacementPlan("docs/x.md")));

test("backslash paths resolve the basename correctly", () =>
  expect(compilePlacementPlan("src\\nested\\a.ts").targetPath).toBe("src/a.ts"));

test("target path carries no leading ./", () =>
  expect(compilePlacementPlan("CHANGELOG.md").targetPath.startsWith("./")).toBe(false));

test("changelog places at repo root", () =>
  expect(compilePlacementPlan("CHANGELOG.md").targetPath).toBe("CHANGELOG.md"));

// --- compilePlacementPlans (batch) ------------------------------------------

test("compilePlacementPlans preserves order and length", () => {
  const plans = compilePlacementPlans([
    { sourcePath: "src/a.ts" },
    { sourcePath: "mystery.qzx" },
    { sourcePath: "docs/x.md" },
  ]);
  expect(plans).toHaveLength(3);
  expect(plans.map((p) => p.artifactClass)).toEqual([
    "source_module",
    "unknown",
    "documentation",
  ]);
});

test("compilePlacementPlans applies options to every item", () => {
  const plans = compilePlacementPlans(
    [{ sourcePath: "src/a.ts" }, { sourcePath: "docs/x.md" }],
    { namespace: "acme" }
  );
  expect(plans.every((p) => p.namespace === "acme")).toBe(true);
});

// --- purity -----------------------------------------------------------------

test("purity: compiling a plan performs no file-system write", () => {
  const target = `${QUARANTINE_DIRECTORY}/does-not-exist.qzx`;
  const before = fs.existsSync(target);
  compilePlacementPlan("does-not-exist.qzx");
  expect(fs.existsSync(target)).toBe(before);
});
