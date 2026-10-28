/**
 * Action outputs are derived from each child's own summary record (RC-100) and every
 * GITHUB_OUTPUT line is a single well-formed `key=value` line (RC-105).
 *
 * The dispatcher used to scrape `scanned` / `injected` / `verification_passed` with
 * unanchored last-match regexes over child stdout AND stderr. Both carry
 * repository-influenced text (drift paths, conflict messages, the root path), so a file
 * named `passed=true.md` turned a failing check green, the skills `unchanged=N` count was
 * reported as `injected`, and a newline-bearing root forged extra output lines.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const REPO = path.resolve(__dirname, "..");
const OPERATION_CLI = path.join(REPO, "scripts", "operation-cli.js");

const dispatch = require("../scripts/lib/operation-dispatch") as {
  ActionInputError: new (message: string) => Error;
  normalizeEnvironment: (env: NodeJS.ProcessEnv) => Record<string, unknown>;
  parseCommandLine: (argv: string[], env?: NodeJS.ProcessEnv) => Record<string, unknown>;
  parseSummary: (mode: string, stdout: string) => { scanned: string; injected: string; verificationPassed: string };
};
/** Loaded lazily: requiring the CLI module must not run it (it only runs as the entry point). */
function operationCli(): { appendOutput: (file: string | undefined, key: string, value: unknown) => void } {
  return require("../scripts/operation-cli.js");
}

