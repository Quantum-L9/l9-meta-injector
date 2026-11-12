import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { runApplyAsync } from "../src/apply";
import { parseAuthorityYaml } from "../src/authority";
import { planCarrierOperationAsync } from "../src/carrier_operation";
import { runCheckAsync } from "../src/check";
import {
  hasCommentCarrierFamily,
  hasInjectedBlock,
  resolveStrategy,
  stripInjectedBlock,
} from "../src/comment";
import { canTraverseHiddenControl, explicitHiddenControlPattern } from "../src/hidden_control";
import { parseMetadataIndex } from "../src/metadata_index";
import type { AuthorityConfig, CarrierDecision } from "../src/operation_contracts";
import { discoverFiles } from "../src/retrieval";
import type { PipelineConfig } from "../src/schema";
import * as verifier from "../src/verify";
import { verify } from "../src/verify";

const roots: string[] = [];
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function write(root: string, name: string, bytes: string | Buffer): void {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function repo(
  allow: string[] = ["**"],
  exclude?: string[],
): { root: string; authority: AuthorityConfig; config: PipelineConfig & { dryRun: true } } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-format-safe-"));
  roots.push(root);
  const text = [
    "schema: l9.meta-authority/v1",
    "writer:",
    "  repository: Quantum-L9/l9-meta-injector",
    "  ref: v4.3.0",
    "default_carrier: central_manifest",
    "legacy_writers: migration_only",
    `inline_allow: ${JSON.stringify(allow)}`,
    ...(exclude ? [`inline_exclude: ${JSON.stringify(exclude)}`] : []),
    "",
  ].join("\n");
  write(root, ".l9/meta-authority.yaml", text);
  return {
    root,
    authority: parseAuthorityYaml(text),
    config: {
      root,
      glob: "**",
      dryRun: true,
      outDir: `${root}.out`,
      indexDir: `${root}.out`,
      authority: "Example/product",
      namespace: "example",
      nearDupThreshold: 0.9,
      hashPrefixLength: 16,
      verbose: false,
      llmEnabled: false,
      normalizeFilenames: false,
      persistOutputs: false,
    },
  };
}

function decision(
  decisions: readonly CarrierDecision[] | undefined,
  name: string,
): CarrierDecision {
  const found = decisions?.find((item) => item.path === name);
  expect(found, `missing decision for ${name}`).toBeDefined();
  return found!;
}

