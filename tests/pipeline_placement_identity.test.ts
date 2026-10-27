/**
 * WU-010 — placement plans and MetaV3 are computed from the repository-relative path
 * (RC-017 / F-031) with the injected record's resolved namespace (RC-026 / F-108).
 *
 * The placement/MetaV3 stage used to pass absolute paths to the segment-rule classifier,
 * so a checkout below an ancestor named `tests/` or `build/` was classified wholesale as
 * a test suite or build artifact; and it compiled plans with the raw `config.namespace`
 * (default `l9`) while headers carried the resolved identity namespace.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runPipelineAsync } from "../src/pipeline";
import type { PipelineConfig, PipelineResult } from "../src/schema";

const dirs: string[] = [];

function tmpBase(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-wu010-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

const GUIDE_MD = "# Guide\n\nHow to use the service.\n";
const APP_TS = "export function main(): number {\n  return 42;\n}\n";

function seedTree(root: string): void {
  write(root, "guide.md", GUIDE_MD);
  write(root, "src/app.ts", APP_TS);
}

function cfg(root: string, out: string, overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    root, glob: "**/*", dryRun: true, outDir: out, indexDir: out,
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    verbose: false, llmEnabled: false, normalizeFilenames: false,
    ...overrides,
  };
}

function relative(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

/** Checkout-independent projection of the placement and MetaV3 outputs, keyed by relative path. */
function placementView(root: string, result: PipelineResult) {
  return {
    plans: result.placementPlans
      .map((p) => ({ sourcePath: p.sourcePath, artifactClass: p.artifactClass, layer: p.layer, targetPath: p.targetPath }))
      .sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : 1)),
    metaV3: result.metaV3
      .map((r) => ({
        path: relative(root, r.sourcePath),
        semanticClass: r.semanticClass,
        layer: r.metaV3.placement.layer,
        outputPath: r.metaV3.placement.output_path,
      }))
      .sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
}

describe("WU-010 RC-017 placement is computed from the repository-relative path", () => {
  test("REG-WU-010-RC-017-a: identical trees under plain, tests and build ancestors place identically", async () => {
    const base = tmpBase();
    const views = [];
    for (const ancestor of ["plain", "tests", "build"]) {
      const root = path.join(base, ancestor, "repo");
      seedTree(root);
      const result = await runPipelineAsync(cfg(root, path.join(base, `${ancestor}-out`), { namespace: "l9" }));
      views.push(placementView(root, result));
    }
    expect(views[1]).toEqual(views[0]);
    expect(views[2]).toEqual(views[0]);

    const guide = views[0].plans.find((p) => p.sourcePath === "guide.md");
    const app = views[0].plans.find((p) => p.sourcePath === "src/app.ts");
    expect(guide).toMatchObject({ artifactClass: "documentation", targetPath: "docs/guide.md" });
    expect(app).toMatchObject({ artifactClass: "source_module", targetPath: "src/app.ts" });
    expect(views[0].metaV3.find((r) => r.path === "guide.md")?.semanticClass).toBe("documentation");
    expect(views[0].metaV3.find((r) => r.path === "src/app.ts")?.semanticClass).toBe("source_module");
  }, 30000);

  test("REG-WU-010-RC-017-b: in-repo segment rules still apply under a neutral ancestor", async () => {
    const base = tmpBase();
    const root = path.join(base, "plain", "repo");
    // `tests/foo.md` is a coarse `test` artifact: non-injectable, so it gets no plan; an
    // injectable file under an in-repo `schemas/` segment exercises the same rule family.
    write(root, "tests/foo.md", "# Foo tests\n\nCases.\n");
    write(root, "schemas/order.md", "# Order\n\nFields of an order.\n");
    const result = await runPipelineAsync(cfg(root, path.join(base, "out"), { namespace: "l9" }));
    expect(result.coverage.skipped.nonInjectable).toEqual([path.join(root, "tests", "foo.md")]);
    expect(result.metaV3.map((r) => [relative(root, r.sourcePath), r.semanticClass])).toEqual([["schemas/order.md", "schema"]]);
    expect(result.placementPlans.map((p) => [p.sourcePath, p.artifactClass])).toEqual([["schemas/order.md", "schema"]]);
  }, 20000);

  test("REG-WU-010-RC-017-c: a root itself named build does not make its files build artifacts", async () => {
    const base = tmpBase();
    const root = path.join(base, "build");
    seedTree(root);
    const result = await runPipelineAsync(cfg(root, path.join(base, "out"), { namespace: "l9" }));
    expect(result.metaV3.length).toBe(2);
    expect(result.metaV3.some((r) => r.semanticClass === "build_artifact")).toBe(false);
    expect(result.placementPlans.some((p) => p.artifactClass === "build_artifact")).toBe(false);
  }, 20000);

  test("REG-WU-010-RC-017-d: persisted placement-plan.json and meta-v3-index.json fields match across checkouts", async () => {
    const base = tmpBase();
    const persisted = [];
    for (const ancestor of ["plain", "tests"]) {
      const root = path.join(base, ancestor, "repo");
      seedTree(root);
      const out = path.join(base, `${ancestor}-out`);
      await runPipelineAsync(cfg(root, out, { namespace: "l9", dryRun: false }));
      const plans = JSON.parse(fs.readFileSync(path.join(out, "placement-plan.json"), "utf8")) as Array<Record<string, unknown>>;
      const metaV3 = JSON.parse(fs.readFileSync(path.join(out, "meta-v3-index.json"), "utf8")) as Array<{
        sourcePath: string; semanticClass: string; metaV3: { placement: Record<string, unknown> };
      }>;
      persisted.push(JSON.stringify({
        plans: plans.map((p) => ({ sourcePath: p.sourcePath, artifactClass: p.artifactClass, layer: p.layer, targetPath: p.targetPath })),
        metaV3: metaV3.map((r) => ({
          semanticClass: r.semanticClass,
          layer: r.metaV3.placement.layer,
          outputPath: r.metaV3.placement.output_path,
        })),
      }));
    }
    expect(persisted[1]).toBe(persisted[0]);
  }, 30000);
});

