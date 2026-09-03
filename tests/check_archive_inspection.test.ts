import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runCheckAsync, type CheckConfig } from "../src/check";
import { writeRawZip } from "./helpers/zip_fixtures";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-check-archive-"));
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
    localFiles: true,
    persistOutputs: false,
  };
}

function treeDigest(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      hash.update(`${path.relative(root, full)}:${stat.mode}:`);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) hash.update(fs.readFileSync(full));
    }
  };
  walk(root);
  return hash.digest("hex");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.out`, { recursive: true, force: true });
  }
});

describe("governed check reports every archive read-only instead of throwing", () => {
  test("a ZIP with an escaping member path is drift with the reason, and nothing is written", async () => {
    const root = tempRoot();
    writeRawZip(path.join(root, "hostile.zip"), [{ name: "../escape.txt", content: "x" }]);
    const before = treeDigest(root);
    const result = await runCheckAsync(config(root));
    expect(result.passed).toBe(false);
    const drift = result.check?.drift.find((item) => item.path === "hostile.zip");
    expect(drift?.kind).toBe("unsupported");
    expect(drift?.message).toMatch(/could not be inspected read-only: .*unsafe zip member path/);
    expect(treeDigest(root)).toBe(before);
  });

  test("bytes that are not a ZIP under a .zip name are drift, not a crash", async () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, "broken.zip"), Buffer.from("not a zip archive"));
    const result = await runCheckAsync(config(root));
    const drift = result.check?.drift.find((item) => item.path === "broken.zip");
    expect(drift?.kind).toBe("unsupported");
    expect(drift?.message).toMatch(/could not be inspected read-only/);
  });

  test("a tarball is reported by name and never opened", async () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, "vendor"));
    fs.writeFileSync(path.join(root, "vendor", "bundle.tar.gz"), Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0]));
    fs.writeFileSync(path.join(root, "plain.tar"), Buffer.alloc(1024));
    const before = treeDigest(root);
    const result = await runCheckAsync(config(root));
    const paths = result.check?.drift.filter((item) => item.kind === "unsupported").map((item) => item.path);
    expect(paths).toEqual(expect.arrayContaining(["plain.tar", "vendor/bundle.tar.gz"]));
    for (const item of result.check?.drift ?? []) {
      if (item.path.endsWith(".tar") || item.path.endsWith(".tar.gz")) expect(item.message).toMatch(/never expanded/);
    }
    expect(treeDigest(root)).toBe(before);
  });

  test("a well-formed ZIP is still listed read-only", async () => {
    const root = tempRoot();
    writeRawZip(path.join(root, "fine.zip"), [{ name: "a.txt", content: "a" }, { name: "b.txt", content: "b" }]);
    const result = await runCheckAsync(config(root));
    const drift = result.check?.drift.find((item) => item.path === "fine.zip");
    expect(drift?.message).toMatch(/inspected read-only \(2 member\(s\)\)/);
    expect(fs.existsSync(path.join(root, "fine.l9extracted"))).toBe(false);
  });
});
