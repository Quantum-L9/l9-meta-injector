import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runCheckAsync, type CheckConfig } from "../src/check";
import { runApplyAsync } from "../src/apply";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-check-test-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, ".l9"), { recursive: true });
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
  fs.writeFileSync(path.join(root, "prompt.md"), [
    "# Build prompt",
    "",
    "Role: repository auditor",
    "Objective: inspect the repository and report evidence.",
    "Output format: markdown report.",
    "",
  ].join("\n"));
  return root;
}

function config(root: string, localFiles = false): CheckConfig {
  const external = `${root}.out`;
  return {
    root,
    glob: "**/*.md",
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
    localFiles,
    persistOutputs: false,
  };
}

function treeHash(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      hash.update(`${entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "f"}:${rel}\0`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isSymbolicLink()) hash.update(fs.readlinkSync(full));
      else hash.update(fs.readFileSync(full));
    }
  };
  walk(root);
  return hash.digest("hex");
}

async function seedCanonicalMetadata(root: string): Promise<void> {
  // Seed via the apply operation: it is the canonical writer that materializes
  // both the inline frontmatter and the central `.l9/metadata-index.jsonl` the
  // read-only check validates. The legacy pipeline never writes that index.
  const cfg = config(root);
  await runApplyAsync({ ...cfg, dryRun: false, persistOutputs: true });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.out`, { recursive: true, force: true });
  }
});

describe("read-only check", () => {
  test("reports missing canonical metadata without changing repository bytes", async () => {
    const root = tempRoot();
    const before = treeHash(root);
    const result = await runCheckAsync(config(root));
    expect(result.mode).toBe("check");
    expect(result.check?.passed).toBe(false);
    expect(result.check?.drift.some((item) => item.kind === "missing")).toBe(true);
    expect(treeHash(root)).toBe(before);
    expect(fs.existsSync(`${root}.out`)).toBe(false);
  });

  test("passes a canonical repository and remains byte-for-byte read-only", async () => {
    const root = tempRoot();
    await seedCanonicalMetadata(root);
    const before = treeHash(root);
    const result = await runCheckAsync(config(root));
    expect(result.check?.passed).toBe(true);
    expect(result.check?.drift).toEqual([]);
    expect(treeHash(root)).toBe(before);
  });

  test("reports stale metadata when a canonical field is removed", async () => {
    const root = tempRoot();
    await seedCanonicalMetadata(root);
    const promptPath = path.join(root, "prompt.md");
    const damaged = fs.readFileSync(promptPath, "utf8").replace(/^content_hash:.*\n/m, "");
    fs.writeFileSync(promptPath, damaged, "utf8");
    const before = treeHash(root);
    const result = await runCheckAsync(config(root));
    expect(result.check?.passed).toBe(false);
    expect(result.check?.drift.some((item) => item.kind === "stale")).toBe(true);
    expect(treeHash(root)).toBe(before);
  });

  test("inspects local-file archives without extracting them", async () => {
    const root = tempRoot();
    const zip = Buffer.from(
      "UEsDBAoAAAAAAAR5AV11g/EGDgAAAA4AAAAFABwAYS50eHRVVAkAA9gLbmrYC25qdXgLAAEEAAAAAAQAAAAAaGVsbG8gYXJjaGl2ZQpQSwECHgMKAAAAAAAEeQFddYPxBg4AAAAOAAAABQAYAAAAAAABAAAApIEAAAAAYS50eHRVVAUAA9gLbmp1eAsAAQQAAAAABAAAAABQSwUGAAAAAAEAAQBLAAAATQAAAAAA",
      "base64",
    );
    fs.writeFileSync(path.join(root, "fixture.zip"), zip);
    const before = treeHash(root);
    const result = await runCheckAsync(config(root, true));
    expect(result.check?.drift.some((item) => item.kind === "unsupported" && item.path === "fixture.zip")).toBe(true);
    expect(fs.existsSync(path.join(root, "fixture.l9extracted"))).toBe(false);
    expect(fs.existsSync(path.join(root, "fixture.zip.l9meta.yaml"))).toBe(false);
    expect(treeHash(root)).toBe(before);
  });
});
