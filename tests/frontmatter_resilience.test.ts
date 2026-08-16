/**
 * Frontmatter adoption resilience (finding F-6).
 *
 * Valid-but-unsupported frontmatter used to throw `FRONTMATTER_UNSAFE` out of the
 * injection loop, which aborted the entire repository operation over a single file the
 * byte-preserving patcher was never going to rewrite. A mature repository could then only
 * be adopted by editing its own sources or by hand-omitting paths.
 *
 * The contract now is: preserve the bytes, do not inline-patch, carry the metadata in the
 * central manifest, say exactly why, and keep going.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runApplyAsync } from "../src/apply";
import { runCheckAsync, type CheckConfig } from "../src/check";
import { inspectFrontMatterDocument, patchManagedFrontMatter } from "../src/frontmatter_patch";
import type { CarrierDecision } from "../src/operation_contracts";

const roots: string[] = [];

// The exact shape from the qualification report: a valid ISO timestamp that the canonical
// scalar grammar declines because it contains colons.
const ISO_TIMESTAMP_DOC = `---
title: Runbook
created: 2025-10-28T15:30:00Z
owner: platform
---

# Runbook

Body text that must survive untouched.
`;

// Structurally richer YAML: a nested map the patcher must never normalize or reorder.
const NESTED_MAP_DOC = `---
title: Service
limits:
  cpu: 2
  memory: 4Gi
---

# Service

Body text.
`;

const PLAIN_DOC = `# Guide

Ordinary prose with no frontmatter at all.
`;

function authority(inlineAllow: string): string {
  return [
    "schema: l9.meta-authority/v1",
    "writer:",
    "  repository: Quantum-L9/l9-meta-injector",
    "  ref: v4.0.0",
    "default_carrier: inline_managed",
    "legacy_writers: migration_only",
    `inline_allow: [${inlineAllow}]`,
    "",
  ].join("\n");
}

function tempRoot(inlineAllow = '"**/*.md"'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-fm-resilience-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, ".l9"), { recursive: true });
  fs.writeFileSync(path.join(root, ".l9", "meta-authority.yaml"), authority(inlineAllow), "utf8");
  return root;
}

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
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

function treeHash(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      hash.update(`${entry.isDirectory() ? "d" : "f"}:${path.relative(root, full)}\0`);
      if (entry.isDirectory()) walk(full);
      else hash.update(fs.readFileSync(full));
    }
  };
  walk(root);
  return hash.digest("hex");
}

