import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildCarrierOperationPlan, inlinePlanDrift, metadataIndexDrift } from "../src/carrier_operation";
import { compileMetadataIndex, type ManagedMetadataSubject } from "../src/metadata_index";
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

describe("WU-005 scoped plans merge with the existing metadata index (RC-009)", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function tempRepo(indexBytes?: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-carrier-merge-"));
    roots.push(root);
    if (indexBytes !== undefined) {
      fs.mkdirSync(path.join(root, ".l9"));
      fs.writeFileSync(path.join(root, ".l9", "metadata-index.jsonl"), indexBytes);
    }
    return root;
  }

  function outOfScopeSubject(pathName: string, id?: string): ManagedMetadataSubject {
    const hash = "d".repeat(64);
    return {
      path: pathName,
      artifactType: "source",
      strategy: "line-comment",
      contentHash: hash,
      metadata: { source_path: pathName, content_hash: hash, ...(id ? { id } : {}) },
    };
  }

  function scoped(p: PipelineResult, ...paths: string[]): PipelineResult {
    p.coverage.discovery.entries = paths.map((item) => ({
      path: item,
      kind: "file" as const,
      disposition: "glob_filtered" as const,
      reason: "file does not match discovery glob prompts/**",
    }));
    return p;
  }

  test("REG-WU-005-RC-009-g: a plan without scope-filtered ledger entries never reads the index and keeps today's bytes", () => {
    const root = tempRepo("not an index\n");
    const p = pipeline(root);
    const plan = buildCarrierOperationPlan("check", root, AUTHORITY, p);
    expect(plan.metadataIndexBase ?? null).toBeNull();
    const expected = compileMetadataIndex({ authority: AUTHORITY, mode: "check", subjects: p.metadataSubjects });
    expect(plan.metadataIndex.bytes).toBe(expected.bytes);
    expect(plan.metadataIndex.sha256).toBe(expected.sha256);
    // The synthetic root that does not exist keeps compiling without touching the filesystem.
    const missing = path.resolve("/tmp/repo-does-not-exist-l9");
    expect(buildCarrierOperationPlan("check", missing, AUTHORITY, pipeline(missing)).metadataIndex.bytes).toBe(expected.bytes);
  });

  test("REG-WU-005-RC-009-a: scope-filtered records are carried forward verbatim and in-scope records are recompiled", () => {
    const base = compileMetadataIndex({
      authority: AUTHORITY,
      mode: "apply",
      subjects: [outOfScopeSubject("vendor/z.ts"), outOfScopeSubject("prompts/a.md"), outOfScopeSubject("prompts/gone.md")],
    });
    const root = tempRepo(base.bytes);
    const p = scoped(pipeline(root), "vendor/z.ts");
    const plan = buildCarrierOperationPlan("check", root, AUTHORITY, p);
    expect(plan.metadataIndex.records.map((record) => record.path)).toEqual(["prompts/a.md", "src/a.ts", "vendor/z.ts"]);
    const line = (bytes: string, name: string) => bytes.split("\n").find((item) => item.includes(`"path":"${name}"`));
    expect(line(plan.metadataIndex.bytes, "vendor/z.ts")).toBe(line(base.bytes, "vendor/z.ts"));
    expect(line(plan.metadataIndex.bytes, "prompts/a.md")).not.toBe(line(base.bytes, "prompts/a.md"));
    expect(plan.metadataIndex.carrierDecisions.map((item) => item.path)).toEqual(["prompts/a.md", "src/a.ts"]);
    expect(plan.metadataIndexBase).toEqual({ exists: true, sha256: base.sha256 });
    expect(metadataIndexDrift(plan)?.kind).toBe("stale");
  });

  test("REG-WU-005-RC-009-e: an unparseable base index makes a scoped plan unmergeable and check reports it", () => {
    const root = tempRepo("{\"broken\": true}\n");
    const plan = buildCarrierOperationPlan("check", root, AUTHORITY, scoped(pipeline(root), "vendor/z.ts"));
    expect(plan.metadataIndexBase?.unmergeableReason).toMatch(/cannot be parsed/);
    const drift = metadataIndexDrift(plan);
    expect(drift?.kind).toBe("conflict");
    expect(drift?.message).toMatch(/unscoped/);
  });

  test("REG-WU-005-RC-009-a: a scoped plan on a repository without an index records an absent base", () => {
    const root = tempRepo();
    const plan = buildCarrierOperationPlan("apply", root, AUTHORITY, scoped(pipeline(root), "vendor/z.ts"));
    expect(plan.metadataIndexBase).toEqual({ exists: false });
    expect(plan.metadataIndex.records.map((record) => record.path)).toEqual(["prompts/a.md", "src/a.ts"]);
  });

  test("REG-WU-005-RC-009-a: a preserved record that reuses an in-scope metadata id is refused", () => {
    const base = compileMetadataIndex({ authority: AUTHORITY, mode: "apply", subjects: [outOfScopeSubject("vendor/z.ts", "dup-id")] });
    const root = tempRepo(base.bytes);
    const p = scoped(pipeline(root), "vendor/z.ts");
    (p.metadataSubjects[1].metadata as Record<string, unknown>).id = "dup-id";
    expect(() => buildCarrierOperationPlan("apply", root, AUTHORITY, p)).toThrow(/DUPLICATE_METADATA_ID.*dup-id/);
  });
});