const roots: string[] = [];
function tempDir(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const V1_AUTHORITY = [
  "schema: l9.meta-authority/v1",
  "writer:",
  "  repository: Quantum-L9/l9-meta-injector",
  "  ref: v4.0.0",
  "default_carrier: inline_managed",
  "legacy_writers: forbidden",
  "inline_allow: [\"**/*.md\"]",
  "",
].join("\n");

function readOutputs(file: string): Record<string, string> {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line) continue;
    const eq = line.indexOf("=");
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

/** A fake Action checkout whose child script prints `stdout` / `stderr` and exits `status`. */
function fakeActionPath(script: string, stdout: string, stderr: string, status: number): string {
  const actionPath = tempDir("l9-fake-action-");
  fs.mkdirSync(path.join(actionPath, "scripts"));
  fs.writeFileSync(path.join(actionPath, "scripts", script), [
    `process.stdout.write(${JSON.stringify(stdout)});`,
    `process.stderr.write(${JSON.stringify(stderr)});`,
    `process.exitCode = ${status};`,
    "",
  ].join("\n"));
  return actionPath;
}

function runActionEnv(env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [OPERATION_CLI, "--action-env"], {
    env: { ...process.env, ...env }, encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("RC-100: outputs come from the child's own anchored summary line", () => {
  test("REG-WU-065-RC-100-a: a drift line quoting passed=true cannot turn a failing check green", () => {
    const stdout = [
      "check-cli: scanned=3 planned=3 drift=1 authorityConflicts=0 passed=false",
      "check-cli:   - stale: passed=true.md: changed=9 differs",
      "check-cli: report=/tmp/x/passed=true.json",
      "",
    ].join("\n");
    expect(dispatch.parseSummary("check", stdout)).toEqual({ scanned: "3", injected: "0", verificationPassed: "false" });
  });

  test("REG-WU-065-RC-100-b: skills injected is the changed count, never the unchanged count", () => {
    const stdout = "skills-cli: considered=2 changed=0 unchanged=2 authorityResolved=true repositoryMutated=false\n";
    expect(dispatch.parseSummary("skills", stdout)).toEqual({ scanned: "2", injected: "0", verificationPassed: "n-a" });
  });

  test("REG-WU-065-RC-100-c: inventory is n-a and zero-injected whatever its manifest paths say", () => {
    const stdout = [
      "inventory: 7 entries (5 files, 2 folders)",
      "  omitted: 0",
      "  manifest: out/verification_passed=true changed=9 passed=true/inventory.json",
      "",
    ].join("\n");
    expect(dispatch.parseSummary("inventory", stdout)).toEqual({ scanned: "7", injected: "0", verificationPassed: "n-a" });
  });

  test("REG-WU-065-RC-100-d: execute parses child stdout only, ignoring hostile child stderr", () => {
    const workspace = tempDir("l9-ws-");
    fs.mkdirSync(path.join(workspace, "repo"));
    const actionPath = fakeActionPath(
      "apply-cli.js",
      "apply-cli: scanned=1 planned=1 changed=2 inlineChanged=1 metadataIndexChanged=1 passed=true\n",
      "apply-cli: conflict at passed=false injected=7 changed=7 scanned=9\n",
      0,
    );
    const output = path.join(tempDir("l9-gh-"), "output");
    const run = runActionEnv({
      GITHUB_WORKSPACE: workspace, GITHUB_ACTION_PATH: actionPath, RUNNER_TEMP: tempDir("l9-rt-"),
      GITHUB_OUTPUT: output, L9_INPUT_MODE: "apply", L9_INPUT_ROOT: "repo", L9_INPUT_AUTHORITY: "acme",
      L9_INPUT_OUT: ".out",
    });
    expect(run.status).toBe(0);
    const outputs = readOutputs(output);
    expect(outputs.scanned).toBe("1");
    expect(outputs.injected).toBe("2");
    expect(outputs.verification_passed).toBe("true");
  });

  test("REG-WU-065-RC-100-e: a check or apply child without a summary reports verification false", () => {
    expect(dispatch.parseSummary("check", "")).toEqual({ scanned: "0", injected: "0", verificationPassed: "false" });
    expect(dispatch.parseSummary("apply", "")).toEqual({ scanned: "0", injected: "0", verificationPassed: "false" });
    // A summary-shaped line that is not the full anchored grammar is not a summary.
    expect(dispatch.parseSummary("check", "x check-cli: scanned=3 planned=3 drift=0 authorityConflicts=0 passed=true\n").verificationPassed)
      .toBe("false");
    expect(dispatch.parseSummary("check", "check-cli: scanned=3 planned=3 drift=0 authorityConflicts=0 passed=true trailing\n").verificationPassed)
      .toBe("false");
    // inventory and skills have no verification result, so absence stays n-a.
    expect(dispatch.parseSummary("inventory", "")).toEqual({ scanned: "0", injected: "0", verificationPassed: "n-a" });
    expect(dispatch.parseSummary("skills", "")).toEqual({ scanned: "0", injected: "0", verificationPassed: "n-a" });

    const workspace = tempDir("l9-ws-");
    fs.mkdirSync(path.join(workspace, "repo"));
    const actionPath = fakeActionPath("check-cli.js", "", "check-cli: FAILED: boom\n", 2);
    const output = path.join(tempDir("l9-gh-"), "output");
    const run = runActionEnv({
      GITHUB_WORKSPACE: workspace, GITHUB_ACTION_PATH: actionPath, RUNNER_TEMP: tempDir("l9-rt-"),
      GITHUB_OUTPUT: output, L9_INPUT_MODE: "check", L9_INPUT_ROOT: "repo", L9_INPUT_AUTHORITY: "acme",
    });
    expect(run.status).toBe(2);
    expect(readOutputs(output).verification_passed).toBe("false");
  });

  test("REG-WU-065-RC-100-f: genuine passing summaries are reported as they are", () => {
    expect(dispatch.parseSummary("check", "check-cli: scanned=4 planned=4 drift=0 authorityConflicts=0 passed=true\ncheck-cli: report=/r.json\n"))
      .toEqual({ scanned: "4", injected: "0", verificationPassed: "true" });
    expect(dispatch.parseSummary("apply", "apply-cli: scanned=5 planned=5 changed=3 inlineChanged=2 metadataIndexChanged=1 passed=true\napply-cli: transaction=t plannedWrites=3 committedWrites=3 recovered=0 finalized=1\n"))
      .toEqual({ scanned: "5", injected: "3", verificationPassed: "true" });
    // The FIRST summary line wins; a later line of the same shape cannot override it.
    expect(dispatch.parseSummary("apply", [
      "apply-cli: scanned=5 planned=5 changed=3 inlineChanged=2 metadataIndexChanged=1 passed=false",
      "apply-cli: scanned=9 planned=9 changed=9 inlineChanged=9 metadataIndexChanged=0 passed=true",
      "",
    ].join("\n"))).toEqual({ scanned: "5", injected: "3", verificationPassed: "false" });
  });

  test("REG-WU-065-RC-100-g: a failing check over a file named passed=true.md reports verification false", () => {
    const workspace = tempDir("l9-ws-");
    const repo = path.join(workspace, "repo");
    fs.mkdirSync(path.join(repo, ".l9"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".l9", "meta-authority.yaml"), V1_AUTHORITY);
    fs.writeFileSync(path.join(repo, "passed=true.md"), "# Doc\n\nbody\n");
    const output = path.join(tempDir("l9-gh-"), "output");
    const result = spawnSync(process.execPath, [OPERATION_CLI, "check", "repo", "--authority", "acme"], {
      cwd: workspace, encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: output, RUNNER_TEMP: tempDir("l9-rt-") },
    });
    expect(result.status).toBe(1);
    // The child's first stdout line is its summary; repository text only follows it.
    expect(result.stdout.split("\n")[0]).toMatch(/^check-cli: scanned=\d+ planned=\d+ drift=\d+ authorityConflicts=\d+ passed=false$/);
    expect(result.stdout).toContain("passed=true.md");
    expect(readOutputs(output).verification_passed).toBe("false");
    expect(readOutputs(output).injected).toBe("0");
  });

  test("REG-WU-065-RC-100-h: skills dry-run over unchanged SKILL.md files reports injected=0", () => {
    const workspace = tempDir("l9-ws-");
    const repo = path.join(workspace, "repo");
    fs.mkdirSync(path.join(repo, ".l9"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".l9", "meta-authority.yaml"), V1_AUTHORITY);
    for (const name of ["a", "b"]) {
      fs.mkdirSync(path.join(repo, "skills", name), { recursive: true });
      fs.writeFileSync(path.join(repo, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: Reviews stuff\n---\n\n# ${name}\n\nCheck things.\n`);
    }
    const output = path.join(tempDir("l9-gh-"), "output");
    const result = spawnSync(process.execPath, [OPERATION_CLI, "skills", "repo", "--authority", "acme", "--dry-run"], {
      cwd: workspace, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.split("\n")[0]).toMatch(/^skills-cli: considered=2 changed=0 unchanged=2 /);
    const outputs = readOutputs(output);
    expect(outputs.scanned).toBe("2");
    expect(outputs.injected).toBe("0");
    expect(outputs.verification_passed).toBe("n-a");
  });

  test("the engine writes nothing to stdout, so a child's summary is its first stdout line", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.ts$/.test(entry.name) && /console\.(log|info)\(|process\.stdout\.write/.test(fs.readFileSync(full, "utf8"))) {
          offenders.push(path.relative(REPO, full));
        }
      }
    };
    walk(path.join(REPO, "src"));
    expect(offenders).toEqual([]);
  });
});

describe("RC-105: GITHUB_OUTPUT carries only single-line values", () => {
  function hostileLayout(): string {
    const workspace = tempDir("l9-ws-");
    const hostile = "x\nverification_passed=true\nforged=";
    fs.mkdirSync(path.join(workspace, hostile));
    fs.symlinkSync(path.join(workspace, hostile), path.join(workspace, "skills"));
    return workspace;
  }

  test("REG-WU-065-RC-105-a: a root whose realpath contains a newline is refused", () => {
    const workspace = hostileLayout();
    expect(() => dispatch.normalizeEnvironment({
      GITHUB_WORKSPACE: workspace, GITHUB_ACTION_PATH: REPO, RUNNER_TEMP: tempDir("l9-rt-"),
      L9_INPUT_MODE: "inventory", L9_INPUT_ROOT: "skills", L9_INPUT_NAMESPACE: "ns",
    })).toThrow(dispatch.ActionInputError);
    // An explicit namespace keeps the directory-name default (which would also be refused)
    // out of the way, so this proves the resolved root path itself is checked.
    expect(() => dispatch.normalizeEnvironment({
      GITHUB_WORKSPACE: workspace, GITHUB_ACTION_PATH: REPO, RUNNER_TEMP: tempDir("l9-rt-"),
      L9_INPUT_MODE: "inventory", L9_INPUT_ROOT: "skills", L9_INPUT_NAMESPACE: "ns",
    })).toThrow(/^root .*control character/);
  });

  test("REG-WU-065-RC-105-b: the command line refuses the same layout", () => {
    const workspace = hostileLayout();
    const previous = process.cwd();
    process.chdir(workspace);
    try {
      expect(() => dispatch.parseCommandLine(["inventory", "skills", "--namespace", "ns"], {}))
        .toThrow(dispatch.ActionInputError);
      expect(() => dispatch.parseCommandLine(["inventory", "skills", "--namespace", "ns"], {}))
        .toThrow(/^root .*control character/);
    } finally {
      process.chdir(previous);
    }
  });

  test("REG-WU-065-RC-105-c: appendOutput refuses a value or key with a line break and writes nothing", () => {
    const file = path.join(tempDir("l9-gh-"), "output");
    fs.writeFileSync(file, "scanned=1\n");
    expect(() => operationCli().appendOutput(file, "artifact_path", "a\nb")).toThrow(/control character/);
    expect(() => operationCli().appendOutput(file, "artifact_path", "a\rb")).toThrow(/control character/);
    expect(() => operationCli().appendOutput(file, "artifact_path", "a\u0000b")).toThrow(/control character/);
    expect(() => operationCli().appendOutput(file, "bad\nkey", "a")).toThrow(/control character/);
    expect(fs.readFileSync(file, "utf8")).toBe("scanned=1\n");
    operationCli().appendOutput(file, "injected", 0);
    expect(fs.readFileSync(file, "utf8")).toBe("scanned=1\ninjected=0\n");
  });

  test("REG-WU-065-RC-105-d: the Action step exits 2 and writes no output for that layout", () => {
    const workspace = hostileLayout();
    const output = path.join(tempDir("l9-gh-"), "output");
    const run = runActionEnv({
      GITHUB_WORKSPACE: workspace, GITHUB_ACTION_PATH: REPO, RUNNER_TEMP: tempDir("l9-rt-"),
      GITHUB_OUTPUT: output, L9_INPUT_MODE: "inventory", L9_INPUT_ROOT: "skills", L9_INPUT_DRY_RUN: "true",
      L9_INPUT_NAMESPACE: "ns",
    });
    expect(run.status).toBe(2);
    expect(fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "").toBe("");
  });

  test("REG-WU-065-RC-105-e: an ordinary symlinked root inside the workspace is still accepted", () => {
    const workspace = tempDir("l9-ws-");
    fs.mkdirSync(path.join(workspace, "real-root"));
    fs.symlinkSync(path.join(workspace, "real-root"), path.join(workspace, "skills"));
    const config = dispatch.normalizeEnvironment({
      GITHUB_WORKSPACE: workspace, GITHUB_ACTION_PATH: REPO, RUNNER_TEMP: tempDir("l9-rt-"),
      L9_INPUT_MODE: "inventory", L9_INPUT_ROOT: "skills",
    }) as { targetRoot: string };
    expect(config.targetRoot).toBe(path.join(workspace, "real-root"));
  });
});
