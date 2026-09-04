import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { runCheckAsync, type CheckConfig } from "../src/check";

// The container running this suite is root, so no permission bit can make a directory
// unreadable; the failure is injected at the module seam instead. Only `readdirSync`
// is redirected, and only for one directory, so every other filesystem call is real.
const seam = vi.hoisted(() => ({ locked: "" }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readdirSync = ((target: fs.PathLike, ...rest: unknown[]) => {
    if (seam.locked && path.resolve(String(target)) === seam.locked) {
      const error = new Error(`EACCES: permission denied, scandir '${seam.locked}'`) as NodeJS.ErrnoException;
      error.code = "EACCES";
      throw error;
    }
    return (actual.readdirSync as (...args: unknown[]) => unknown)(target, ...rest);
  }) as typeof fs.readdirSync;
  return { ...actual, readdirSync, default: { ...actual, readdirSync } };
});

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-check-unreadable-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, ".l9"));
  fs.writeFileSync(path.join(root, ".l9", "meta-authority.yaml"), [
    "schema: l9.meta-authority/v1",
    "writer:",
    "  repository: Quantum-L9/l9-meta-injector",
    "  ref: fc335977581ff556a8d071a80fd48dfb3686a5cb",
    "default_carrier: inline_managed",
    "legacy_writers: forbidden",
    "inline_allow: [\"**/*.md\"]",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "prompt.md"), "# Build prompt\n\nRole: auditor\nObjective: inspect.\nOutput format: markdown.\n");
  return root;
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
  seam.locked = "";
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.out`, { recursive: true, force: true });
  }
});

describe("governed check survives an unreadable entry", () => {
  test("a directory that cannot be enumerated is reported as blocking discovery instead of aborting the check", async () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, "locked"));
    fs.writeFileSync(path.join(root, "locked", "inner.md"), "# inner\n");
    seam.locked = path.join(root, "locked");

    // Before the repair the read-only snapshot threw out of runCheckAsync and no report
    // existed. Now the run returns: the authority scan, which walks first, records the
    // directory as a scan gap and the check fails closed with that evidence.
    const result = await runCheckAsync(config(root));
    expect(result.passed).toBe(false);
    expect(result.repositoryMutated).toBe(false);
    expect(result.authorityResolved).toBe(false);
    expect(result.check?.authorityConflicts.map((item) => [item.code, item.path])).toContainEqual([
      "META_AUTHORITY_SCAN_INCOMPLETE",
      "locked",
    ]);
    expect(result.check?.carrierDecisions).toEqual([]);
  });

  test("the same tree with the seam released passes the read-only check", async () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, "locked"));
    fs.writeFileSync(path.join(root, "locked", "inner.md"), "# Build prompt\n\nRole: auditor\nObjective: inspect.\nOutput format: markdown.\n");
    const result = await runCheckAsync(config(root));
    expect(result.check?.discovery.blocking).toBe(0);
    expect(result.check?.discovery.entries.find((item) => item.path === "locked")?.disposition).toBe("traversed_directory");
  });
});
