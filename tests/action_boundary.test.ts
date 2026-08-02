import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { LEGACY_OPERATION_ALIASES as TS_ALIASES, OPERATION_MODES as TS_MODES } from "../src/operation_contracts";

const dispatch = require("../scripts/lib/operation-dispatch") as {
  OPERATION_MODES: readonly string[];
  LEGACY_OPERATION_ALIASES: Readonly<Record<string, string>>;
  normalizeEnvironment: (env: NodeJS.ProcessEnv) => Record<string, unknown>;
  buildInvocation: (config: Record<string, unknown>) => { args: string[]; shell: boolean; artifactPath: string; env: Record<string, string | undefined> };
  resolveMode: (mode: string) => { mode: string; warnings: string[] };
};

const roots: string[] = [];
function tempDir(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function actionEnv(workspace: string, actionPath: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_WORKSPACE: workspace,
    GITHUB_ACTION_PATH: actionPath,
    RUNNER_TEMP: tempDir("l9-runner-"),
    GITHUB_RUN_ID: "123",
    GITHUB_ACTION: "test",
    L9_INPUT_MODE: "inventory",
    L9_INPUT_ROOT: ".",
    L9_INPUT_OUT: ".l9-out",
    L9_INPUT_AUTHORITY: "",
    L9_INPUT_DRY_RUN: "",
    L9_INPUT_FAIL_ON_ISSUES: "true",
    L9_INPUT_LLM: "false",
    L9_INPUT_LLM_ALLOW_INSECURE: "false",
    ...overrides,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("canonical operation dispatch", () => {
  test("JavaScript Action modes remain identical to the TypeScript contract", () => {
    expect(dispatch.OPERATION_MODES).toEqual([...TS_MODES]);
    expect(dispatch.LEGACY_OPERATION_ALIASES).toEqual(TS_ALIASES);
  });

  test("unknown and empty modes fail instead of falling back to inventory", () => {
    expect(() => dispatch.resolveMode("ship-it")).toThrow(/unsupported operation mode/);
    expect(() => dispatch.resolveMode("")).toThrow(/<empty>/);
  });

  test("pipeline is only a deprecated alias for apply", () => {
    const resolved = dispatch.resolveMode("pipeline");
    expect(resolved.mode).toBe("apply");
    expect(resolved.warnings.join(" ")).toMatch(/deprecated/);
  });
});

describe("workspace containment", () => {
  test("rejects traversal and absolute root inputs", () => {
    const workspace = tempDir("l9-workspace-");
    const actionPath = tempDir("l9-action-");
    expect(() => dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, { L9_INPUT_ROOT: "../outside" }))).toThrow(/escapes/);
    expect(() => dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, { L9_INPUT_ROOT: path.parse(workspace).root }))).toThrow(/must be relative/);
  });

  test("rejects a root symlink that resolves outside the workspace", () => {
    const workspace = tempDir("l9-workspace-");
    const actionPath = tempDir("l9-action-");
    const outside = tempDir("l9-outside-");
    fs.symlinkSync(outside, path.join(workspace, "escape"), "dir");
    expect(() => dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, { L9_INPUT_ROOT: "escape" }))).toThrow(/resolves outside/);
  });

  test("rejects outputs at the repository root or inside Git internals", () => {
    const workspace = tempDir("l9-workspace-");
    const actionPath = tempDir("l9-action-");
    fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
    expect(() => dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, { L9_INPUT_OUT: "." }))).toThrow(/child path/);
    expect(() => dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, { L9_INPUT_OUT: ".git/reports" }))).toThrow(/Git internal/);
    expect(() => dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, { L9_INPUT_ROOT: ".git" }))).toThrow(/Git internal/);
  });

  test("rejects output traversal through an existing symlink ancestor", () => {
    const workspace = tempDir("l9-workspace-");
    const actionPath = tempDir("l9-action-");
    const outside = tempDir("l9-outside-");
    fs.symlinkSync(outside, path.join(workspace, "out-link"), "dir");
    expect(() => dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, { L9_INPUT_OUT: "out-link/reports" }))).toThrow(/symlink outside/);
  });

  test("places check reports beneath RUNNER_TEMP and outside the target repository", () => {
    const workspace = tempDir("l9-workspace-");
    const actionPath = tempDir("l9-action-");
    const env = actionEnv(workspace, actionPath, {
      L9_INPUT_MODE: "check",
      L9_INPUT_AUTHORITY: "repo.owner",
    });
    const config = dispatch.normalizeEnvironment(env) as { reportPath: string; targetRoot: string };
    expect(path.relative(config.targetRoot, config.reportPath).startsWith("..")).toBe(true);
    expect(config.reportPath.startsWith(String(env.RUNNER_TEMP))).toBe(true);
  });
});

