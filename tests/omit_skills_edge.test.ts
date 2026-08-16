import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { inventoryTree, classifyInventory } from "../src/inventory";
import { runPipelineAsync } from "../src/pipeline";
import { runSkillsPipelineAsync } from "../src/skills_pipeline";
import { resolveStrategy } from "../src/comment";
import { buildOmitMatcher, isSkillMdBasename, isSkillArtifactPath } from "../src/omit";
import { setAdapter, resetAdapter } from "../src/llm";
import { hasUseWhenSignal } from "../src/assist";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-edge-"));
}

/** Declare the canonical repository authority so governed skills mode may write. */
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

describe("omit matcher", () => {
  it("protects SKILL.md case-insensitively when protectSkillMd is on", () => {
    const root = tmp();
    const m = buildOmitMatcher({ root, protectSkillMd: true });
    expect(m.shouldOmit("skills/foo/SKILL.md")).toBe(true);
    expect(m.shouldOmit("skills/foo/skill.md")).toBe(true);
    expect(isSkillMdBasename("SKILL.md")).toBe(true);
  });

  it("does not protect SKILL.md when protectSkillMd is false", () => {
    const root = tmp();
    const m = buildOmitMatcher({ root, protectSkillMd: false });
    expect(m.shouldOmit("skills/foo/SKILL.md")).toBe(false);
  });

  it("omits noise extensions and __pycache__", () => {
    const root = tmp();
    const m = buildOmitMatcher({ root, protectSkillMd: false });
    expect(m.shouldOmit("pkg/__pycache__/x.pyc")).toBe(true);
    expect(m.shouldOmit("debug.log")).toBe(true);
    expect(m.shouldOmit("src/app.py")).toBe(false);
  });

  it("honors .l9metaignore", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, ".l9metaignore"), "# comment\nvendor/\n!vendor/keep.md\n");
    const m = buildOmitMatcher({ root, protectSkillMd: false });
    expect(m.shouldOmit("vendor/secret.txt")).toBe(true);
  });
});

describe("edge filetype strategy + classify", () => {
  it("CODEOWNERS and .ql use line-comment; .pyc/.log skip-binary", () => {
    expect(resolveStrategy("CODEOWNERS", "").strategy).toBe("line-comment");
    expect(resolveStrategy("q.ql", "").strategy).toBe("line-comment");
    expect(resolveStrategy("q.qls", "").strategy).toBe("line-comment");
    expect(resolveStrategy("a.pyc", "").strategy).toBe("skip-binary");
    expect(resolveStrategy("a.log", "").strategy).toBe("skip-binary");
  });

  it("classifyInventory recognizes edge basenames/exts", () => {
    const C = (p: string) => classifyInventory(p, path.basename(p), path.extname(p), false).type;
    expect(C(".gitignore")).toBe("config");
    expect(C("CODEOWNERS")).toBe("config");
    expect(C("LICENSE")).toBe("documentation");
    expect(C("LICENSE-MIT")).toBe("documentation");
    expect(C("MANIFEST.sha256")).toBe("config");
    expect(C("rules.ql")).toBe("code");
  });
});

describe("SKILL.md protect — inventory + pipeline never mutate", () => {
  it("inventory leaves SKILL.md byte-identical and records it as omitted", () => {
    const root = tmp();
    const skillDir = path.join(root, "skills", "demo");
    fs.mkdirSync(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, "SKILL.md");
    const original = "---\nname: demo\ndescription: Demo skill. Use when testing.\n---\n\n# Demo\n";
    fs.writeFileSync(skillPath, original);
    fs.writeFileSync(path.join(root, "README.md"), "# hi\n");
    const out = tmp();
    const r = inventoryTree({ root, outDir: out, dryRun: false, now: "2026-01-01T00:00:00.000Z" });
    expect(fs.readFileSync(skillPath, "utf8")).toBe(original);
    expect(r.omittedPaths.some((p) => p.toLowerCase().endsWith("skill.md"))).toBe(true);
    expect(r.records.some((x) => x.file_name.toLowerCase() === "skill.md")).toBe(false);
    // README should still be injected
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toMatch(/^---/);
  });

  it("pipeline leaves SKILL.md byte-identical", async () => {
    const root = tmp();
    const skillDir = path.join(root, "skills", "demo");
    fs.mkdirSync(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, "SKILL.md");
    const original = "---\nname: demo\ndescription: Demo skill. Use when testing pipeline protect.\n---\n\n# Demo\n";
    fs.writeFileSync(skillPath, original);
    fs.writeFileSync(path.join(root, "note.md"), "# note\n");
    const out = tmp();
    await runPipelineAsync({
      root, glob: "**/*", dryRun: false, outDir: out, namespace: "t", authority: "t",
      nearDupThreshold: 0.9, hashPrefixLength: 16, indexDir: out, verbose: false,
      llmEnabled: false, normalizeFilenames: false, writeInjectLog: false,
    });
    expect(fs.readFileSync(skillPath, "utf8")).toBe(original);
  });
});

