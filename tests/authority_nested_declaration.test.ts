import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { inspectRepositoryAuthority, scanRepositoryAuthority } from "../src/authority_scan";
import { runCheckAsync, type CheckConfig } from "../src/check";

const roots: string[] = [];

const AUTHORITY = (policy: string) => [
  "schema: l9.meta-authority/v1",
  "writer:",
  "  repository: Quantum-L9/l9-meta-injector",
  "  ref: fc335977581ff556a8d071a80fd48dfb3686a5cb",
  "default_carrier: inline_managed",
  `legacy_writers: ${policy}`,
  "inline_allow: [\"**/*.md\"]",
  "",
].join("\n");

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-nested-authority-"));
  roots.push(root);
  return root;
}

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function config(root: string): CheckConfig {
  const external = `${root}.out`;
  return {
    root,
    glob: "**/*",
    outDir: external,
    namespace: "fixture",
    authority: "l9.doctrine.platform",
    nearDupThreshold: 0.9,
    hashPrefixLength: 16,
    indexDir: external,
    verbose: false,
    llmEnabled: false,
    normalizeFilenames: false,
    writeInjectLog: false,
    localFiles: false,
    persistOutputs: false,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.out`, { recursive: true, force: true });
  }
});

describe("one repository has one authority", () => {
  test("a nested .l9/meta-authority.yaml is a conflict, in code-point order, with its path", () => {
    const root = tempRoot();
    write(root, ".l9/meta-authority.yaml", AUTHORITY("forbidden"));
    write(root, "vendor/.l9/meta-authority.yaml", AUTHORITY("allowed"));
    write(root, "apps/b/.l9/meta-authority.yaml", AUTHORITY("forbidden"));
    write(root, "apps/a/.l9/README.md", "no document here\n");
    const scan = scanRepositoryAuthority(root);
    expect(scan.conflicts.map((item) => [item.code, item.path])).toEqual([
      ["META_AUTHORITY_CONFLICT", "apps/b/.l9/meta-authority.yaml"],
      ["META_AUTHORITY_CONFLICT", "vendor/.l9/meta-authority.yaml"],
    ]);
    const inspection = inspectRepositoryAuthority(root);
    expect(inspection.authorityResolved).toBe(false);
    expect(inspection.conflicts.some((item) => item.path === "vendor/.l9/meta-authority.yaml")).toBe(true);
  });

  test("a governed check fails closed on a nested declaration without touching the tree", async () => {
    const root = tempRoot();
    write(root, ".l9/meta-authority.yaml", AUTHORITY("forbidden"));
    write(root, "sub/.l9/meta-authority.yaml", AUTHORITY("allowed"));
    write(root, "sub/p.md", "# Build prompt\n\nRole: auditor\nObjective: inspect.\nOutput format: markdown.\n");
    const result = await runCheckAsync(config(root));
    expect(result.passed).toBe(false);
    expect(result.authorityResolved).toBe(false);
    expect(result.check?.authorityConflicts.map((item) => item.path)).toContain("sub/.l9/meta-authority.yaml");
    expect(result.check?.carrierDecisions).toEqual([]);
  });

  test("the root document alone, or a nested .l9 without a document, resolves cleanly", () => {
    const root = tempRoot();
    write(root, ".l9/meta-authority.yaml", AUTHORITY("forbidden"));
    write(root, "sub/.l9/metadata-index.jsonl", "");
    const inspection = inspectRepositoryAuthority(root);
    expect(inspection.conflicts).toEqual([]);
    expect(inspection.authorityResolved).toBe(true);
  });
});
