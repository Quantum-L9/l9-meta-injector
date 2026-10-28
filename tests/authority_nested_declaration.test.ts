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

describe("nested authority discovery ignores writer-evidence exclusions (RC-030, ADR-072)", () => {
  function nestedConflicts(root: string): string[] {
    return inspectRepositoryAuthority(root).conflicts
      .filter((item) => item.code === "META_AUTHORITY_CONFLICT")
      .map((item) => item.path ?? "");
  }

  test("REG-WU-024-RC-030-a: a declaration under docs/ is a conflict", () => {
    const root = tempRoot();
    write(root, ".l9/meta-authority.yaml", AUTHORITY("forbidden"));
    write(root, "docs/handbook/.l9/meta-authority.yaml", AUTHORITY("allowed"));
    const inspection = inspectRepositoryAuthority(root);
    expect(inspection.conflicts.map((item) => [item.code, item.path])).toEqual([
      ["META_AUTHORITY_CONFLICT", "docs/handbook/.l9/meta-authority.yaml"],
    ]);
    expect(inspection.authorityResolved).toBe(false);
  });

  test("REG-WU-024-RC-030-b: declarations under build/ and tests/ are conflicts in code-point order", () => {
    const root = tempRoot();
    write(root, ".l9/meta-authority.yaml", AUTHORITY("forbidden"));
    write(root, "tests/e2e/.l9/meta-authority.yaml", AUTHORITY("allowed"));
    write(root, "src/build/.l9/meta-authority.yaml", AUTHORITY("allowed"));
    for (const name of ["dist", "coverage", "fixtures", "reports"]) write(root, `${name}/.l9/meta-authority.yaml`, AUTHORITY("allowed"));
    expect(nestedConflicts(root)).toEqual([
      "coverage/.l9/meta-authority.yaml",
      "dist/.l9/meta-authority.yaml",
      "fixtures/.l9/meta-authority.yaml",
      "reports/.l9/meta-authority.yaml",
      "src/build/.l9/meta-authority.yaml",
      "tests/e2e/.l9/meta-authority.yaml",
    ]);
  });

  test("REG-WU-024-RC-030-b: caller-excluded directories are still searched for nested declarations", () => {
    const root = tempRoot();
    write(root, ".l9/meta-authority.yaml", AUTHORITY("forbidden"));
    write(root, "examples/.l9/meta-authority.yaml", AUTHORITY("allowed"));
    const scan = scanRepositoryAuthority(root, { excludedDirectoryNames: ["examples"] });
    expect(scan.conflicts.map((item) => item.path)).toEqual(["examples/.l9/meta-authority.yaml"]);
  });

  test("REG-WU-024-RC-030-c: a symlinked nested document is a conflict, dangling or not", () => {
    const root = tempRoot();
    write(root, ".l9/meta-authority.yaml", AUTHORITY("forbidden"));
    write(root, "other.yaml", AUTHORITY("allowed"));
    fs.mkdirSync(path.join(root, "vendor/.l9"), { recursive: true });
    fs.symlinkSync("../../other.yaml", path.join(root, "vendor/.l9/meta-authority.yaml"));
    fs.mkdirSync(path.join(root, "zdangling/.l9"), { recursive: true });
    fs.symlinkSync("../../missing.yaml", path.join(root, "zdangling/.l9/meta-authority.yaml"));
    const inspection = inspectRepositoryAuthority(root);
    expect(inspection.conflicts.map((item) => [item.code, item.path])).toEqual([
      ["META_AUTHORITY_CONFLICT", "vendor/.l9/meta-authority.yaml"],
      ["META_AUTHORITY_CONFLICT", "zdangling/.l9/meta-authority.yaml"],
    ]);
    expect(inspection.authorityResolved).toBe(false);
  });

  test("REG-WU-024-RC-030-c: a nested document that is a directory still competes", () => {
    const root = tempRoot();
    write(root, ".l9/meta-authority.yaml", AUTHORITY("forbidden"));
    fs.mkdirSync(path.join(root, "pkg/.l9/meta-authority.yaml"), { recursive: true });
    expect(nestedConflicts(root)).toEqual(["pkg/.l9/meta-authority.yaml"]);
  });

  test("REG-WU-024-RC-030-d: a symlinked nested .l9 is a scan gap naming it", () => {
    const root = tempRoot();
    write(root, ".l9/meta-authority.yaml", AUTHORITY("forbidden"));
    write(root, "elsewhere/meta-authority.yaml", AUTHORITY("allowed"));
    fs.mkdirSync(path.join(root, "apps/b"), { recursive: true });
    fs.symlinkSync("../../elsewhere", path.join(root, "apps/b/.l9"));
    fs.mkdirSync(path.join(root, "docs/x"), { recursive: true });
    fs.symlinkSync("../../elsewhere", path.join(root, "docs/x/.l9"));
    const inspection = inspectRepositoryAuthority(root);
    expect(inspection.conflicts.map((item) => [item.code, item.path])).toEqual([
      ["META_AUTHORITY_SCAN_INCOMPLETE", "apps/b/.l9"],
      ["META_AUTHORITY_SCAN_INCOMPLETE", "docs/x/.l9"],
    ]);
    expect(inspection.authorityResolved).toBe(false);
  });

  test("REG-WU-024-RC-030-e: a nested .l9 under docs/ without a document resolves cleanly", () => {
    const root = tempRoot();
    write(root, ".l9/meta-authority.yaml", AUTHORITY("forbidden"));
    write(root, "docs/x/.l9/metadata-index.jsonl", "");
    const inspection = inspectRepositoryAuthority(root);
    expect(inspection.conflicts).toEqual([]);
    expect(inspection.authorityResolved).toBe(true);
  });

  test("REG-WU-024-RC-030-f: inert documentation and test examples stay out of writer evidence", () => {
    const root = tempRoot();
    write(root, ".l9/meta-authority.yaml", AUTHORITY("forbidden"));
    write(root, "docs/migration.md", "Example: python scripts/inject-l9-meta.py and x-l9-meta");
    write(root, "docs/scripts/inject-l9-meta.py", "Path('x').write_text('x-l9-meta')\n");
    write(root, "tests/legacy_writer.test.ts", "const marker = 'L9_META'; writeFileSync('x', marker)");
    write(root, "tests/package.json", "{\"scripts\": {\"x\": \"python scripts/verify-l9-meta.py\"}}\n");
    fs.symlinkSync("../docs", path.join(root, "tests/package-link.json"));
    const scan = scanRepositoryAuthority(root);
    expect(scan.conflicts).toEqual([]);
    expect(scan.scannedPaths).toEqual([]);
    expect(scan.evidence).toEqual([]);
  });

  test("REG-WU-024-RC-030-g: dependency install trees and VCS internals are not searched (ADR-072)", () => {
    const root = tempRoot();
    write(root, ".l9/meta-authority.yaml", AUTHORITY("forbidden"));
    for (const name of ["node_modules/pkg", ".venv/lib", "__pycache__", ".git/x"]) {
      write(root, `${name}/.l9/meta-authority.yaml`, AUTHORITY("allowed"));
    }
    const inspection = inspectRepositoryAuthority(root);
    expect(inspection.conflicts).toEqual([]);
    expect(inspection.authorityResolved).toBe(true);
  });
});
