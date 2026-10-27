/**
 * WU-018 — skills dry-run applies the real-run eligibility filter (RC-025 / F-107).
 *
 * processSkillFile returned the dry-run preview before the real run's two filters: the
 * discard of a frontmatter-less SKILL.md that gained no description, and the managed
 * patch's safety verdict. Dry-run therefore reported changes the real run never made.
 * For the same input and adapter both modes must now report the same changed flags,
 * diffs and skippedReason; dry-run still writes nothing and is not authority-gated.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resetAdapter, setAdapter } from "../src/llm";
import { runSkillsPipelineAsync, type SkillsFileResult, type SkillsPipelineConfig } from "../src/skills_pipeline";

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-wu018-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  resetAdapter();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeAuthority(root: string): void {
  fs.mkdirSync(path.join(root, ".l9"), { recursive: true });
  fs.writeFileSync(path.join(root, ".l9", "meta-authority.yaml"), [
    "schema: l9.meta-authority/v1",
    "writer:",
    "  repository: Quantum-L9/l9-meta-injector",
    "  ref: v4.0.0",
    "default_carrier: central_manifest",
    "legacy_writers: forbidden",
    "inline_allow: [\"**/*.md\"]",
    "",
  ].join("\n"));
}

function writeSkill(root: string, name: string, content: string): string {
  const dir = path.join(root, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  const skillPath = path.join(dir, "SKILL.md");
  fs.writeFileSync(skillPath, content);
  return skillPath;
}

const USABLE_DESCRIPTION = "Reviews pull requests for quality. Use when reviewing PRs, code changes, or when the user asks for a code review.";

/** Deterministic adapter: description reply is usable or not; trigger phrases always usable. */
function useAdapter(description: string): void {
  setAdapter({
    estimateTokens: (t) => Math.ceil(t.length / 4),
    classify: async (prompt: string) => {
      if (prompt.includes("materially more informative")) return "yes";
      if (prompt.includes("Cursor Agent Skill description")) return description;
      if (prompt.includes("trigger phrases")) return "code review, pull request, PR review";
      return null;
    },
  });
}

function config(root: string, dryRun: boolean): SkillsPipelineConfig {
  return { root, authority: "l9.auto", dryRun, outDir: `${root}-out-${dryRun ? "dry" : "real"}`, verbose: false, llmEnabled: true };
}

function view(files: SkillsFileResult[]) {
  return files
    .map((f) => ({ relativePath: f.relativePath, changed: f.changed, diffs: f.diffs, skippedReason: f.skippedReason }))
    .sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1));
}

/** Run dry then real over the same tree; return both results and the dry-run tree snapshot. */
async function dryThenReal(root: string) {
  const dry = await runSkillsPipelineAsync(config(root, true));
  const real = await runSkillsPipelineAsync(config(root, false));
  dirs.push(`${root}-out-dry`, `${root}-out-real`);
  return { dry, real };
}

const NO_FRONTMATTER = "# reviewer\n\nCheck things carefully.\n";
const SEQUENCE_DESCRIPTION = "---\nname: lister\ndescription:\n  - reviews stuff\n---\n\n# lister\n\nCheck lists.\n";
const WEAK = "---\nname: weak\ndescription: Reviews stuff\n---\n\n# weak\n\nCheck things carefully.\n";

describe("WU-018 skills dry-run matches the real run", () => {
  test("REG-WU-018-RC-025-a: no frontmatter and an unusable description: neither mode reports a change", async () => {
    const root = tmpDir();
    writeAuthority(root);
    const skill = writeSkill(root, "reviewer", NO_FRONTMATTER);
    useAdapter("x");

    const { dry, real } = await dryThenReal(root);
    expect(dry.changed).toBe(0);
    expect(dry.files[0]?.diffs).toEqual([]);
    expect(real.changed).toBe(0);
    expect(real.files[0]?.diffs).toEqual([]);
    expect(fs.readFileSync(skill, "utf8")).toBe(NO_FRONTMATTER);
  });

  test("REG-WU-018-RC-025-b: an unsafe managed patch is skipped with the same reason in both modes", async () => {
    const root = tmpDir();
    writeAuthority(root);
    const skill = writeSkill(root, "lister", SEQUENCE_DESCRIPTION);
    useAdapter(USABLE_DESCRIPTION);

    const { dry, real } = await dryThenReal(root);
    expect(dry.files[0]?.changed).toBe(false);
    expect(dry.files[0]?.skippedReason).toMatch(/^FRONTMATTER_UNSUPPORTED_VALUE:/);
    expect(view(dry.files)).toEqual(view(real.files));
    expect(fs.readFileSync(skill, "utf8")).toBe(SEQUENCE_DESCRIPTION);
  });

  test("REG-WU-018-RC-025-c: a weak skill with frontmatter still previews a change without writing", async () => {
    const root = tmpDir();
    const skill = writeSkill(root, "weak", WEAK);
    useAdapter(USABLE_DESCRIPTION);

    const dry = await runSkillsPipelineAsync(config(root, true));
    dirs.push(`${root}-out-dry`);
    expect(dry.changed).toBe(1);
    expect(dry.authorityResolved).toBe(true);
    expect(dry.repositoryMutated).toBe(false);
    expect(fs.readFileSync(skill, "utf8")).toBe(WEAK);
  });

  test("REG-WU-018-RC-025-d: no frontmatter with a usable description: same diffs, real run writes frontmatter", async () => {
    const root = tmpDir();
    writeAuthority(root);
    const skill = writeSkill(root, "reviewer", NO_FRONTMATTER);
    useAdapter(USABLE_DESCRIPTION);

    const { dry, real } = await dryThenReal(root);
    expect(dry.changed).toBe(1);
    expect(view(dry.files)).toEqual(view(real.files));
    expect(real.repositoryMutated).toBe(true);
    expect(fs.readFileSync(skill, "utf8").startsWith("---\n")).toBe(true);
  });

  test("REG-WU-018-RC-025-e: a mixed tree reports identical per-file results across modes", async () => {
    const root = tmpDir();
    writeAuthority(root);
    writeSkill(root, "weak", WEAK);
    writeSkill(root, "reviewer", NO_FRONTMATTER);
    writeSkill(root, "lister", SEQUENCE_DESCRIPTION);
    useAdapter("x");

    const { dry, real } = await dryThenReal(root);
    expect(dry.considered).toBe(3);
    expect(view(dry.files)).toEqual(view(real.files));
    expect(dry.changed).toBe(real.changed);
  });
});