async function stable(config: PipelineConfig & { dryRun: true }): Promise<void> {
  const root = config.root;
  const indexBefore = fs.readFileSync(path.join(root, ".l9/metadata-index.jsonl"));
  const repeat = await runApplyAsync({ ...config, dryRun: false });
  expect(repeat.passed).toBe(true);
  expect(repeat.repositoryMutated).toBe(false);
  expect(repeat.apply?.transaction.plannedWrites).toBe(0);
  expect(fs.readFileSync(path.join(root, ".l9/metadata-index.jsonl"))).toEqual(indexBefore);
  const checked = await runCheckAsync(config);
  expect(checked.passed).toBe(true);
  expect(checked.check?.drift).toEqual([]);
  expect(checked.repositoryMutated).toBe(false);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.out`, { recursive: true, force: true });
  }
});

describe("governed format-safe inline carriers", () => {
  test.each([
    ["src/start.s", ".text\n.globl main\nmain:\n  ret\n"],
    ["src/start.S", "; assembler-looking comment\nmov eax, 1\n"],
    ["src/main.m", "#import <Foundation/Foundation.h>\nint main(void) { return 0; }\n"],
    ["src/main.M", "% MATLAB-looking comment\nx = 1;\n"],
  ])("ambiguous dialect %s has no filename-only comment carrier", (name, body) => {
    expect(resolveStrategy(name, body)).toEqual({ strategy: "sidecar" });
    expect(hasCommentCarrierFamily(name)).toBe(false);
    expect(hasCommentCarrierFamily(name, "line-comment")).toBe(false);
    expect(hasCommentCarrierFamily(name, "block-comment")).toBe(false);
  });

  test.each([
    ["src/main.asm", ";"],
    ["docs/main.tex", "%"],
    ["src/main.erl", "%"],
  ])("retains the accepted comment family for %s", (name, prefix) => {
    expect(resolveStrategy(name, "")).toEqual({ strategy: "line-comment", linePrefix: prefix });
    expect(hasCommentCarrierFamily(name)).toBe(true);
    expect(hasCommentCarrierFamily(name, "line-comment")).toBe(true);
    expect(hasCommentCarrierFamily(name, "block-comment")).toBe(false);
  });

  test.each([["**"], ["src/*.s", "src/*.m"]])(
    "allow %j leaves ambiguous dialect bytes centrally managed",
    async (...allow) => {
      const { root, config } = repo(allow);
      const bodies = {
        "src/start.s": ".text\n.globl main\nmain:\n  ret\n",
        "src/main.m": "#import <Foundation/Foundation.h>\nint main(void) { return 0; }\n",
      };
      for (const [name, body] of Object.entries(bodies)) write(root, name, body);
      const result = await runApplyAsync({ ...config, dryRun: false });
      expect(result.passed).toBe(true);
      expect(result.apply?.inlineChanged).toEqual([]);
      for (const [name, body] of Object.entries(bodies)) {
        expect(decision(result.apply?.carrierDecisions, name).carrier).toBe("central_manifest");
        expect(fs.readFileSync(path.join(root, name), "utf8")).toBe(body);
        expect(fs.existsSync(path.join(root, `${name}.l9meta.yaml`))).toBe(false);
      }
      const records = parseMetadataIndex(
        fs.readFileSync(path.join(root, ".l9/metadata-index.jsonl"), "utf8"),
      );
      expect(records.map((item) => item.path).sort()).toEqual(Object.keys(bodies).sort());
      await stable(config);
    },
  );

  test("applies the canonical plan transactionally with body/prologue/BOM/CRLF fidelity", async () => {
    const { root, authority, config } = repo();
    const bodies = {
      "src/main.ts": "\uFEFF#!/usr/bin/env node\r\nexport const answer = 42;\r\n",
      "tests/check.py":
        "#!/usr/bin/env python3\r\n# coding: utf-8\r\ndef test_answer():\r\n    assert 42 == 42\r\n",
      "scripts/run.sh": "#!/bin/sh\nset -eu\necho ok\n",
      "scripts/only-shebang.sh": "#!/bin/sh",
      "config/app.toml": "[app]\nname = 'example'\n",
      "config/tool.ini": "[settings]\nmode=check\n",
      "automation/tasks.yaml": "---\ntasks:\n  - lint\n",
      "web/main.css": '@charset "UTF-8";\r\nbody { color: red; }\r\n',
      "web/page.html": "<!doctype html>\n<html><body>Example</body></html>\n",
      "config/app.xml": '\uFEFF<?xml version="1.0"?>\r\n<app name="example"/>\r\n',
      "src/server.php": "<?php\necho 42;\n",
      Dockerfile: "# syntax=docker/dockerfile:1\n# escape=\\\nFROM scratch\n",
    };
    for (const [name, body] of Object.entries(bodies)) write(root, name, body);
    fs.chmodSync(path.join(root, "scripts/run.sh"), 0o755);
    const before = await runCheckAsync(config);
    expect(before.passed).toBe(false);
    expect(before.repositoryMutated).toBe(false);
    const plan = await planCarrierOperationAsync({ mode: "apply", authority, config });
    expect(plan.inlinePlans).toHaveLength(Object.keys(bodies).length);
    const result = await runApplyAsync({ ...config, dryRun: false });
    expect(result.passed).toBe(true);
    expect(result.apply?.inlineChanged.sort()).toEqual(Object.keys(bodies).sort());
    expect(result.apply?.transaction.committedWrites).toBe(Object.keys(bodies).length + 1);
    for (const record of plan.inlinePlans) {
      const name = path.relative(root, record.sourcePath);
      const bytes = fs.readFileSync(record.sourcePath);
      const text = bytes.toString("utf8");
      const spec = resolveStrategy(record.sourcePath, text);
      expect(sha(bytes)).toBe(record.expectedContentHash);
      expect(hasInjectedBlock(text, spec)).toBe(true);
      expect(stripInjectedBlock(text, spec)).toBe(bodies[name as keyof typeof bodies]);
      expect(verify(record.sourcePath, record.originalBodyHash, record.meta).issues).toEqual([]);
      expect(fs.existsSync(`${record.sourcePath}.l9meta.yaml`)).toBe(false);
      if (bodies[name as keyof typeof bodies].includes("\r\n"))
        expect(text).not.toMatch(/(?<!\r)\n/);
    }
    expect(fs.readFileSync(path.join(root, "src/main.ts"), "utf8")).toMatch(
      /^\uFEFF#![^\n]+\r\n\/\/ >>>/,
    );
    expect(fs.readFileSync(path.join(root, "tests/check.py"), "utf8")).toMatch(
      /^#![^\n]+\r\n# coding: utf-8\r\n# >>>/,
    );
    expect(fs.readFileSync(path.join(root, "web/main.css"), "utf8")).toMatch(
      /^@charset "UTF-8";\r\n\/\* l9:meta:start/,
    );
    expect(fs.statSync(path.join(root, "scripts/run.sh")).mode & 0o777).toBe(0o755);
    await stable(config);
  });

  test("default central placement stays unchanged without opt-in", async () => {
    const { root, config } = repo([]);
    write(root, "src/main.ts", "export const answer = 42;\n");
    write(root, "config/app.yaml", "name: example\n");
    const result = await runApplyAsync({ ...config, dryRun: false });
    expect(result.passed).toBe(true);
    expect(result.apply?.inlineChanged).toEqual([]);
    expect(
      result.apply?.carrierDecisions.every((item) => item.carrier === "central_manifest"),
    ).toBe(true);
    expect(fs.readFileSync(path.join(root, "src/main.ts"), "utf8")).toBe(
      "export const answer = 42;\n",
    );
    await stable(config);
  });

  test("fixtures, golden payloads, datasets, generated files, locks, JSON and unsafe PHP keep their bytes", async () => {
    const { root, config } = repo(["**"], ["tests/sensitive.py"]);
    const protectedBodies = {
      "tests/fixtures/input.py": "print('fixture')\n",
      "tests/fixture/input.yaml": "expected: value\n",
      "tests/golden_tests/expected.css": "body {}\n",
      "datasets/training.py": "value = 1\n",
      "src/generated/client.ts": "export const generated = 1;\n",
      "packages/pkg/vendor/lib.py": "print(1)\n",
      "pnpm-lock.yaml": "lockfileVersion: 9\n",
      "public/app.min.js": "const a=1;",
      "src/client.generated.ts": "export const generated = 2;\n",
      "public/app.js.map": "{}\n",
      "package.json": '{"name":"example"}\n',
      "data/events.jsonl": '{"event":"ok"}\n',
      "notes.txt": "plain bytes\n",
      "src/template.php": "<?php echo 42; ?>\n",
      "tests/sensitive.py": "def test_bytes():\n    assert True\n",
      "skills/check/SKILL.md": "---\nname: check\n\nno closing fence\n",
      "asset.bin": Buffer.from([0, 1, 2]),
      ".env": "TOKEN=private\n",
      ".git/config": "[core]\n",
      ".l9/private.yaml": "private: state\n",
      "node_modules/pkg/main.js": "module.exports = 1;\n",
    };
    for (const [name, bytes] of Object.entries(protectedBodies)) write(root, name, bytes);
    write(root, "tests/test_fixture.py", "def test_fixture():\n    assert True\n");
    const result = await runApplyAsync({ ...config, dryRun: false });
    expect(result.passed).toBe(true);
    expect(result.apply?.inlineChanged).toEqual(["tests/test_fixture.py"]);
    for (const [name, bytes] of Object.entries(protectedBodies)) {
      expect(fs.readFileSync(path.join(root, name))).toEqual(
        Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
      );
      expect(fs.existsSync(path.join(root, `${name}.l9meta.yaml`))).toBe(false);
    }
    for (const name of [
      "tests/fixtures/input.py",
      "tests/golden_tests/expected.css",
      "datasets/training.py",
      "package.json",
      "data/events.jsonl",
      "notes.txt",
      "src/template.php",
    ]) {
      expect(decision(result.apply?.carrierDecisions, name).carrier).toBe("central_manifest");
    }
    for (const name of [
      "src/generated/client.ts",
      "packages/pkg/vendor/lib.py",
      "pnpm-lock.yaml",
      "src/client.generated.ts",
    ]) {
      expect(decision(result.apply?.carrierDecisions, name).carrier).toBe("inventory_only");
    }
    expect(decision(result.apply?.carrierDecisions, "tests/sensitive.py").authorityRule).toBe(
      "inline_exclude:tests/sensitive.py",
    );
    const records = parseMetadataIndex(
      fs.readFileSync(path.join(root, ".l9/metadata-index.jsonl"), "utf8"),
    );
    expect(records.map((item) => item.path)).toContain("tests/fixtures/input.py");
    expect(records.map((item) => item.path)).not.toContain("node_modules/pkg/main.js");
    await stable(config);
  });

  test("a malformed explicitly authorized header still holds the whole apply before comment writes", async () => {
    const { root, config } = repo();
    write(root, "broken.md", "---\ntitle: Broken\n\nno closing fence\n");
    write(root, "src/main.ts", "export const n = 1;\n");
    const checked = await runCheckAsync(config);
    expect(checked.check?.drift).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "broken.md", kind: "conflict" })]),
    );
    const result = await runApplyAsync({ ...config, dryRun: false });
    expect(result.passed).toBe(false);
    expect(result.repositoryMutated).toBe(false);
    expect(fs.readFileSync(path.join(root, "src/main.ts"), "utf8")).toBe("export const n = 1;\n");
    expect(fs.existsSync(path.join(root, ".l9/metadata-index.jsonl"))).toBe(false);
  });

  test("an inline exclusion preserves a malformed header without blocking safe siblings", async () => {
    const { root, config } = repo(["**"], ["broken.md"]);
    const body = "---\ntitle: Broken\n\nno closing fence\n";
    write(root, "broken.md", body);
    write(root, "src/main.ts", "export const n = 1;\n");
    const result = await runApplyAsync({ ...config, dryRun: false });
    expect(result.passed).toBe(true);
    expect(result.apply?.inlineChanged).toEqual(["src/main.ts"]);
    expect(decision(result.apply?.carrierDecisions, "broken.md")).toMatchObject({
      carrier: "central_manifest",
      authorityRule: "inline_exclude:broken.md",
    });
    expect(fs.readFileSync(path.join(root, "broken.md"), "utf8")).toBe(body);
    await stable(config);
  });

  test("explicit comment opt-in never bypasses full-file UTF-8 validation", async () => {
    const { root, config } = repo();
    const bad = Buffer.concat([Buffer.from("# ".padEnd(9000, "a")), Buffer.from([0xe9])]);
    write(root, "src/legacy.py", bad);
    write(root, "src/main.ts", "export const n = 1;\n");
    const checked = await runCheckAsync(config);
    expect(checked.passed).toBe(false);
    expect(checked.check?.discovery.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src/legacy.py", disposition: "unsupported_encoding" }),
      ]),
    );
    const applied = await runApplyAsync({ ...config, dryRun: false });
    expect(applied.passed).toBe(true);
    expect(applied.apply?.inlineChanged).toEqual(["src/main.ts"]);
    expect(applied.apply?.carrierDecisions.map((item) => item.path)).not.toContain("src/legacy.py");
    expect(fs.readFileSync(path.join(root, "src/legacy.py"))).toEqual(bad);
    expect(fs.existsSync(path.join(root, "src/legacy.py.l9meta.yaml"))).toBe(false);
  });

  test("a failed comment postcondition rolls back every carrier and the index", async () => {
    const { root, config } = repo();
    const bodies = {
      "src/main.ts": "export const n = 1;\n",
      "tests/test_main.py": "def test_main():\n    assert True\n",
    };
    for (const [name, body] of Object.entries(bodies)) write(root, name, body);
    const originalVerify = verifier.verify;
    vi.spyOn(verifier, "verify").mockImplementation((file, hash, meta, options) => {
      const result = originalVerify(file, hash, meta, options);
      return options?.skipWrittenBytesChecks
        ? result
        : { ...result, issues: ["synthetic comment postcondition failure"] };
    });
    await expect(runApplyAsync({ ...config, dryRun: false })).rejects.toThrow(
      /APPLY_VERIFICATION_FAILED/,
    );
    for (const [name, body] of Object.entries(bodies))
      expect(fs.readFileSync(path.join(root, name), "utf8")).toBe(body);
    expect(fs.existsSync(path.join(root, ".l9/metadata-index.jsonl"))).toBe(false);
  });
});

describe("governed named hidden controls", () => {
  const controls = {
    ".github/workflows/ci.yml": "name: CI\non: push\njobs: {}\n",
    ".github/CODEOWNERS": "* @example/team\n",
    ".gitignore": "build/\n",
    ".gitattributes": "* text=auto\n",
    ".editorconfig": "root = true\n[*]\nindent_size = 2\n",
    ".pre-commit-config.yaml": "repos: []\n",
    ".env.example": "TOKEN=replace-me\n",
    ".l9metaignore": "# local omit policy\n",
  };

  test.each([["**"], ["**/*"], [".github/**"], [".*"], ["**/.env.*"]])(
    "broad %j never unlocks hidden controls",
    async (pattern) => {
      const { root, config } = repo([pattern]);
      for (const [name, bytes] of Object.entries(controls)) write(root, name, bytes);
      const result = await runApplyAsync({ ...config, dryRun: false });
      expect(result.passed).toBe(true);
      expect(result.apply?.inlineChanged).toEqual([]);
      expect(result.apply?.carrierDecisions).toEqual([]);
      for (const [name, bytes] of Object.entries(controls))
        expect(fs.readFileSync(path.join(root, name), "utf8")).toBe(bytes);
    },
  );

  test("named controls render safely; excluded controls stay discoverable centrally; unknown hidden paths stay closed", async () => {
    const allow = [
      ".github/workflows/**",
      ".github/CODEOWNERS",
      ...Object.keys(controls).filter((name) => !name.startsWith(".github/")),
      ".env",
      ".git/**",
      ".l9/**",
      ".private/**",
    ];
    const { root, config } = repo(allow, [".github/workflows/ci.yml"]);
    for (const [name, bytes] of Object.entries(controls)) write(root, name, bytes);
    const forbidden = {
      ".env": "TOKEN=private\n",
      ".git/config": "[core]\n",
      ".l9/private.yaml": "private: state\n",
      ".private/key": "private bytes\n",
      ".github/actions/action.yml": "name: local\n",
      ".github/workflows/.secret.yml": "private: state\n",
    };
    for (const [name, bytes] of Object.entries(forbidden)) write(root, name, bytes);
    const result = await runApplyAsync({ ...config, dryRun: false });
    expect(result.passed).toBe(true);
    expect(result.apply?.inlineChanged.sort()).toEqual(
      Object.keys(controls)
        .filter((name) => name !== ".github/workflows/ci.yml")
        .sort(),
    );
    expect(decision(result.apply?.carrierDecisions, ".github/workflows/ci.yml")).toMatchObject({
      carrier: "central_manifest",
      authorityRule: "inline_exclude:.github/workflows/ci.yml",
    });
    for (const [name, bytes] of Object.entries(controls)) {
      const text = fs.readFileSync(path.join(root, name), "utf8");
      expect(stripInjectedBlock(text, resolveStrategy(name, text))).toBe(bytes);
    }
    for (const [name, bytes] of Object.entries(forbidden))
      expect(fs.readFileSync(path.join(root, name), "utf8")).toBe(bytes);
    expect(result.apply?.carrierDecisions.map((item) => item.path)).not.toEqual(
      expect.arrayContaining(Object.keys(forbidden)),
    );
    // The standalone discovery API does not acquire hidden admission from its glob.
    expect(discoverFiles(root, ".github/workflows/**").files).toEqual([]);
    await stable(config);
  });

  test.each([
    ["**"],
    ["**/*"],
    ["nested/.github/**"],
    ["nested/.github/workflows/**", "nested/.github/CODEOWNERS"],
    [
      "nested/.github/workflows/ci.yml",
      "nested/.github/workflows/sub/ci.yml",
      "nested/.github/CODEOWNERS",
    ],
    ["**/.github/workflows/**", "**/.github/CODEOWNERS"],
  ])("allow %j never opens nested .github discovery or writes", async (...attempt) => {
    const allow = [
      ...attempt,
      ".github/workflows/**",
      ".github/CODEOWNERS",
      "nested/.gitignore",
      "nested/.env.example",
    ];
    const { root, config } = repo(allow);
    const accepted = {
      ".github/workflows/ci.yml": controls[".github/workflows/ci.yml"],
      ".github/workflows/sub/ci.yml": controls[".github/workflows/ci.yml"],
      ".github/CODEOWNERS": controls[".github/CODEOWNERS"],
      "nested/.gitignore": "build/\n",
      "nested/.env.example": "TOKEN=replace-me\n",
    };
    const forbidden = {
      "nested/.github/workflows/ci.yml": controls[".github/workflows/ci.yml"],
      "nested/.github/workflows/sub/ci.yml": controls[".github/workflows/ci.yml"],
      "nested/.github/CODEOWNERS": controls[".github/CODEOWNERS"],
    };
    for (const [name, body] of Object.entries({ ...accepted, ...forbidden }))
      write(root, name, body);
    for (const name of Object.keys(forbidden))
      expect(explicitHiddenControlPattern(name, allow)).toBeUndefined();
    for (const name of [
      "nested/.github",
      "nested/.github/workflows",
      "nested/.github/workflows/sub",
    ]) {
      expect(canTraverseHiddenControl(name, allow)).toBe(false);
    }
    const discovery = discoverFiles(root, "**", {}, true, allow);
    expect(discovery.files.map((name) => path.relative(root, name)).sort()).toEqual(
      Object.keys(accepted).sort(),
    );
    expect(discovery.summary.entries).toContainEqual(
      expect.objectContaining({ path: "nested/.github", disposition: "hidden_control" }),
    );
    const result = await runApplyAsync({ ...config, dryRun: false });
    expect(result.passed).toBe(true);
    expect(result.apply?.inlineChanged.sort()).toEqual(Object.keys(accepted).sort());
    expect(result.apply?.carrierDecisions.map((item) => item.path).sort()).toEqual(
      Object.keys(accepted).sort(),
    );
    for (const [name, body] of Object.entries(forbidden)) {
      expect(fs.readFileSync(path.join(root, name), "utf8")).toBe(body);
      expect(fs.existsSync(path.join(root, `${name}.l9meta.yaml`))).toBe(false);
    }
    for (const [name, body] of Object.entries(accepted)) {
      const text = fs.readFileSync(path.join(root, name), "utf8");
      expect(hasInjectedBlock(text, resolveStrategy(name, text))).toBe(true);
      expect(stripInjectedBlock(text, resolveStrategy(name, text))).toBe(body);
    }
    await stable(config);
  });
});
