import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runApplyAsync } from "../src/apply";
import { runCheckAsync, type CheckConfig } from "../src/check";
import { assertDiscoveryGlob, compileDiscoveryGlob, globToRegExp } from "../src/glob";
import { discoverFiles } from "../src/retrieval";

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
