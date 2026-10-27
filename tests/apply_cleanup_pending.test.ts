import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

// WU-004 (DEC-RC-006 option A): a transaction whose bytes are committed but whose
// post-commit cleanup did not finish reports cleanupPending; apply surfaces it as a
// warning instead of staying silent until the next run's recovery.
vi.mock("../src/file_transaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/file_transaction")>();
  return {
    ...actual,
    executeFileTransaction: (...args: Parameters<typeof actual.executeFileTransaction>) => {
      const result = actual.executeFileTransaction(...args);
      return {
        ...result,
        cleanupPending: { journalPath: ".l9/transactions/fixture.json", retainedBackups: [], errors: ["EBUSY"] },
      };
    },
  };
});

import { runApplyAsync } from "../src/apply";

const roots: string[] = [];

function governedRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-apply-cleanup-"));
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
  fs.writeFileSync(path.join(root, "prompt.md"), "# Build prompt\n\nRole: auditor\nObjective: report.\n");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.out`, { recursive: true, force: true });
  }
});

describe("apply surfaces a transaction's pending cleanup", () => {
  test("cleanupPending becomes an apply warning naming the journal", async () => {
    const root = governedRoot();
    const external = `${root}.out`;
    const result = await runApplyAsync({
      root, glob: "**/*.md", outDir: external, namespace: "fixture", authority: "l9.doctrine.platform",
      nearDupThreshold: 0.9, hashPrefixLength: 16, indexDir: external, verbose: false, llmEnabled: false,
      normalizeFilenames: false, writeInjectLog: false, localFiles: false, persistOutputs: false, dryRun: false,
    } as never);
    expect(result.passed).toBe(true);
    expect(result.warnings.some((w) => /cleanup is pending \(\.l9\/transactions\/fixture\.json\)/.test(w))).toBe(true);
  });
});
