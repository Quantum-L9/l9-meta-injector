/**
 * Direct-CLI argument strictness (RC-101) and the apply fail-on-issues contract (RC-103).
 *
 * The direct entrypoints (inventory, pipeline, check, apply, skills, repository-model)
 * used a permissive argv helper: unknown tokens were ignored, a value option swallowed a
 * following option token, duplicates were silently first-wins, and numerics reached the
 * engine as NaN or out of range. Because inventory annotates the source by default, a
 * one-character typo in its only observation switch (`--dryrun`) mutated the tree.
 *
 * The composite Action accepted `fail-on-issues: false` for apply and forwarded
 * `--no-fail-on-issues`, which apply-cli never read: apply has no verification-only
 * failure to make advisory (passed=false only means an authority refusal).
 */
import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const REPO = path.resolve(__dirname, "..");
const script = (name: string): string => path.join(REPO, "scripts", name);

const dispatch = require("../scripts/lib/operation-dispatch") as {
  ActionInputError: new (message: string) => Error;
  normalizeEnvironment: (env: NodeJS.ProcessEnv) => Record<string, unknown>;
  parseCommandLine: (argv: string[], env?: NodeJS.ProcessEnv) => Record<string, unknown>;
  buildInvocation: (config: Record<string, unknown>) => { args: string[] };
};

const cliArgs = require("../scripts/lib/cli-args") as {
  CLI_OPTION_SPECS: Record<string, unknown>;
  parseOptionArgv: (args: string[], spec: unknown) => { values: Map<string, string>; repeated: Map<string, string[]> };
};

const roots: string[] = [];
function tempDir(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function run(name: string, args: string[], cwd = REPO): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script(name), ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function treeDigest(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(root, full)] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  };
  walk(root);
  return out;
}

function withCwd<T>(directory: string, body: () => T): T {
  const previous = process.cwd();
  process.chdir(directory);
  try { return body(); } finally { process.chdir(previous); }
}

describe("RC-103: apply has no advisory fail-on-issues mode", () => {
  test("REG-WU-066-RC-103-a: the command line refuses apply --no-fail-on-issues", () => {
    const workspace = tempDir("l9-ws-");
    fs.mkdirSync(path.join(workspace, "repo"));
    const parse = (): unknown => withCwd(workspace, () => dispatch.parseCommandLine(
      ["apply", "repo", "--authority", "acme", "--no-fail-on-issues"], { RUNNER_TEMP: workspace },
    ));
    expect(parse).toThrow(dispatch.ActionInputError);
    expect(parse).toThrow(/fail-on-issues=false is forbidden for apply/);
  });

  test("REG-WU-066-RC-103-b: the Action environment refuses apply with fail-on-issues=false", () => {
    const workspace = tempDir("l9-ws-");
    fs.mkdirSync(path.join(workspace, "repo"));
    expect(() => dispatch.normalizeEnvironment({
      GITHUB_WORKSPACE: workspace, GITHUB_ACTION_PATH: REPO, RUNNER_TEMP: tempDir("l9-rt-"),
      L9_INPUT_MODE: "apply", L9_INPUT_ROOT: "repo", L9_INPUT_AUTHORITY: "acme", L9_INPUT_FAIL_ON_ISSUES: "false",
    })).toThrow(/fail-on-issues=false is forbidden for apply/);
  });

  test("REG-WU-066-RC-103-c: apply with fail-on-issues true or empty forwards no --no-fail-on-issues", () => {
    const workspace = tempDir("l9-ws-");
    fs.mkdirSync(path.join(workspace, "repo"));
    for (const value of ["true", ""]) {
      const config = dispatch.normalizeEnvironment({
        GITHUB_WORKSPACE: workspace, GITHUB_ACTION_PATH: REPO, RUNNER_TEMP: tempDir("l9-rt-"),
        L9_INPUT_MODE: "apply", L9_INPUT_ROOT: "repo", L9_INPUT_AUTHORITY: "acme", L9_INPUT_FAIL_ON_ISSUES: value,
      });
      expect(config.failOnIssues).toBe(true);
      expect(dispatch.buildInvocation(config).args).not.toContain("--no-fail-on-issues");
    }
    // Even a hand-built config cannot make the dispatcher forward the flag.
    const config = dispatch.normalizeEnvironment({
      GITHUB_WORKSPACE: workspace, GITHUB_ACTION_PATH: REPO, RUNNER_TEMP: tempDir("l9-rt-"),
      L9_INPUT_MODE: "apply", L9_INPUT_ROOT: "repo", L9_INPUT_AUTHORITY: "acme",
    });
    expect(dispatch.buildInvocation({ ...config, failOnIssues: false }).args).not.toContain("--no-fail-on-issues");
  });

  test("REG-WU-066-RC-103-d: check with fail-on-issues=false is still refused", () => {
    const workspace = tempDir("l9-ws-");
    fs.mkdirSync(path.join(workspace, "repo"));
    expect(() => dispatch.normalizeEnvironment({
      GITHUB_WORKSPACE: workspace, GITHUB_ACTION_PATH: REPO, RUNNER_TEMP: tempDir("l9-rt-"),
      L9_INPUT_MODE: "check", L9_INPUT_ROOT: "repo", L9_INPUT_AUTHORITY: "acme", L9_INPUT_FAIL_ON_ISSUES: "false",
    })).toThrow(/check is a drift gate; fail-on-issues=false is forbidden/);
  });

  test("action.yml no longer advertises an advisory apply", () => {
    const action = fs.readFileSync(path.join(REPO, "action.yml"), "utf8");
    expect(action).not.toMatch(/apply may set false/);
    expect(action).toMatch(/fail-on-issues:[\s\S]{0,400}only 'true'/);
  });
});

