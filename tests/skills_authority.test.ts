// skills_authority.test.ts — REA-001 remediation (ADR-030 / INV-018).
// Proves the governed skills entrypoint fails closed without repository authority
// and, when authorized, commits SKILL.md changes only through the transaction
// boundary. The direct package API is exercised because callers can reach
// runSkillsPipelineAsync without the CLI/action wrappers.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runSkillsPipelineAsync, type SkillsPipelineConfig } from "../src/skills_pipeline";
import { setAdapter, resetAdapter } from "../src/llm";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-skills-auth-"));
  roots.push(root);
  return root;
}

function writeAuthority(root: string, repository = "Quantum-L9/l9-meta-injector"): void {
  fs.mkdirSync(path.join(root, ".l9"), { recursive: true });
  fs.writeFileSync(path.join(root, ".l9", "meta-authority.yaml"), [
    "schema: l9.meta-authority/v1",
    "writer:",
    `  repository: ${repository}`,
    "  ref: v4.0.0",
    "default_carrier: central_manifest",
    "legacy_writers: forbidden",
    "inline_allow: [\"**/*.md\"]",
    "",
  ].join("\n"));
}

/** A weak SKILL.md the pipeline will want to improve. Returns its absolute path. */
function writeWeakSkill(root: string, name: string): string {
  const dir = path.join(root, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  const skillPath = path.join(dir, "SKILL.md");
  fs.writeFileSync(skillPath, `---\nname: ${name}\ndescription: Reviews stuff\n---\n\n# ${name}\n\nCheck things carefully.\n`);
  return skillPath;
}

/** Deterministic assist adapter that yields a strong "Use when …" description. */
function useAssistAdapter(): void {
  setAdapter({
    estimateTokens: (t) => Math.ceil(t.length / 4),
    classify: async (prompt: string) => {
      if (prompt.includes("materially more informative")) return "yes";
      if (prompt.includes("Cursor Agent Skill description")) {
        return "Reviews pull requests for quality. Use when reviewing PRs, code changes, or when the user asks for a code review.";
      }
      if (prompt.includes("trigger phrases")) return "code review, pull request, PR review";
      return null;
    },
  });
}

function baseConfig(root: string, out: string): SkillsPipelineConfig {
  return {
    root,
    authority: "l9.doctrine.platform",
    outDir: out,
    dryRun: false,
    verbose: false,
    llmEnabled: true,
  };
}

afterEach(() => {
  resetAdapter();
  while (roots.length) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("skills mode repository-authority enforcement", () => {
  test("missing authority fails closed: no discovery, no mutation, bytes unchanged", async () => {
    useAssistAdapter();
    const root = tempRoot();
    const skillPath = writeWeakSkill(root, "review");
    const before = fs.readFileSync(skillPath);
    // No .l9/meta-authority.yaml is written.

    const result = await runSkillsPipelineAsync(baseConfig(root, tempRoot()));

    expect(result.authorityResolved).toBe(false);
    expect(result.repositoryMutated).toBe(false);
    expect(result.authorityConflicts.length).toBeGreaterThan(0);
    expect(result.authorityConflicts[0].code).toBe("META_AUTHORITY_FILE_MISSING");
    expect(result.considered).toBe(0);
    expect(result.changed).toBe(0);
    expect(fs.readFileSync(skillPath)).toEqual(before); // protected bytes unchanged
  });

  test("conflicting writer authority fails closed: no mutation, bytes unchanged", async () => {
    useAssistAdapter();
    const root = tempRoot();
    const skillPath = writeWeakSkill(root, "review");
    const before = fs.readFileSync(skillPath);
    writeAuthority(root, "SomeoneElse/other-writer"); // writer mismatch vs canonical

    const result = await runSkillsPipelineAsync(baseConfig(root, tempRoot()));

    expect(result.authorityResolved).toBe(false);
    expect(result.repositoryMutated).toBe(false);
    expect(result.authorityConflicts.some((c) => c.code === "META_AUTHORITY_WRITER_MISMATCH")).toBe(true);
    expect(fs.readFileSync(skillPath)).toEqual(before);
  });

  test("valid authority commits the planned SKILL change and leaves siblings untouched", async () => {
    useAssistAdapter();
    const root = tempRoot();
    const skillPath = writeWeakSkill(root, "review");
    const sibling = path.join(root, "README.md");
    fs.writeFileSync(sibling, "# readme\n");
    const siblingBefore = fs.readFileSync(sibling);
    writeAuthority(root);

    const result = await runSkillsPipelineAsync(baseConfig(root, tempRoot()));

    expect(result.authorityResolved).toBe(true);
    expect(result.repositoryMutated).toBe(true);
    expect(result.considered).toBe(1);
    expect(result.changed).toBe(1);
    const patched = fs.readFileSync(skillPath, "utf8");
    expect(patched).toMatch(/Use when/i);
    expect(patched).toContain("name: review");
    expect(patched).toContain("activation_signals:");
    // Only the authorized skill entrypoint is a protected target.
    expect(fs.readFileSync(sibling)).toEqual(siblingBefore);
  });

  test("valid authority commits a multi-file skills transaction", async () => {
    useAssistAdapter();
    const root = tempRoot();
    const a = writeWeakSkill(root, "alpha");
    const b = writeWeakSkill(root, "bravo");
    writeAuthority(root);

    const result = await runSkillsPipelineAsync(baseConfig(root, tempRoot()));

    expect(result.authorityResolved).toBe(true);
    expect(result.repositoryMutated).toBe(true);
    expect(result.considered).toBe(2);
    expect(result.changed).toBe(2);
    expect(fs.readFileSync(a, "utf8")).toMatch(/Use when/i);
    expect(fs.readFileSync(b, "utf8")).toMatch(/Use when/i);
  });

  test("dry-run previews without authority and never mutates (semantics unchanged)", async () => {
    useAssistAdapter();
    const root = tempRoot();
    const skillPath = writeWeakSkill(root, "review");
    const before = fs.readFileSync(skillPath);
    // No authority; dry-run is a read-only preview.

    const result = await runSkillsPipelineAsync({ ...baseConfig(root, tempRoot()), dryRun: true });

    expect(result.authorityResolved).toBe(true); // dry-run does not fail closed
    expect(result.repositoryMutated).toBe(false);
    expect(result.considered).toBe(1);
    expect(result.changed).toBe(1); // change is reported…
    expect(fs.readFileSync(skillPath)).toEqual(before); // …but nothing is written
  });

  test("valid authority with an already-strong description commits nothing", async () => {
    useAssistAdapter();
    const root = tempRoot();
    const dir = path.join(root, "skills", "ok");
    fs.mkdirSync(dir, { recursive: true });
    const skillPath = path.join(dir, "SKILL.md");
    const original = "---\nname: ok\ndescription: Handles omit rules carefully. Use when editing omit patterns or SKILL.md protect behavior.\nactivation_signals:\n  - omit rules\n---\n\n# Ok\n";
    fs.writeFileSync(skillPath, original);
    writeAuthority(root);

    const result = await runSkillsPipelineAsync(baseConfig(root, tempRoot()));

    expect(result.authorityResolved).toBe(true);
    expect(result.repositoryMutated).toBe(false);
    expect(result.changed).toBe(0);
    expect(fs.readFileSync(skillPath, "utf8")).toBe(original);
  });
});