const DIGESTS = {
  "l9.authority-model/global@1": "sha256:ef536f5e233a84fd4a4d24a5fe101e9cf9a78563fafbf1e638faa383208bc451",
  "l9.artifact-model/global@1": "sha256:21f8bb783d7611ae1b3c60474c6ca31f6096f29d7ef0e94ef81f12e6d2defe09",
  "l9.vocabulary/global@1": "sha256:75e146e90e9f3e976c75382a5928d04c18531fa076f4096f8e5c5d4f468b0084",
  "l9.identity-model/global@1": "sha256:b9245eca99501a38976e909e1d151942c1253b2eee2bd6bab9c6382687db4288",
  "l9.product-kinds/global@1": "sha256:6bc39e7376650601570301fe486bdc6f2897fe461321e92c41250f9426688e7d",
  "l9.dependency-archetypes/global@1": "sha256:909db431aa0ccc7668ce3f2dcd46addc26df39c8f3e7303925469b47d6a4617d",
} as const;

/** The bound v2 authority fixture used by tests/authority_semantic_binding.test.ts. */
function v2Doc(): string {
  const ledgers = Object.entries(DIGESTS).map(([id, digest]) => `    ${id}: ${digest}`).join("\n");
  return `schema: l9.meta-authority/v2
writer:
  repository: Example/product
  ref: v1
default_carrier: central_manifest
legacy_writers: forbidden
inline_allow: []
semantic_foundation:
  repository: Quantum-L9/.github
  revision: 31b4f4f699becb1437b4804c308650bbad60c00e
  release: v3.6.0
  admission: candidate
  ledgers:
${ledgers}
product:
  id: example-product
  owner: Example/product
  kind: dependency
  archetype: l9.dependency-archetype/semantic-subsystem@1
`;
}

function expectPlanNamespacesMatchHeaders(result: PipelineResult, root: string): void {
  expect(result.placementPlans.length).toBe(result.injected.length);
  for (const record of result.injected) {
    const plan = result.placementPlans.find((p) => p.sourcePath === relative(root, record.sourcePath));
    expect(plan, `no plan for ${record.sourcePath}`).toBeDefined();
    expect(plan?.namespace).toBe(record.meta.namespace);
    const v3 = result.metaV3.find((r) => r.sourcePath === record.sourcePath);
    expect(v3?.metaV3.placement.namespace).toBe(plan?.namespace);
  }
}

describe("WU-010 RC-026 plans carry the resolved header namespace", () => {
  test("REG-WU-010-RC-026-a: an unbound root without a configured namespace uses the root's name everywhere", async () => {
    const base = tmpBase();
    const root = path.join(base, "repo");
    seedTree(root);
    const result = await runPipelineAsync(cfg(root, path.join(base, "out")));
    expect(result.placementPlans.length).toBe(2);
    expect(result.placementPlans.every((p) => p.namespace === "repo")).toBe(true);
    expect(result.metaV3.every((r) => r.metaV3.placement.namespace === "repo")).toBe(true);
    expectPlanNamespacesMatchHeaders(result, root);
  }, 20000);

  test("REG-WU-010-RC-026-b: a bound root's plans use product.id", async () => {
    const base = tmpBase();
    const root = path.join(base, "repo");
    write(root, ".l9/meta-authority.yaml", v2Doc());
    write(root, "notes.md", "# Notes\n\nbody\n");
    const result = await runPipelineAsync(cfg(root, path.join(base, "out"), { authority: undefined, glob: "**/*.md" }));
    expect(result.placementPlans.length).toBeGreaterThan(0);
    expect(result.placementPlans.every((p) => p.namespace === "example-product")).toBe(true);
    expectPlanNamespacesMatchHeaders(result, root);
  }, 20000);

  test("REG-WU-010-RC-026-c: namespace globs reach the plans per record", async () => {
    const base = tmpBase();
    const root = path.join(base, "repo");
    write(root, "plastos/spec.md", "# Spec\n\nPlastos spec.\n");
    write(root, "guide.md", GUIDE_MD);
    const result = await runPipelineAsync(cfg(root, path.join(base, "out"), {
      glob: "**/*.md",
      namespaceGlobs: [{ glob: "plastos/**", namespace: "plastos" }],
    }));
    expect(result.placementPlans.find((p) => p.sourcePath === "plastos/spec.md")?.namespace).toBe("plastos");
    expect(result.placementPlans.find((p) => p.sourcePath === "guide.md")?.namespace).toBe("repo");
    expectPlanNamespacesMatchHeaders(result, root);
  }, 20000);

  test("REG-WU-010-RC-026-d: an explicit namespace is preserved", async () => {
    const base = tmpBase();
    const root = path.join(base, "repo");
    seedTree(root);
    const result = await runPipelineAsync(cfg(root, path.join(base, "out"), { namespace: "l9" }));
    expect(result.placementPlans.every((p) => p.namespace === "l9")).toBe(true);
    expectPlanNamespacesMatchHeaders(result, root);
  }, 20000);
});
