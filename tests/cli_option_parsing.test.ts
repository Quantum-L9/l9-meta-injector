/**
 * Argv parsing contract for the governed dispatcher (finding F-1).
 *
 * A boolean flag is a bare presence flag. It must never consume the following argv
 * element, because doing so silently turns `--dry-run --out reports` into
 * `dry-run="--out"` plus an unknown option `reports` — a misparse that reports itself
 * as an input error about an option the operator never mistyped.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const dispatch = require("../scripts/lib/operation-dispatch") as {
  BOOLEAN_OPTIONS: readonly string[];
  REPEATABLE_OPTIONS: readonly string[];
  VALUE_OPTIONS: readonly string[];
  parseArgOptions: (args: string[]) => { values: Map<string, string>; repeated: Map<string, string[]> };
  parseCommandLine: (argv: string[], env?: NodeJS.ProcessEnv) => Record<string, unknown>;
  parseBoolean: (name: string, raw: unknown, defaultValue: boolean) => boolean;
};

const roots: string[] = [];
function tempRepository(): { workspace: string; relative: string } {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "l9-cli-args-")));
  roots.push(workspace);
  fs.mkdirSync(path.join(workspace, "fixture"));
  fs.writeFileSync(path.join(workspace, "fixture", "doc.md"), "# Doc\n\nbody\n", "utf8");
  return { workspace, relative: "fixture" };
}

/** parseCommandLine resolves the root against the real process cwd. */
function withCwd<T>(directory: string, run: () => T): T {
  const previous = process.cwd();
  process.chdir(directory);
  try { return run(); } finally { process.chdir(previous); }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("boolean flags do not consume the next option", () => {
  test("the contract probe parses as a bare boolean plus an intact value option", () => {
    const { values } = dispatch.parseArgOptions(["--dry-run", "--out", "reports"]);
    expect(dispatch.parseBoolean("dry-run", values.get("--dry-run"), false)).toBe(true);
    expect(values.get("--out")).toBe("reports");
  });

  test("every declared boolean option is bare and leaves the following option alone", () => {
    for (const option of dispatch.BOOLEAN_OPTIONS) {
      const { values } = dispatch.parseArgOptions([option, "--glob", "docs/**"]);
      expect(dispatch.parseBoolean(option, values.get(option), false)).toBe(true);
      expect(values.get("--glob")).toBe("docs/**");
    }
  });

  test("--no-<flag> is the explicit false form and also consumes nothing", () => {
    const { values } = dispatch.parseArgOptions(["--no-fail-on-issues", "--namespace", "acme"]);
    expect(dispatch.parseBoolean("fail-on-issues", values.get("--fail-on-issues"), true)).toBe(false);
    expect(values.get("--namespace")).toBe("acme");
  });

  test("a trailing boolean flag is still true and is not reported as a missing value", () => {
    const { values } = dispatch.parseArgOptions(["--glob", "**/*", "--llm"]);
    expect(dispatch.parseBoolean("llm", values.get("--llm"), false)).toBe(true);
  });
});

describe("compatibility rules survive the fix", () => {
  test("duplicate options are still rejected, including across the negated form", () => {
    expect(() => dispatch.parseArgOptions(["--out", "a", "--out", "b"])).toThrow(/only once/);
    expect(() => dispatch.parseArgOptions(["--dry-run", "--dry-run"])).toThrow(/only once/);
    expect(() => dispatch.parseArgOptions(["--dry-run", "--no-dry-run"])).toThrow(/only once/);
  });

  test("unknown options are still rejected", () => {
    expect(() => dispatch.parseArgOptions(["--nope", "x"])).toThrow(/unknown option '--nope'/);
  });

  test("repeatable options still collect every occurrence", () => {
    const { repeated } = dispatch.parseArgOptions(["--omit", "a", "--omit", "b", "--namespace-glob", "x=y"]);
    expect(repeated.get("--omit")).toEqual(["a", "b"]);
    expect(repeated.get("--namespace-glob")).toEqual(["x=y"]);
  });

  test("a value option is never silently satisfied by a following option token", () => {
    expect(() => dispatch.parseArgOptions(["--out"])).toThrow(/--out requires a value/);
    expect(() => dispatch.parseArgOptions(["--out", "--glob", "**/*"]))
      .toThrow(/--out requires a value, got option '--glob'/);
  });

  test("Action environment boolean strings keep their exact 'true'/'false' grammar", () => {
    expect(dispatch.parseBoolean("dry-run", "true", false)).toBe(true);
    expect(dispatch.parseBoolean("dry-run", "false", true)).toBe(false);
    expect(dispatch.parseBoolean("dry-run", "", true)).toBe(true);
    expect(() => dispatch.parseBoolean("dry-run", "yes", false)).toThrow(/exactly 'true' or 'false'/);
  });
});

describe("end-to-end command lines", () => {
  test("check accepts the bare --dry-run flag alongside --out", () => {
    const { workspace, relative } = tempRepository();
    const config = withCwd(workspace, () => dispatch.parseCommandLine(
      ["check", relative, "--dry-run", "--out", "reports", "--authority", "acme.owner"],
      { RUNNER_TEMP: workspace },
    )) as { dryRun: boolean; outDir: string; authority: string };
    expect(config.dryRun).toBe(true);
    expect(config.authority).toBe("acme.owner");
    expect(config.outDir).toBe(path.join(workspace, relative, "reports"));
  });

  test("apply + --dry-run fails on the documented mode rule, not on a parse error", () => {
    const { workspace, relative } = tempRepository();
    // The pre-fix defect surfaced here as "unknown option 'reports'" or as a boolean
    // grammar complaint about '--out'. Both are parse errors and both are now gone.
    expect(() => withCwd(workspace, () => dispatch.parseCommandLine(
      ["apply", relative, "--dry-run", "--out", "reports", "--authority", "acme.owner"],
      { RUNNER_TEMP: workspace },
    ))).toThrow(/apply does not accept dry-run=true; use check/);
  });
});
