import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import {
  META_AUTHORITY_RELATIVE_PATH,
  parseAuthorityYaml,
  resolveHeaderIdentity,
  verifySemanticFoundation,
} from "../src/authority";
import { isAuthorityConfig, isSupportedAuthoritySchema } from "../src/operation_contracts";
import { inventoryTree } from "../src/inventory";
import { runPipelineAsync } from "../src/pipeline";

const DIGESTS = {
  "l9.authority-model/global@1": "sha256:ef536f5e233a84fd4a4d24a5fe101e9cf9a78563fafbf1e638faa383208bc451",
  "l9.artifact-model/global@1": "sha256:21f8bb783d7611ae1b3c60474c6ca31f6096f29d7ef0e94ef81f12e6d2defe09",
  "l9.vocabulary/global@1": "sha256:75e146e90e9f3e976c75382a5928d04c18531fa076f4096f8e5c5d4f468b0084",
  "l9.identity-model/global@1": "sha256:b9245eca99501a38976e909e1d151942c1253b2eee2bd6bab9c6382687db4288",
  "l9.product-kinds/global@1": "sha256:6bc39e7376650601570301fe486bdc6f2897fe461321e92c41250f9426688e7d",
  "l9.dependency-archetypes/global@1": "sha256:909db431aa0ccc7668ce3f2dcd46addc26df39c8f3e7303925469b47d6a4617d",
} as const;

function ledgerLines(extra: Record<string, string> = {}): string {
  const all = { ...DIGESTS, ...extra };
  return Object.entries(all).map(([id, digest]) => `    ${id}: ${digest}`).join("\n");
}

function v2Doc(overrides: { ledgers?: string; kind?: string; archetype?: string; revision?: string } = {}): string {
  return `schema: l9.meta-authority/v2
writer:
  repository: Example/product
  ref: v1
default_carrier: central_manifest
legacy_writers: forbidden
inline_allow: []
semantic_foundation:
  repository: Quantum-L9/.github
  revision: ${overrides.revision ?? "31b4f4f699becb1437b4804c308650bbad60c00e"}
  release: v3.6.0
  admission: candidate
  ledgers:
${overrides.ledgers ?? ledgerLines()}
product:
  id: example-product
  owner: Example/product
  kind: ${overrides.kind ?? "dependency"}
  archetype: ${overrides.archetype ?? "l9.dependency-archetype/semantic-subsystem@1"}
`;
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-semauth-"));
}

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

describe("l9.meta-authority/v2 parse", () => {
  test("accepts a complete dependency binding", () => {
    const parsed = parseAuthorityYaml(v2Doc());
    expect(parsed.schema).toBe("l9.meta-authority/v2");
    expect(parsed.product?.id).toBe("example-product");
    expect(parsed.product?.owner).toBe("Example/product");
    expect(isAuthorityConfig(parsed)).toBe(true);
    expect(isSupportedAuthoritySchema("l9.meta-authority/v2")).toBe(true);
  });

  test("rejects a missing required ledger", () => {
    const ledgers = ledgerLines();
    const missing = ledgers.replace(/    l9.vocabulary\/global@1: .*\n/, "");
    expect(() => parseAuthorityYaml(v2Doc({ ledgers: missing }))).toThrow(/META_SEMANTIC_BINDING_INVALID|does not satisfy/);
  });

  test("rejects a malformed digest", () => {
    const ledgers = ledgerLines({ "l9.vocabulary/global@1": "sha256:not-a-digest" });
    expect(() => parseAuthorityYaml(v2Doc({ ledgers }))).toThrow("malformed ledger digest");
  });

  test("rejects a revision that is not 40 hex characters", () => {
    expect(() => parseAuthorityYaml(v2Doc({ revision: "31b4f4f" }))).toThrow(/does not satisfy|META_SEMANTIC_BINDING_INVALID/);
  });

  test("rejects an unadmitted kind", () => {
    expect(() => parseAuthorityYaml(v2Doc({ kind: "sdk", archetype: "Unknown" }))).toThrow(/does not satisfy|META_SEMANTIC_BINDING_INVALID/);
  });

  test("rejects an archetype prefix that does not match kind", () => {
    expect(() => parseAuthorityYaml(v2Doc({
      kind: "dependency",
      archetype: "l9.node-archetype/runnable@1",
    }))).toThrow(/does not satisfy|META_SEMANTIC_BINDING_INVALID/);
  });

  test("v1 documents still parse", () => {
    const v1 = `schema: l9.meta-authority/v1
writer:
  repository: Quantum-L9/l9-meta-injector
  ref: v4.0.0
default_carrier: central_manifest
legacy_writers: forbidden
inline_allow: []
`;
    expect(parseAuthorityYaml(v1).schema).toBe("l9.meta-authority/v1");
  });
});