describe("RC-101: direct CLIs reject malformed argv before any work", () => {
  test("REG-WU-066-RC-101-a: inventory --dryrun exits 2 and leaves the source untouched", () => {
    const base = tempDir("l9-inv-");
    const src = path.join(base, "src");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, "doc.md"), "# Doc\n\nbody\n");
    fs.writeFileSync(path.join(src, "notes.txt"), "notes\n");
    const before = treeDigest(src);
    const result = run("inventory.js", [src, "--dryrun", "--out", path.join(base, "inv")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/unknown option '--dryrun'/);
    expect(result.stderr).toMatch(/usage: node scripts\/inventory\.js/);
    expect(treeDigest(src)).toEqual(before);
    expect(fs.existsSync(path.join(src, "notes.txt.l9meta.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(base, "inv"))).toBe(false);
  });

  test("REG-WU-066-RC-101-b: a value option never swallows a following option token", () => {
    const root = path.join(tempDir("l9-pipe-"), "root");
    fs.mkdirSync(root);
    const result = run("pipeline-cli.js", [root, "--out", "--dry-run"], path.dirname(root));
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--out requires a value, got option '--dry-run'/);
    expect(fs.existsSync(path.join(path.dirname(root), "--dry-run"))).toBe(false);
  });

  test("REG-WU-066-RC-101-c: out-of-range or non-numeric thresholds exit 2 before any work", () => {
    // Root inside a temp base, so any sibling default output (<root>.l9out) stays contained.
    const root = path.join(tempDir("l9-num-"), "root");
    fs.mkdirSync(root);
    const bad: Array<[string, string]> = [
      ["--near-dup", "abc"], ["--near-dup", "5"], ["--near-dup", "-1"],
      ["--hash-prefix-length", "7"], ["--hash-prefix-length", "65"], ["--hash-prefix-length", "1.5"],
    ];
    for (const cli of ["check-cli.js", "apply-cli.js", "pipeline-cli.js"]) {
      const extra = cli === "pipeline-cli.js" ? ["--dry-run"] : [];
      for (const [option, value] of bad) {
        const result = run(cli, [root, "--authority", "acme", ...extra, option, value]);
        expect(result.status, `${cli} ${option} ${value}`).toBe(2);
        expect(result.stderr, `${cli} ${option} ${value}`).toContain(option);
        expect(result.stderr).not.toMatch(/evaluating|governed apply over|running pipeline over/);
      }
    }
  });

  test("REG-WU-066-RC-101-d: pipeline-cli rejects a namespace-glob without both sides", () => {
    const root = path.join(tempDir("l9-glob-"), "root");
    fs.mkdirSync(root);
    for (const pair of ["=ns", "glob="]) {
      const result = run("pipeline-cli.js", [root, "--authority", "acme", "--dry-run", "--namespace-glob", pair]);
      expect(result.status, pair).toBe(2);
      expect(result.stderr).toMatch(/namespace-glob/);
      expect(result.stderr).not.toMatch(/running pipeline over/);
    }
  });

  test("REG-WU-066-RC-101-e: a duplicated single-value option is refused", () => {
    const root = tempDir("l9-dup-");
    const result = run("check-cli.js", [root, "--authority", "a", "--authority", "b"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--authority may be specified only once/);
  });

  test("REG-WU-066-RC-101-f: boundary thresholds are accepted", () => {
    const root = tempDir("l9-edge-");
    fs.writeFileSync(path.join(root, "doc.md"), "# Doc\n\nbody\n");
    for (const args of [["--near-dup", "0", "--hash-prefix-length", "8"], ["--near-dup", "1", "--hash-prefix-length", "64"]]) {
      const result = run("check-cli.js", [root, "--authority", "acme", ...args]);
      expect(result.status, args.join(" ")).not.toBe(2);
      expect(result.stdout).toMatch(/^check-cli: scanned=/);
    }
  });

  test("REG-WU-066-RC-101-g: pipeline-cli --dry-run --no-fail-on-issues --namespace-glob keeps its outcome", () => {
    const { values, repeated } = cliArgs.parseOptionArgv(
      ["--dry-run", "--no-fail-on-issues", "--namespace-glob", "plastos/**=plastos"], cliArgs.CLI_OPTION_SPECS["pipeline-cli"],
    );
    expect(values.get("--no-fail-on-issues")).toBe("true");
    expect(repeated.get("--namespace-glob")).toEqual(["plastos/**=plastos"]);
    const root = path.join(tempDir("l9-keep-"), "root");
    fs.mkdirSync(path.join(root, "plastos"), { recursive: true });
    fs.writeFileSync(path.join(root, "plastos", "notes.md"), "# Notes\n\nbody\n");
    const result = run("pipeline-cli.js", [
      root, "--authority", "acme", "--dry-run", "--no-fail-on-issues", "--namespace-glob", "plastos/**=plastos",
    ], path.dirname(root));
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^pipeline-cli: scanned=/);
  });

  test("extra positionals and option-shaped values are refused; unknown tokens name themselves", () => {
    const root = tempDir("l9-pos-");
    const extra = run("skills-cli.js", [root, "second-root", "--authority", "acme"]);
    expect(extra.status).toBe(2);
    expect(extra.stderr).toMatch(/second-root/);
    const wrongScript = run("repository-model-cli.js", [root, "--name", "x", "--revision", "git:abc", "--out", path.join(root, "b"), "--dry-run"]);
    expect(wrongScript.status).toBe(2);
    expect(wrongScript.stderr).toMatch(/unknown option '--dry-run'/);
  });

  test("REG-WU-066-RC-101-h: every argv the dispatcher builds is accepted by its child's declaration", () => {
    const base = {
      targetRoot: "/r", outDir: "/r/out", reportPath: "/tmp/report.json", glob: "**/*", namespace: "ns",
      namespaceGlobs: ["docs/**=docs", "a/**=a"], authority: "acme", nearDupThreshold: 0.9, hashPrefixLength: 16,
      omitPatterns: ["x", "y"], actionPath: REPO, llmApiKey: "",
    };
    const llm = { llmEnabled: true, llmBaseUrl: "https://example.invalid", llmModel: "m", llmAllowInsecure: true };
    const cases: Array<[string, Record<string, unknown>]> = [
      ["inventory", { ...base, mode: "inventory", dryRun: true }],
      ["inventory", { ...base, mode: "inventory", dryRun: false }],
      ["check-cli", { ...base, mode: "check", dryRun: true }],
      ["apply-cli", { ...base, mode: "apply", dryRun: false, failOnIssues: true }],
      ["apply-cli", { ...base, mode: "apply", dryRun: false, failOnIssues: false, ...llm }],
      ["skills-cli", { ...base, mode: "skills", dryRun: true }],
      ["skills-cli", { ...base, mode: "skills", dryRun: false, ...llm }],
    ];
    for (const [label, config] of cases) {
      const { args } = dispatch.buildInvocation({ failOnIssues: true, llmEnabled: false, ...config });
      // args[0] is the child script and args[1] its positional root.
      expect(path.basename(args[0]).replace(/\.js$/, "")).toBe(label);
      expect(() => cliArgs.parseOptionArgv(args.slice(2), cliArgs.CLI_OPTION_SPECS[label]), label).not.toThrow();
    }
  });
});