describe("input semantics", () => {
  test("requires explicit authority for check and apply", () => {
    const workspace = tempDir("l9-workspace-");
    const actionPath = tempDir("l9-action-");
    expect(() => dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, { L9_INPUT_MODE: "check" }))).toThrow(/explicit authority/);
    expect(() => dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, { L9_INPUT_MODE: "apply" }))).toThrow(/explicit authority/);
  });

  test("rejects ambiguous booleans and unsafe mode combinations", () => {
    const workspace = tempDir("l9-workspace-");
    const actionPath = tempDir("l9-action-");
    expect(() => dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, { L9_INPUT_DRY_RUN: "yes" }))).toThrow(/exactly 'true' or 'false'/);
    expect(() => dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, { L9_INPUT_UPLOAD_ARTIFACT: "sometimes" }))).toThrow(/exactly 'true' or 'false'/);
    expect(() => dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, {
      L9_INPUT_MODE: "apply", L9_INPUT_AUTHORITY: "repo.owner", L9_INPUT_DRY_RUN: "true",
    }))).toThrow(/use check/);
    expect(() => dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, {
      L9_INPUT_MODE: "check", L9_INPUT_AUTHORITY: "repo.owner", L9_INPUT_LLM: "true",
      L9_INPUT_LLM_BASE_URL: "https://example.invalid", L9_INPUT_LLM_MODEL: "x", L9_INPUT_LLM_API_KEY: "secret",
    }))).toThrow(/forbids LLM/);
  });

  test("passes hostile shell metacharacters as one argv element with shell disabled", () => {
    const workspace = tempDir("l9-workspace-");
    const actionPath = tempDir("l9-action-");
    const pattern = "$(touch /tmp/should-not-exist)";
    const config = dispatch.normalizeEnvironment(actionEnv(workspace, actionPath, { L9_INPUT_OMIT: pattern }));
    const invocation = dispatch.buildInvocation(config);
    expect(invocation.shell).toBe(false);
    expect((invocation as unknown as { env: Record<string, string | undefined> }).env.L9_INPUT_LLM_API_KEY).toBe(undefined);
    const index = invocation.args.indexOf("--omit");
    expect(invocation.args[index + 1]).toBe(pattern);
  });
});

describe("composite Action source boundary", () => {
  const action = fs.readFileSync(path.resolve(__dirname, "..", "action.yml"), "utf8");

  test("routes every mode through one Node dispatcher", () => {
    expect(action).toContain("run: node scripts/operation-cli.js --action-env");
    expect(action).not.toContain("if: inputs.mode == 'check'");
    expect(action).not.toContain("if: inputs.mode != 'check'");
  });

  test("does not interpolate caller inputs into shell source", () => {
    const runLines = action.split(/\r?\n/).filter((line) => /^\s*run:/.test(line));
    expect(runLines.length).toBeGreaterThan(0);
    for (const line of runLines) expect(line).not.toContain("${{ inputs.");
  });

  test("pins every external Action to a full immutable SHA", () => {
    const uses = action.split(/\r?\n/).filter((line) => /^\s*uses:/.test(line));
    expect(uses).toHaveLength(2);
    for (const line of uses) expect(line).toMatch(/@[0-9a-f]{40}(?:\s+#.*)?$/);
    expect(action).not.toMatch(/uses:\s+[^\s]+@v\d+/);
  });

  test("uploads only the dispatcher's contained artifact path", () => {
    expect(action).toContain("path: ${{ steps.run.outputs.artifact_path }}");
    expect(action).not.toContain("${{ github.workspace }}/${{ inputs.root }}");
  });
});