describe("resolveHeaderIdentity", () => {
  test("bound root derives owner and product id", () => {
    const root = tempRoot();
    write(root, META_AUTHORITY_RELATIVE_PATH, v2Doc());
    const resolved = resolveHeaderIdentity(root, {});
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.source).toBe("semantic_binding");
    expect(resolved.authority).toBe("Example/product");
    expect(resolved.namespace).toBe("example-product");
  });

  test("bound root mismatches a conflicting operator value", () => {
    const root = tempRoot();
    write(root, META_AUTHORITY_RELATIVE_PATH, v2Doc());
    const authority = resolveHeaderIdentity(root, { authority: "other/x" });
    expect(authority.conflicts[0]?.code).toBe("META_AUTHORITY_IDENTITY_MISMATCH");
    const namespace = resolveHeaderIdentity(root, { namespace: "other" });
    expect(namespace.conflicts[0]?.code).toBe("META_AUTHORITY_IDENTITY_MISMATCH");
  });

  test("unbound root requires operator authority", () => {
    const root = tempRoot();
    const missing = resolveHeaderIdentity(root, {});
    expect(missing.conflicts[0]?.code).toBe("META_AUTHORITY_FILE_MISSING");
    const operator = resolveHeaderIdentity(root, { authority: "Operator/repo", unboundNamespaceDefault: "folder" });
    expect(operator.conflicts).toEqual([]);
    expect(operator.authority).toBe("Operator/repo");
    expect(operator.namespace).toBe("folder");
    expect(operator.source).toBe("folder");
  });
});

