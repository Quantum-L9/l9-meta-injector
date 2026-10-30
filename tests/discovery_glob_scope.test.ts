import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runApplyAsync } from "../src/apply";
import { runCheckAsync, type CheckConfig } from "../src/check";
import { assertDiscoveryGlob, compileDiscoveryGlob, globToRegExp } from "../src/glob";
import { runPipelineAsync } from "../src/pipeline";
import { discoverFiles, findFiles } from "../src/retrieval";

const roots: string[] = [];
const PROMPT = [
  "# Build prompt",
  "",
  "Role: repository auditor",
  "Objective: inspect the repository and report evidence.",
  "Output format: markdown report.",
  "",
].join("\n");

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-glob-scope-"));
  roots.push(root);
  return root;
}

function governedRoot(): string {
  const root = tempRoot();
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

function write(root: string, relative: string, content = PROMPT): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function config(root: string, glob: string): CheckConfig {
  const external = `${root}.out`;
  return {
    root,
    glob,
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

function relative(root: string, files: string[]): string[] {
  return files.map((file) => path.relative(root, file).split(path.sep).join("/"));
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.out`, { recursive: true, force: true });
  }
});

describe("one glob dialect for discovery scope and authority", () => {
  test("the discovery scope honors the path prefix, not only the extension", () => {
    const root = tempRoot();
    write(root, "docs/a.md");
    write(root, "docs/deep/b.md");
    write(root, "other/c.md");
    write(root, "docs.md");
    write(root, "docs/d.txt");

    const result = discoverFiles(root, "docs/**/*.md");
    expect(relative(root, result.files)).toEqual(["docs/a.md", "docs/deep/b.md"]);
    const byPath = new Map(result.summary.entries.map((entry) => [entry.path, entry]));
    expect(byPath.get("other/c.md")?.disposition).toBe("glob_filtered");
    expect(byPath.get("docs.md")?.disposition).toBe("glob_filtered");
    expect(byPath.get("docs/d.txt")?.disposition).toBe("extension_filtered");
    expect(result.summary.byDisposition.glob_filtered).toBe(2);
  });

  test("a single-segment glob stays at the root and the default reaches every depth", () => {
    const root = tempRoot();
    write(root, "a.md");
    write(root, "d/b.md");
    write(root, "d/e/c.txt", "plain text\n");
    expect(relative(root, discoverFiles(root, "*.md").files)).toEqual(["a.md"]);
    expect(relative(root, discoverFiles(root, "**/*.md").files)).toEqual(["a.md", "d/b.md"]);
    expect(relative(root, discoverFiles(root, "**/*").files)).toEqual(["a.md", "d/b.md", "d/e/c.txt"]);
    expect(relative(root, discoverFiles(root, "**").files)).toEqual(["a.md", "d/b.md", "d/e/c.txt"]);
    expect(relative(root, discoverFiles(root, "d/*").files)).toEqual(["d/b.md"]);
    expect(relative(root, discoverFiles(root, "d/**").files)).toEqual(["d/b.md", "d/e/c.txt"]);
  });

  test("the extension match stays case-insensitive as the former filter was", () => {
    const root = tempRoot();
    write(root, "a.md");
    write(root, "B.MD");
    expect(relative(root, discoverFiles(root, "**/*.MD").files)).toEqual(["B.MD", "a.md"]);
  });

  test("unsupported or escaping scope syntax is refused before any directory is read", () => {
    const root = tempRoot();
    write(root, "a.md");
    for (const glob of ["**/*.{md,txt}", "**/[ab].md", "!**/*.md", "/etc/**", "../**/*.md", "docs/./*.md", "docs//*.md", "docs\\*.md", "./*.md", " *.md", ""]) {
      expect(() => discoverFiles(root, glob), glob).toThrow(/discovery glob/);
      expect(() => assertDiscoveryGlob(glob), glob).toThrow(/discovery glob/);
    }
  });

  test("the authority matcher and the discovery matcher agree on every path", () => {
    const pattern = "docs/**/*.md";
    const authority = globToRegExp(pattern);
    const scope = compileDiscoveryGlob(pattern);
    for (const candidate of ["docs/a.md", "docs/x/y/z.md", "other/b.md", "x/docs/c.md", "docs.md", "docs/a.txt"]) {
      expect(scope.matches(candidate), candidate).toBe(authority.test(candidate));
    }
    expect(scope.extensionFilter).toBe(".md");
    expect(compileDiscoveryGlob("docs/**").extensionFilter).toBeNull();
  });

  test("a governed check and apply plan and mutate only the scoped files", async () => {
    const root = governedRoot();
    write(root, "docs/a.md");
    write(root, "other/b.md");

    const check = await runCheckAsync(config(root, "docs/**/*.md"));
    expect(check.check?.carrierDecisions.map((item) => item.path)).toEqual(["docs/a.md"]);
    expect(check.check?.drift.map((item) => item.path)).not.toContain("other/b.md");

    const apply = await runApplyAsync({ ...config(root, "docs/**/*.md"), dryRun: false } as never);
    expect(apply.passed).toBe(true);
    expect(apply.apply?.inlineChanged).toEqual(["docs/a.md"]);
    expect(fs.readFileSync(path.join(root, "other", "b.md"), "utf8")).toBe(PROMPT);
    expect(fs.readFileSync(path.join(root, "docs", "a.md"), "utf8")).not.toBe(PROMPT);
  });

  test("a governed run refuses an unsupported scope instead of running over the wrong set", async () => {
    const root = governedRoot();
    write(root, "docs/a.md");
    await expect(runCheckAsync(config(root, "docs/**/*.{md,txt}"))).rejects.toThrow(/unsupported syntax/);
    await expect(runApplyAsync({ ...config(root, "../**/*.md"), dryRun: false } as never)).rejects.toThrow(/discovery glob/);
    expect(fs.readFileSync(path.join(root, "docs", "a.md"), "utf8")).toBe(PROMPT);
  });
});

describe("WU-007 trailing-slash scopes are refused (RC-010)", () => {
  test("REG-WU-007-RC-010-a: a pattern with an empty trailing segment is refused and the intended form suggested", () => {
    const root = tempRoot();
    write(root, "docs/a.md");
    for (const glob of ["docs/", "docs/**/", "**/", "a/b/"]) {
      expect(() => assertDiscoveryGlob(glob), glob).toThrow(/discovery glob/);
      expect(() => discoverFiles(root, glob), glob).toThrow(/discovery glob/);
    }
    expect(() => assertDiscoveryGlob("docs/")).toThrow("docs/**");
  });

  test("REG-WU-007-RC-010-b: a governed check and apply refuse 'docs/' and touch nothing", async () => {
    const root = governedRoot();
    write(root, "docs/a.md");
    await expect(runCheckAsync(config(root, "docs/"))).rejects.toThrow(/discovery glob/);
    await expect(runApplyAsync({ ...config(root, "docs/"), dryRun: false } as never)).rejects.toThrow(/discovery glob/);
    expect(fs.readFileSync(path.join(root, "docs", "a.md"), "utf8")).toBe(PROMPT);
    expect(fs.existsSync(path.join(root, ".l9", "metadata-index.jsonl"))).toBe(false);
  });

  test("REG-WU-007-RC-010-c: directory and file scopes without an empty segment still match as before", () => {
    const root = tempRoot();
    write(root, "docs/a.md");
    write(root, "docs/x/b.md");
    write(root, "top.md");
    for (const glob of ["docs/**", "docs/**/*.md", "**/*", "**", "*.md"]) {
      expect(assertDiscoveryGlob(glob)).toBe(glob);
    }
    expect(relative(root, discoverFiles(root, "docs/**").files)).toEqual(["docs/a.md", "docs/x/b.md"]);
    expect(relative(root, discoverFiles(root, "docs/**/*.md").files)).toEqual(["docs/a.md", "docs/x/b.md"]);
    expect(relative(root, discoverFiles(root, "**/*").files)).toEqual(["docs/a.md", "docs/x/b.md", "top.md"]);
    expect(relative(root, discoverFiles(root, "**").files)).toEqual(["docs/a.md", "docs/x/b.md", "top.md"]);
    expect(relative(root, discoverFiles(root, "*.md").files)).toEqual(["top.md"]);
  });
});

describe("WU-005 scoped governed runs merge with the repository-wide metadata index (RC-009)", () => {
  const INDEX = path.join(".l9", "metadata-index.jsonl");
  const SOURCE = "export const value = 1;\n";

  function fullyApplied(): string {
    const root = governedRoot();
    write(root, "docs/a.md");
    write(root, "other/b.md", PROMPT.replace("Build prompt", "Other prompt"));
    write(root, "src/x.ts", SOURCE);
    return root;
  }

  async function applyAll(root: string, glob = "**/*") {
    return runApplyAsync({ ...config(root, glob), dryRun: false } as never);
  }

  function indexPaths(root: string): string[] {
    return fs.readFileSync(path.join(root, INDEX), "utf8").trimEnd().split("\n").map((line) => (JSON.parse(line) as { path: string }).path);
  }

  function indexLine(root: string, pathName: string): string | undefined {
    return fs.readFileSync(path.join(root, INDEX), "utf8").split("\n").find((line) => line.includes(`"path":${JSON.stringify(pathName)}`));
  }

  test("REG-WU-005-RC-009-a: a scoped check of a fully applied repository passes and touches nothing", async () => {
    const root = fullyApplied();
    expect((await applyAll(root)).passed).toBe(true);
    expect(indexPaths(root)).toEqual(["docs/a.md", "other/b.md", "src/x.ts"]);
    const before = fs.readFileSync(path.join(root, INDEX));
    const check = await runCheckAsync(config(root, "docs/**/*.md"));
    expect(check.check?.drift).toEqual([]);
    expect(check.passed).toBe(true);
    expect(check.repositoryMutated).toBe(false);
    expect(fs.readFileSync(path.join(root, INDEX)).equals(before)).toBe(true);
  });

  test("REG-WU-005-RC-009-b: a scoped apply of a fully applied repository is a no-op that keeps every record", async () => {
    const root = fullyApplied();
    await applyAll(root);
    const before = fs.readFileSync(path.join(root, INDEX), "utf8");
    const apply = await applyAll(root, "docs/**/*.md");
    expect(apply.passed).toBe(true);
    expect(apply.repositoryMutated).toBe(false);
    expect(apply.apply?.metadataIndexChanged).toBe(false);
    expect(fs.readFileSync(path.join(root, INDEX), "utf8")).toBe(before);
  });

  test("REG-WU-005-RC-009-c: a scoped apply after an in-scope edit changes only that file and its record", async () => {
    const root = fullyApplied();
    await applyAll(root);
    const otherRecord = indexLine(root, "other/b.md");
    const sourceRecord = indexLine(root, "src/x.ts");
    const docRecord = indexLine(root, "docs/a.md");
    const otherBytes = fs.readFileSync(path.join(root, "other", "b.md"), "utf8");
    const docPath = path.join(root, "docs", "a.md");
    fs.writeFileSync(docPath, fs.readFileSync(docPath, "utf8").replace("inspect the repository", "inspect the whole repository"));

    const apply = await applyAll(root, "docs/**/*.md");
    expect(apply.passed).toBe(true);
    expect(apply.apply?.inlineChanged).toEqual(["docs/a.md"]);
    expect(apply.apply?.metadataIndexChanged).toBe(true);
    expect(indexPaths(root)).toEqual(["docs/a.md", "other/b.md", "src/x.ts"]);
    expect(indexLine(root, "other/b.md")).toBe(otherRecord);
    expect(indexLine(root, "src/x.ts")).toBe(sourceRecord);
    expect(indexLine(root, "docs/a.md")).not.toBe(docRecord);
    expect(fs.readFileSync(path.join(root, "other", "b.md"), "utf8")).toBe(otherBytes);

    const unscoped = await runCheckAsync(config(root, "**/*"));
    expect(unscoped.check?.drift).toEqual([]);
    expect(unscoped.passed).toBe(true);
  });

  test("REG-WU-005-RC-009-d: a scoped apply drops the record of a deleted in-scope file and keeps the rest", async () => {
    const root = fullyApplied();
    write(root, "docs/c.md", PROMPT.replace("Build prompt", "Third prompt"));
    await applyAll(root);
    const otherRecord = indexLine(root, "other/b.md");
    const sourceRecord = indexLine(root, "src/x.ts");
    fs.rmSync(path.join(root, "docs", "a.md"));

    const apply = await applyAll(root, "docs/**/*.md");
    expect(apply.passed).toBe(true);
    expect(indexPaths(root)).toEqual(["docs/c.md", "other/b.md", "src/x.ts"]);
    expect(indexLine(root, "other/b.md")).toBe(otherRecord);
    expect(indexLine(root, "src/x.ts")).toBe(sourceRecord);
  });

  test("REG-WU-005-RC-009-e: an unparseable base index is reported by a scoped check, refused by a scoped apply and rebuilt by an unscoped apply", async () => {
    const root = fullyApplied();
    await applyAll(root);
    const corrupt = "{\"not\":\"canonical\" }\n";
    fs.writeFileSync(path.join(root, INDEX), corrupt);
    const docBefore = fs.readFileSync(path.join(root, "docs", "a.md"), "utf8");

    const check = await runCheckAsync(config(root, "docs/**/*.md"));
    expect(check.passed).toBe(false);
    const indexDrift = check.check?.drift.filter((item) => item.path === ".l9/metadata-index.jsonl") ?? [];
    expect(indexDrift).toHaveLength(1);
    expect(indexDrift[0].kind).toBe("conflict");
    expect(indexDrift[0].message).toMatch(/cannot be parsed/);
    expect(indexDrift[0].message).toMatch(/unscoped/);

    await expect(applyAll(root, "docs/**/*.md")).rejects.toThrow(/METADATA_INDEX_UNMERGEABLE.*unscoped/);
    expect(fs.readFileSync(path.join(root, INDEX), "utf8")).toBe(corrupt);
    expect(fs.readFileSync(path.join(root, "docs", "a.md"), "utf8")).toBe(docBefore);

    const rebuilt = await applyAll(root);
    expect(rebuilt.passed).toBe(true);
    expect(indexPaths(root)).toEqual(["docs/a.md", "other/b.md", "src/x.ts"]);
  });

  test("REG-WU-005-RC-009-f: a scoped run on a fresh repository still plans and writes only the scoped record", async () => {
    const root = governedRoot();
    write(root, "docs/a.md");
    write(root, "other/b.md", PROMPT.replace("Build prompt", "Other prompt"));
    const check = await runCheckAsync(config(root, "docs/**/*.md"));
    expect(check.check?.carrierDecisions.map((item) => item.path)).toEqual(["docs/a.md"]);
    const apply = await applyAll(root, "docs/**/*.md");
    expect(apply.passed).toBe(true);
    expect(apply.apply?.inlineChanged).toEqual(["docs/a.md"]);
    expect(indexPaths(root)).toEqual(["docs/a.md"]);
  });
});

describe("WU-006 '?' matches one code point in every matcher (RC-012)", () => {
  test("REG-WU-006-RC-012-c: discovery, authority and omit '?' match an astral character and never '/'", async () => {
    const { buildOmitMatcher } = await import("../src/omit");
    const scope = compileDiscoveryGlob("?.md");
    const authority = globToRegExp("?.md");
    const omit = buildOmitMatcher({ root: tempRoot(), patterns: ["/?.md"], protectSkillMd: false });
    for (const [candidate, expected] of [["\u{1F600}.md", true], ["é.md", true], ["a/b.md", false], ["ab.md", false]] as const) {
      expect(scope.matches(candidate), candidate).toBe(expected);
      expect(authority.test(candidate), candidate).toBe(expected);
      expect(omit.shouldOmit(candidate), candidate).toBe(expected);
    }
  });

  test("REG-WU-006-RC-012-d: ASCII glob behaviour is unchanged, including the case-insensitive scope", () => {
    expect(compileDiscoveryGlob("docs/?.MD").matches("docs/a.md")).toBe(true);
    expect(globToRegExp("docs/?.MD").test("docs/a.md")).toBe(false);
    expect(globToRegExp("docs/**/*.md").test("docs/x/y.md")).toBe(true);
    expect(globToRegExp("docs/(a)+.md").test("docs/(a)+.md")).toBe(true);
    expect(globToRegExp("{a,b}.md").test("{a,b}.md")).toBe(true);
  });
});

describe("WU-006 a governed path the index schema cannot represent (RC-013)", () => {
  test("REG-WU-006-RC-013-d: apply refuses a TAB-named governed file at the discovery gate, before any write", async () => {
    const root = governedRoot();
    write(root, "src/tab\there.ts", "export const value = 1;\n");
    write(root, "docs/a.md");
    await expect(runApplyAsync({ ...config(root, "**/*"), dryRun: false } as never)).rejects.toThrow(/DISCOVERY_INCOMPLETE/);
    expect(fs.existsSync(path.join(root, ".l9", "metadata-index.jsonl"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "docs", "a.md"), "utf8")).toBe(PROMPT);
  });

  test("REG-WU-006-RC-013-d (check half, DEC-RC-013 option B): check reports the unrepresentable path instead of throwing", async () => {
    const root = governedRoot();
    write(root, "src/tab\there.ts", "export const value = 1;\n");
    const result = await runCheckAsync(config(root, "**/*"));
    expect(result.passed).toBe(false);
    expect(result.check?.discovery.blocking).toBe(1);
    const drift = result.check?.drift.find((item) => item.path === "src/tab\there.ts");
    expect(drift?.kind).toBe("unsupported");
    expect(drift?.message).toMatch(/unsupported_entry: metadata index path contains a control character/);
    // Index-governed discovery holds it, so it never reaches the planner as an eligible file.
    const discovered = discoverFiles(root, "**/*", {}, true);
    expect(JSON.stringify(discovered)).toContain("unsupported_entry");
    expect(JSON.stringify(discovered.files)).not.toContain("tab");
  });

  test("REG-AUDIT-G02-a: bare discoverFiles and public findFiles keep a TAB-named file out of blocking", () => {
    const root = tempRoot();
    write(root, "src/tab\there.ts", "export const value = 1;\n");
    const discovered = discoverFiles(root, "**/*");
    expect(discovered.summary.blocking).toBe(0);
    expect(discovered.summary.entries.find((entry) => entry.path === "src/tab\there.ts")?.disposition).toBe("eligible");
    expect(relative(root, discovered.files)).toEqual(["src/tab\there.ts"]);
    expect(relative(root, findFiles(root, "**/*"))).toEqual(["src/tab\there.ts"]);
  });

  test("REG-AUDIT-G02-b: a non-governed runPipelineAsync does not throw DISCOVERY_INCOMPLETE for a TAB-named file", async () => {
    const root = tempRoot();
    write(root, "src/tab\there.ts", "export const value = 1;\n");
    const result = await runPipelineAsync({ ...config(root, "**/*"), dryRun: false });
    expect(result.coverage.discovery.blocking).toBe(0);
    expect(result.injected.map((record) => path.relative(root, record.sourcePath).split(path.sep).join("/"))).toEqual(["src/tab\there.ts"]);
  });

  test("REG-AUDIT-G02-c: a binary whose path the index cannot represent is known_binary, not blocking", async () => {
    const root = governedRoot();
    fs.mkdirSync(path.join(root, "img"));
    fs.writeFileSync(path.join(root, "img", "tab\there.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const governed = discoverFiles(root, "**/*", {}, true);
    expect(governed.summary.blocking).toBe(0);
    expect(governed.summary.entries.find((entry) => entry.path === "img/tab\there.png")?.disposition).toBe("known_binary");
    const result = await runCheckAsync(config(root, "**/*"));
    expect(result.check?.discovery.blocking).toBe(0);
    expect(result.check?.drift.some((item) => item.path === "img/tab\there.png")).toBe(false);
  });
});
