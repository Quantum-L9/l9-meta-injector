import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * REG-WU-005-RC-009-h: the index a scoped apply merged with is the compare-and-swap
 * base of the index intent, so a concurrent index change between planning and commit
 * is refused instead of silently overwritten.
 */
const hook = vi.hoisted(() => ({ afterPlan: undefined as undefined | ((root: string) => void) }));

vi.mock("../src/carrier_operation", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/carrier_operation")>();
  return {
    ...original,
    planCarrierOperationAsync: async (input: Parameters<typeof original.planCarrierOperationAsync>[0]) => {
      const plan = await original.planCarrierOperationAsync(input);
      hook.afterPlan?.(plan.root);
      return plan;
    },
  };
});

const { runApplyAsync } = await import("../src/apply");

const PROMPT = [
  "# Build prompt",
  "",
  "Role: repository auditor",
  "Objective: inspect the repository and report evidence.",
  "Output format: markdown report.",
  "",
].join("\n");
const INDEX = path.join(".l9", "metadata-index.jsonl");
const roots: string[] = [];

function governedRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-scoped-cas-"));
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
  return root;
}

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function config(root: string, glob: string) {
  const external = `${root}.out`;
  return {
    root,
    glob,
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
    dryRun: false,
  } as never;
}

afterEach(() => {
  hook.afterPlan = undefined;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.out`, { recursive: true, force: true });
  }
});

describe("WU-005 scoped apply binds the merged index base into the transaction (RC-009)", () => {
  test("REG-WU-005-RC-009-h: an index change between planning and commit fails the transaction and survives", async () => {
    const root = governedRoot();
    write(root, "docs/a.md", PROMPT);
    write(root, "other/b.md", PROMPT.replace("Build prompt", "Other prompt"));
    expect((await runApplyAsync(config(root, "**/*"))).passed).toBe(true);

    const docPath = path.join(root, "docs", "a.md");
    fs.writeFileSync(docPath, fs.readFileSync(docPath, "utf8").replace("inspect the repository", "inspect the whole repository"));
    const docBefore = fs.readFileSync(docPath, "utf8");
    // A concurrent writer replaces the index after the scoped plan merged with it.
    const concurrentBytes = `${fs.readFileSync(path.join(root, INDEX), "utf8")}{"concurrent":true}\n`;
    hook.afterPlan = (planRoot) => {
      fs.writeFileSync(path.join(planRoot, INDEX), concurrentBytes);
    };

    await expect(runApplyAsync(config(root, "docs/**/*.md"))).rejects.toThrow(/TRANSACTION_PLAN_STALE|TRANSACTION_CONCURRENT_DRIFT/);
    expect(fs.readFileSync(path.join(root, INDEX), "utf8")).toBe(concurrentBytes);
    expect(fs.readFileSync(docPath, "utf8")).toBe(docBefore);
  });
});
