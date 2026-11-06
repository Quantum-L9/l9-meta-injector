// ADR-085: inventory eligibility, read eligibility, carrier eligibility and
// mutation eligibility are four decisions, not one omission decision.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inventoryTree } from "../src/inventory";
import { observeRepositoryModel, validateRepositoryModelPacket } from "../src/repository_model";

const REVISION = "git:0000000000000000000000000000000000000000";
const HEADER = "<!-- L9_META\nl9_schema: 1\nowner: platform\n/L9_META -->\n";
const HASH_HEADER = "# --- L9_META ---\n# l9_schema: 1\n# owner: platform\n# --- /L9_META ---\n";

const scratchDirs: string[] = [];
function scratch(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `l9-obs-${name}-`));
  scratchDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function repoWith(files: Record<string, string>): string {
  const root = path.join(scratch("repo"), "repo");
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

describe("Case A: protected but readable", () => {
  it("observes a protected SKILL.md header without modifying the file", () => {
    const skill = `${HEADER}# Skill\n\nBody.\n`;
    const root = repoWith({ "skills/demo/SKILL.md": skill, "README.md": "# Readme\n" });
    const packet = observeRepositoryModel({
      root, repositoryName: "repo", sourceRevision: REVISION, producerVersion: "4.0.0",
    });
    expect(packet.payload.artifacts.some((a) => a.source_path === "skills/demo/SKILL.md")).toBe(true);
    const owner = packet.payload.assertions.find(
      (a) => a.source_path === "skills/demo/SKILL.md" && a.predicate === "meta.l9v1.governance.owner",
    );
    expect(owner?.object).toBe("platform");
    expect(fs.readFileSync(path.join(root, "skills/demo/SKILL.md"), "utf8")).toBe(skill);
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");
  });

  // Mutation eligibility itself (SKILL.md is central_manifest outside skills mode)
  // is mutation_policy.ts's decision and is covered in mutation_policy.test.ts.
  it("keeps SKILL.md out of an annotating walk", () => {
    const root = repoWith({ "skills/demo/SKILL.md": `${HEADER}# Skill\n`, "notes.md": "# Notes\n" });
    const annotate = inventoryTree({ root, outDir: path.join(scratch("annotate"), "out"), dryRun: true });
    expect(annotate.records.some((r) => r.relative_path === "skills/demo/SKILL.md")).toBe(false);
    expect(annotate.omittedPaths).toContain("skills/demo/SKILL.md");
  });

  it("refuses an observing walk that could write", () => {
    const root = repoWith({ "notes.md": "# Notes\n" });
    const outDir = path.join(scratch("refuse"), "out");
    expect(() => inventoryTree({ root, outDir, purpose: "observe" })).toThrow(/write-free/);
    expect(() => inventoryTree({ root, outDir, purpose: "observe", dryRun: true })).toThrow(/write-free/);
  });

  it("still honours explicit operator omissions and secret-path refusal while observing", () => {
    const root = repoWith({
      "skills/demo/SKILL.md": `${HEADER}# Skill\n`,
      "skills/hidden/SKILL.md": `${HEADER}# Hidden\n`,
      "secrets/README.md": `${HEADER}# Secret\n`,
    });
    const packet = observeRepositoryModel({
      root, repositoryName: "repo", sourceRevision: REVISION, producerVersion: "4.0.0",
      omitPatterns: ["skills/hidden/"],
    });
    const paths = packet.payload.artifacts.map((a) => a.source_path);
    expect(paths).toContain("skills/demo/SKILL.md");
    expect(paths).not.toContain("skills/hidden/SKILL.md");
    expect(packet.payload.assertions.some((a) => a.source_path === "secrets/README.md")).toBe(false);
  });
});

describe("dotfile header carriers", () => {
  it.each([".editorconfig", ".gitignore"])("reads the native header declared in %s", (name) => {
    const root = repoWith({ [name]: `${HASH_HEADER}root = true\n` });
    const packet = observeRepositoryModel({
      root, repositoryName: "repo", sourceRevision: REVISION, producerVersion: "4.0.0",
    });
    const owner = packet.payload.assertions.find(
      (a) => a.source_path === name && a.predicate === "meta.l9v1.governance.owner",
    );
    expect(owner?.object).toBe("platform");
  });
});