describe("pipeline and inventory consume the binding", () => {
  test("bound pipeline stamps product identity without --authority", async () => {
    const root = tempRoot();
    write(root, META_AUTHORITY_RELATIVE_PATH, v2Doc());
    write(root, "notes.md", "# Notes\n\nbody\n");
    const result = await runPipelineAsync({
      root,
      glob: "**/*.md",
      dryRun: true,
      outDir: path.join(root, ".out"),
      indexDir: path.join(root, ".out"),
      nearDupThreshold: 0.9,
      hashPrefixLength: 16,
      verbose: false,
      llmEnabled: false,
      normalizeFilenames: false,
    });
    expect(result.injected.length).toBeGreaterThan(0);
    for (const row of result.injected) {
      expect(row.meta.authority).toBe("Example/product");
      expect(row.meta.namespace).toBe("example-product");
    }
  });

  test("bound pipeline-cli accepts a missing --authority and rejects a mismatch", () => {
    const root = tempRoot();
    write(root, META_AUTHORITY_RELATIVE_PATH, v2Doc());
    write(root, "notes.md", "# Notes\n\nbody\n");
    const script = path.join(__dirname, "..", "scripts", "pipeline-cli.js");
    const ok = spawnSync(process.execPath, [script, root, "--dry-run", "--no-fail-on-issues"], { encoding: "utf8" });
    expect(ok.status).toBe(0);
    const bad = spawnSync(process.execPath, [script, root, "--dry-run", "--authority", "other/x"], { encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/META_AUTHORITY_IDENTITY_MISMATCH/);
  });

  test("unbound pipeline still requires authority", async () => {
    const root = tempRoot();
    write(root, "notes.md", "# Notes\n\nbody\n");
    await expect(runPipelineAsync({
      root,
      glob: "**/*.md",
      dryRun: true,
      outDir: path.join(root, ".out"),
      indexDir: path.join(root, ".out"),
      nearDupThreshold: 0.9,
      hashPrefixLength: 16,
      verbose: false,
      llmEnabled: false,
      normalizeFilenames: false,
    })).rejects.toThrow("META_AUTHORITY_FILE_MISSING");
  });

  test("bound pipeline refuses a per-glob namespace override", async () => {
    const root = tempRoot();
    write(root, META_AUTHORITY_RELATIVE_PATH, v2Doc());
    write(root, "notes.md", "# Notes\n\nbody\n");
    await expect(runPipelineAsync({
      root,
      glob: "**/*.md",
      dryRun: true,
      outDir: path.join(root, ".out"),
      indexDir: path.join(root, ".out"),
      nearDupThreshold: 0.9,
      hashPrefixLength: 16,
      verbose: false,
      llmEnabled: false,
      normalizeFilenames: false,
      namespaceGlobs: [{ glob: "**/*.md", namespace: "elsewhere" }],
    })).rejects.toThrow("META_AUTHORITY_IDENTITY_MISMATCH");
  });

  test("bound inventory migrates a previously harvested authority and namespace", () => {
    const root = tempRoot();
    write(root, META_AUTHORITY_RELATIVE_PATH, v2Doc());
    write(root, "stale.py", [
      "# >>> l9:meta >>>",
      "# namespace: foreign-ns",
      "# authority: Other/owner",
      "# <<< l9:meta <<<",
      "print(1)\n",
    ].join("\n"));
    inventoryTree({ root, outDir: path.join(root, ".l9inventory"), dryRun: false });
    const header = fs.readFileSync(path.join(root, "stale.py"), "utf8");
    expect(header).toMatch(/authority:\s*"?Example\/product"?/);
    expect(header).toMatch(/namespace:\s*"?example-product"?/);
    expect(header).not.toContain("Other/owner");
    expect(header).not.toContain("foreign-ns");
  });

  test("bound inventory emits binding values; unbound stays Unknown", () => {
    const bound = tempRoot();
    write(bound, META_AUTHORITY_RELATIVE_PATH, v2Doc());
    write(bound, "notes.md", "# Notes\n\nbody\n");
    const boundOut = path.join(bound, ".l9inventory");
    inventoryTree({ root: bound, outDir: boundOut, dryRun: false });
    const boundHeader = fs.readFileSync(path.join(bound, "notes.md"), "utf8");
    expect(boundHeader).toMatch(/authority:\s*"?Example\/product"?/);
    expect(boundHeader).toMatch(/namespace:\s*"?example-product"?/);

    const unbound = tempRoot();
    write(unbound, "notes.md", "# Notes\n\nbody\n");
    inventoryTree({ root: unbound, outDir: path.join(unbound, ".l9inventory"), dryRun: false });
    const unboundHeader = fs.readFileSync(path.join(unbound, "notes.md"), "utf8");
    expect(unboundHeader).toMatch(/authority:\s*"?Unknown"?/);
    expect(unboundHeader).toMatch(/namespace:\s*"?Unknown"?/);
  });
});

describe("verifySemanticFoundation", () => {
  test("passes synthetic ledgers and fails tamper and wrong HEAD", () => {
    const semantics = tempRoot();
    const dir = path.join(semantics, "semantics");
    fs.mkdirSync(dir);
    const bindingLedgers: Record<string, string> = {};
    for (const id of Object.keys(DIGESTS)) {
      const name = id.split("/")[0].replace("l9.", "") + ".yaml";
      const body = `schema: test\nartifact_id: ${id}\n`;
      fs.writeFileSync(path.join(dir, name), body);
      bindingLedgers[id] = `sha256:${crypto.createHash("sha256").update(body, "utf8").digest("hex")}`;
    }
    const binding = {
      repository: "Quantum-L9/.github",
      revision: "31b4f4f699becb1437b4804c308650bbad60c00e",
      release: "v3.6.0",
      admission: "candidate" as const,
      ledgers: bindingLedgers,
    };
    expect(verifySemanticFoundation(binding, semantics)).toEqual([]);

    const tampered = { ...binding, ledgers: { ...bindingLedgers } };
    const first = Object.keys(tampered.ledgers)[0];
    tampered.ledgers[first] = tampered.ledgers[first].replace(/[0-9a-f]$/, (ch) => (ch === "0" ? "1" : "0"));
    expect(verifySemanticFoundation(tampered, semantics)[0]?.code).toBe("META_SEMANTIC_BINDING_INVALID");

    const checkout = tempRoot();
    spawnSync("git", ["init"], { cwd: checkout, encoding: "utf8" });
    fs.writeFileSync(path.join(checkout, "README.md"), "x\n");
    spawnSync("git", ["add", "README.md"], { cwd: checkout });
    spawnSync("git", ["-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "-m", "init"], { cwd: checkout });
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: checkout, encoding: "utf8" }).stdout.trim();
    expect(head).toHaveLength(40);
    expect(head).not.toBe(binding.revision);
    const cli = spawnSync(process.execPath, [
      path.join(__dirname, "..", "scripts", "semantics-verify.js"),
      "--semantics-root",
      checkout,
    ], { encoding: "utf8" });
    expect(cli.status).toBe(2);
    expect(cli.stderr).toMatch(/does not match bound revision/);
  });
});