describe("inventory sidecar leak + noise omit", () => {
  it("does not write sidecars for binaries; omits __pycache__ and .log", () => {
    const root = tmp();
    const cache = path.join(root, "__pycache__");
    fs.mkdirSync(cache);
    fs.writeFileSync(path.join(cache, "x.pyc"), Buffer.from([0, 1, 2, 0]));
    fs.writeFileSync(path.join(root, "debug.log"), "noise\n");
    fs.writeFileSync(path.join(root, "blob.bin"), Buffer.from([0, 1, 2, 0, 3]));
    fs.writeFileSync(path.join(root, "data.json"), "{\"a\":1}\n");
    const out = tmp();
    const r = inventoryTree({ root, outDir: out, dryRun: false, now: "2026-01-01T00:00:00.000Z" });
    expect(fs.existsSync(path.join(root, "blob.bin.l9meta.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(root, "data.json.l9meta.yaml"))).toBe(true);
    expect(r.records.some((x) => x.relative_path.includes("__pycache__"))).toBe(false);
    expect(r.records.some((x) => x.file_name === "debug.log")).toBe(false);
  });

  it("LICENSE gets a sidecar and config classification", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "LICENSE"), "Proprietary license text for testing purposes only.\n");
    const out = tmp();
    const r = inventoryTree({ root, outDir: out, dryRun: false, now: "2026-01-01T00:00:00.000Z" });
    const lic = r.records.find((x) => x.file_name === "LICENSE");
    expect(lic?.artifact_type).toBe("documentation");
    expect(fs.existsSync(path.join(root, "LICENSE.l9meta.yaml"))).toBe(true);
  });
});

describe("skills mode — Cursor-native description", () => {
  beforeEach(() => resetAdapter());
  afterEach(() => resetAdapter());

  it("isSkillArtifactPath detects skill entrypoints", () => {
    // Canonical skill entrypoint detection is the SKILL.md basename only
    // (see skills_exact_entrypoint.test.ts); a `.skill.md` suffix is not one.
    expect(isSkillArtifactPath("skills/x/SKILL.md")).toBe(true);
    expect(isSkillArtifactPath("foo.skill.md")).toBe(false);
    expect(isSkillArtifactPath("README.md")).toBe(false);
  });

  it("hasUseWhenSignal detects trigger language", () => {
    expect(hasUseWhenSignal("Does X. Use when the user asks for Y.")).toBe(true);
    expect(hasUseWhenSignal("Short blurb")).toBe(false);
  });

  it("material-improves weak description with LLM adapter; preserves name", async () => {
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

    const root = tmp();
    const skillDir = path.join(root, "skills", "review");
    fs.mkdirSync(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, "SKILL.md");
    fs.writeFileSync(skillPath, "---\nname: review\ndescription: Reviews stuff\n---\n\n# Review\n\nCheck PRs carefully.\n");
    writeAuthority(root);
    const out = tmp();
    const r = await runSkillsPipelineAsync({
      root, authority: "l9.doctrine.platform", outDir: out, dryRun: false, verbose: false, llmEnabled: true,
    });
    expect(r.authorityResolved).toBe(true);
    expect(r.repositoryMutated).toBe(true);
    expect(r.considered).toBe(1);
    expect(r.changed).toBe(1);
    const text = fs.readFileSync(skillPath, "utf8");
    expect(text).toContain("name: review");
    expect(text).toMatch(/Use when/i);
    expect(text).not.toContain("artifact_type:");
    expect(text).toContain("activation_signals:");
  });

  it("does not write when description already has Use when and is good", async () => {
    setAdapter({
      estimateTokens: (t) => Math.ceil(t.length / 4),
      classify: async () => "should not be called for good description",
    });
    const root = tmp();
    const skillDir = path.join(root, "skills", "ok");
    fs.mkdirSync(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, "SKILL.md");
    const original = "---\nname: ok\ndescription: Handles inventory omit rules carefully. Use when editing omit patterns or SKILL.md protect behavior.\nactivation_signals:\n  - omit rules\n  - skill protect\n---\n\n# Ok\n";
    fs.writeFileSync(skillPath, original);
    writeAuthority(root);
    const out = tmp();
    const r = await runSkillsPipelineAsync({
      root, authority: "l9.doctrine.platform", outDir: out, dryRun: false, verbose: false, llmEnabled: true,
    });
    expect(r.authorityResolved).toBe(true);
    expect(r.repositoryMutated).toBe(false);
    expect(r.changed).toBe(0);
    expect(fs.readFileSync(skillPath, "utf8")).toBe(original);
  });
});
