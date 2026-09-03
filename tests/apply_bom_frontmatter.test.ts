import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runApplyAsync } from "../src/apply";
import { runCheckAsync, type CheckConfig } from "../src/check";
import { splitContent, stripExistingFrontMatter } from "../src/extract";

const BOM = "﻿";
const PROMPT = "# Build prompt\n\nRole: repository auditor\nObjective: inspect the repository and report evidence.\nOutput format: markdown report.\n";
const roots: string[] = [];

function governedRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-apply-bom-"));
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

function config(root: string): CheckConfig {
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

describe("a byte-order mark and a CRLF fence line are not content", () => {
  test("header detection looks past a leading BOM", () => {
    const withHeader = `${BOM}---\nname: x\n---\nbody\n`;
    expect(splitContent(withHeader).headerConvention).toBe("full-yaml");
    expect(splitContent(withHeader).body).toBe("body\n");
    expect(stripExistingFrontMatter(`${BOM}---\nname: x\n---\n\nbody\n`)).toBe("body\n");
    expect(splitContent(`${BOM}# plain\n`).headerConvention).toBe("none");
    expect(splitContent("---\nname: x\n---\nbody\n").headerConvention).toBe("full-yaml");
  });

  test("header detection consumes a CRLF fence line without leaving a stray carriage return", () => {
    const crlf = "---\r\nname: x\r\n---\r\n# body\r\nline\r\n";
    expect(splitContent(crlf).headerConvention).toBe("full-yaml");
    expect(splitContent(crlf).body).toBe("# body\r\nline\r\n");
    expect(stripExistingFrontMatter(`---\r\nname: x\r\n---\r\n\r\n# body\r\n`)).toBe("# body\r\n");
  });

  test("a governed apply over a CRLF markdown file leaves the index consistent, so check passes and a second apply is a no-op", async () => {
    const root = governedRoot();
    const crlf = PROMPT.replace(/\n/g, "\r\n");
    fs.writeFileSync(path.join(root, "crlf.md"), crlf);

    const apply = await runApplyAsync({ ...config(root), dryRun: false } as never);
    expect(apply.passed).toBe(true);
    const bytes = fs.readFileSync(path.join(root, "crlf.md"), "utf8");
    expect(bytes.endsWith(crlf)).toBe(true);
    expect(/[^\r]\n/.test(bytes)).toBe(false);

    const check = await runCheckAsync(config(root));
    expect(check.check?.drift).toEqual([]);
    expect(check.passed).toBe(true);

    const index = fs.readFileSync(path.join(root, ".l9", "metadata-index.jsonl"), "utf8");
    const again = await runApplyAsync({ ...config(root), dryRun: false } as never);
    expect(again.repositoryMutated).toBe(false);
    expect(fs.readFileSync(path.join(root, ".l9", "metadata-index.jsonl"), "utf8")).toBe(index);
  });

  test("a governed apply over a BOM-prefixed markdown file commits, keeps the BOM at byte 0, and re-checks clean", async () => {
    const root = governedRoot();
    fs.writeFileSync(path.join(root, "bom.md"), BOM + PROMPT);
    fs.writeFileSync(path.join(root, "plain.md"), PROMPT);

    const apply = await runApplyAsync({ ...config(root), dryRun: false } as never);
    expect(apply.passed).toBe(true);
    expect(apply.apply?.inlineChanged).toEqual(["bom.md", "plain.md"]);
    expect(apply.apply?.transaction.rolledBack).toBe(false);

    const bytes = fs.readFileSync(path.join(root, "bom.md"), "utf8");
    expect(bytes.startsWith(`${BOM}---\n`)).toBe(true);
    expect(bytes.indexOf(BOM, 1)).toBe(-1);
    expect(bytes.endsWith(PROMPT)).toBe(true);

    const check = await runCheckAsync(config(root));
    expect(check.passed).toBe(true);
    expect(check.check?.drift).toEqual([]);

    const again = await runApplyAsync({ ...config(root), dryRun: false } as never);
    expect(again.repositoryMutated).toBe(false);
    expect(fs.readFileSync(path.join(root, "bom.md"), "utf8")).toBe(bytes);
  });
});
