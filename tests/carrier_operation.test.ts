import * as path from "node:path";
import { buildCarrierOperationPlan, inlinePlanDrift } from "../src/carrier_operation";
import type { AuthorityConfig } from "../src/operation_contracts";
import type { PipelineResult } from "../src/pipeline";

const AUTHORITY: AuthorityConfig = {
  schema: "l9.meta-authority/v1",
  writer: { repository: "Quantum-L9/l9-meta-injector", ref: "a".repeat(40) },
  default_carrier: "central_manifest",
  legacy_writers: "forbidden",
  inline_allow: ["prompts/**/*.md"],
};

function pipeline(root: string): PipelineResult {
  const inline = path.join(root, "prompts", "a.md");
  const source = path.join(root, "src", "a.ts");
  return {
    runStartedAt: "runtime-only",
    scanned: [] as never,
    injected: [
      {
        sourcePath: inline,
        targetPath: inline,
        targetExists: true,
        wouldChange: true,
        expectedContentHash: "e".repeat(64),
        actualContentHash: "f".repeat(64),
        originalBodyHash: "1".repeat(64),
        postInjectionBodyHash: "1".repeat(64),
        bodyPreserved: true,
        headerInjected: false,
        injectionStrategy: "yaml-frontmatter",
        meta: { artifact_type: "prompt", source_path: "prompts/a.md", content_hash: "a".repeat(64) } as never,
      },
      {
        sourcePath: source,
        targetPath: `${source}.l9meta.yaml`,
        targetExists: false,
        wouldChange: true,
        expectedContentHash: "c".repeat(64),
        originalBodyHash: "2".repeat(64),
        postInjectionBodyHash: "2".repeat(64),
        bodyPreserved: true,
        headerInjected: false,
        injectionStrategy: "sidecar",
        sidecarPath: `${source}.l9meta.yaml`,
        meta: { artifact_type: "source", source_path: "src/a.ts", content_hash: "b".repeat(64) } as never,
      },
    ],
    verified: [],
    verification: { total: 0, clean: 0, withIssues: 0, passed: true, failures: [] },
    coverage: { scanned: 2, injected: 2, skippedBinary: 0, skippedNonInjectable: 0, verifyFailed: 0, archivesExpanded: 0, skipped: { binary: [], nonInjectable: [], nonInjectableDetails: [] }, reportPath: "", discovery: { entries: [], encountered: 0, blocking: 0, counts: {} } },
    placementPlans: [], metaV3: [], metrics: {} as never, archives: [],
    metadataSubjects: [
      { path: "prompts/a.md", artifactType: "prompt", strategy: "yaml-frontmatter", contentHash: "a".repeat(64), metadata: { artifact_type: "prompt", source_path: "prompts/a.md", content_hash: "a".repeat(64) } },
      { path: "src/a.ts", artifactType: "source", strategy: "sidecar", contentHash: "b".repeat(64), metadata: { artifact_type: "source", source_path: "src/a.ts", content_hash: "b".repeat(64) } },
    ],
  };
}

describe("carrier-aware operation planning", () => {
  test("uses one decision set for inline and central-manifest subjects", () => {
    const root = path.resolve("/tmp/repo");
    const plan = buildCarrierOperationPlan("check", root, AUTHORITY, pipeline(root));
    expect(plan.carrierDecisions.map((item) => [item.path, item.carrier])).toEqual([
      ["prompts/a.md", "inline_managed"],
      ["src/a.ts", "central_manifest"],
    ]);
    expect(plan.inlinePlans).toHaveLength(1);
    expect(plan.inlinePlans[0].sourcePath).toBe(path.join(root, "prompts", "a.md"));
    expect(plan.metadataIndex.records).toHaveLength(2);
    expect(plan.metadataIndex.bytes).not.toContain(".l9meta.yaml");
  });

  test("reports only authorized inline drift; legacy sidecar plans are ignored", () => {
    const root = path.resolve("/tmp/repo");
    const plan = buildCarrierOperationPlan("check", root, AUTHORITY, pipeline(root));
    expect(inlinePlanDrift(plan)).toEqual([{ path: "prompts/a.md", kind: "stale", message: "authorized inline metadata differs from canonical expected bytes", expectedHash: "e".repeat(64), actualHash: "f".repeat(64) }]);
  });

  test("demotes non-frontmatter subjects to the central manifest", () => {
    const root = path.resolve("/tmp/repo");
    const p = pipeline(root);
    p.injected[0].injectionStrategy = "line-comment";
    p.metadataSubjects[0].strategy = "line-comment";
    const plan = buildCarrierOperationPlan("apply", root, AUTHORITY, p);
    expect(plan.carrierDecisions.find((item) => item.path === "prompts/a.md")?.carrier).toBe("central_manifest");
    expect(plan.inlinePlans).toHaveLength(0);
  });
});