function decisionFor(decisions: readonly CarrierDecision[], target: string): CarrierDecision {
  const found = decisions.find((item) => item.path === target);
  expect(found, `no carrier decision for ${target}`).toBeDefined();
  return found as CarrierDecision;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.out`, { recursive: true, force: true });
  }
});

describe("an unquoted ISO timestamp is preserved, not fatal", () => {
  test("the value is carried as an opaque scalar rather than failing inspection", () => {
    const inspected = inspectFrontMatterDocument(ISO_TIMESTAMP_DOC);
    expect(inspected.safe).toBe(true);
    const created = inspected.fields.find((field) => field.key === "created");
    expect(created?.kind).toBe("opaque");
    // Opaque means "bytes known, meaning not established" — so it never enters `meta`.
    expect(Object.hasOwn(inspected.meta, "created")).toBe(false);
    expect(inspected.meta.title).toBe("Runbook");
  });

  test("patching unrelated managed fields leaves the timestamp byte-identical", () => {
    const patched = patchManagedFrontMatter(ISO_TIMESTAMP_DOC, { id: "artifact-1", artifact_type: "prompt" });
    expect(patched.safe).toBe(true);
    expect(patched.content).toContain("created: 2025-10-28T15:30:00Z");
    expect(patched.content).toContain('id: "artifact-1"');
    expect(patched.body).toBe(inspectFrontMatterDocument(ISO_TIMESTAMP_DOC).body);
  });

  test("apply completes over a repository containing one", async () => {
    const root = tempRoot();
    write(root, "runbook.md", ISO_TIMESTAMP_DOC);
    const result = await runApplyAsync(config(root));
    expect(result.passed).toBe(true);
    expect(fs.readFileSync(path.join(root, "runbook.md"), "utf8")).toContain("created: 2025-10-28T15:30:00Z");
  });
});

describe("complex frontmatter falls back instead of aborting", () => {
  test("apply continues for every other file in the repository", async () => {
    const root = tempRoot();
    write(root, "service.md", NESTED_MAP_DOC);
    write(root, "guide.md", PLAIN_DOC);
    write(root, "docs/runbook.md", ISO_TIMESTAMP_DOC);

    const before = fs.readFileSync(path.join(root, "service.md"), "utf8");
    const result = await runApplyAsync(config(root));

    expect(result.passed).toBe(true);
    expect(result.apply?.authorityConflicts).toEqual([]);
    // The unsupported file kept its bytes ...
    expect(fs.readFileSync(path.join(root, "service.md"), "utf8")).toBe(before);
    // ... while the ordinary file was still inline-patched.
    expect(fs.readFileSync(path.join(root, "guide.md"), "utf8")).toContain("---");
    expect(result.apply?.inlineChanged).toContain("guide.md");
  });

  test("the fallback decision names the file and the exact limitation", async () => {
    const root = tempRoot();
    write(root, "service.md", NESTED_MAP_DOC);
    const result = await runCheckAsync(config(root));
    const decision = decisionFor(result.check?.carrierDecisions ?? [], "service.md");
    expect(decision.carrier).toBe("central_manifest");
    expect(decision.authorityRule).toBe("frontmatter_unsupported:FRONTMATTER_COMPLEX_YAML");
    expect(decision.reason).toContain("source bytes are preserved");
  });

  test("the fallback is deterministic across repeated runs", async () => {
    const root = tempRoot();
    write(root, "service.md", NESTED_MAP_DOC);
    write(root, "guide.md", PLAIN_DOC);
    const first = await runCheckAsync(config(root));
    const second = await runCheckAsync(config(root));
    expect(JSON.stringify(second.check?.carrierDecisions)).toBe(JSON.stringify(first.check?.carrierDecisions));
    expect(JSON.stringify(second.check?.drift)).toBe(JSON.stringify(first.check?.drift));
  });

  test("a second apply writes nothing at all", async () => {
    const root = tempRoot();
    write(root, "service.md", NESTED_MAP_DOC);
    write(root, "guide.md", PLAIN_DOC);
    write(root, "docs/runbook.md", ISO_TIMESTAMP_DOC);

    await runApplyAsync(config(root));
    const afterFirst = treeHash(root);
    const second = await runApplyAsync(config(root));

    expect(second.passed).toBe(true);
    expect(second.apply?.changed).toBe(0);
    expect(second.apply?.transaction.plannedWrites).toBe(0);
    expect(treeHash(root)).toBe(afterFirst);

    const check = await runCheckAsync(config(root));
    expect(check.check?.drift).toEqual([]);
    expect(check.passed).toBe(true);
  });
});

describe("a malformed header under an explicit inline authorization holds", () => {
  const MALFORMED = "---\ntitle: Broken\n\n# No closing fence\n";

  test("apply reports the conflict instead of rewriting the file", async () => {
    const root = tempRoot('"broken.md"');
    write(root, "broken.md", MALFORMED);
    const before = fs.readFileSync(path.join(root, "broken.md"), "utf8");

    const result = await runApplyAsync(config(root));

    expect(result.passed).toBe(false);
    expect(result.repositoryMutated).toBe(false);
    const conflict = result.apply?.authorityConflicts[0];
    expect(conflict?.path).toBe("broken.md");
    expect(conflict?.message).toContain("FRONTMATTER_CLOSING_FENCE_MISSING");
    expect(fs.readFileSync(path.join(root, "broken.md"), "utf8")).toBe(before);
  });

  test("the same file is a plain central-manifest fallback when inline was not authorized", async () => {
    const root = tempRoot('"other/**/*.md"');
    write(root, "broken.md", MALFORMED);
    const before = fs.readFileSync(path.join(root, "broken.md"), "utf8");

    const result = await runApplyAsync(config(root));

    expect(result.passed).toBe(true);
    expect(fs.readFileSync(path.join(root, "broken.md"), "utf8")).toBe(before);
    const decision = decisionFor(result.apply?.carrierDecisions ?? [], "broken.md");
    expect(decision.carrier).toBe("central_manifest");
    expect(decision.unsatisfiedInlineAuthorization).toBeUndefined();
  });
});

describe("protected skill entrypoints", () => {
  test("SKILL.md with complex frontmatter never enters inline mutation planning", async () => {
    const root = tempRoot();
    write(root, "skills/deploy/SKILL.md", NESTED_MAP_DOC);
    write(root, "guide.md", PLAIN_DOC);
    const before = fs.readFileSync(path.join(root, "skills", "deploy", "SKILL.md"), "utf8");

    const result = await runApplyAsync(config(root));

    expect(result.passed).toBe(true);
    expect(fs.readFileSync(path.join(root, "skills", "deploy", "SKILL.md"), "utf8")).toBe(before);
    expect(result.apply?.carrierDecisions.map((item) => item.path)).not.toContain("skills/deploy/SKILL.md");
    expect(result.apply?.inlineChanged).not.toContain("skills/deploy/SKILL.md");
  });
});
