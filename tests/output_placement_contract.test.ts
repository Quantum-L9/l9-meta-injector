/**
 * Output placement contract (finding F-2).
 *
 * The dispatcher and the single-purpose CLIs use different defaults on purpose. This
 * suite is the mechanism that keeps that difference *documented* rather than emergent:
 * it fails when code, `docs/output-placement-contract.md`, and
 * `docs/architecture-authority.json` stop agreeing.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const dispatch = require("../scripts/lib/operation-dispatch") as {
  normalizeEnvironment: (env: NodeJS.ProcessEnv) => Record<string, unknown>;
  parseCommandLine: (argv: string[], env?: NodeJS.ProcessEnv) => Record<string, unknown>;
};

const REPO = path.resolve(__dirname, "..");
const CONTRACT_DOC = path.join(REPO, "docs", "output-placement-contract.md");
const AUTHORITY = path.join(REPO, "docs", "architecture-authority.json");

const roots: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}
function tempRepository(): { workspace: string; relative: string } {
  const workspace = tempDir("l9-placement-");
  fs.mkdirSync(path.join(workspace, "fixture"));
  fs.writeFileSync(path.join(workspace, "fixture", "doc.md"), "# Doc\n\nbody\n", "utf8");
  return { workspace, relative: "fixture" };
}
function withCwd<T>(directory: string, run: () => T): T {
  const previous = process.cwd();
  process.chdir(directory);
  try { return run(); } finally { process.chdir(previous); }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function authorityPlacement(): Record<string, unknown> {
  const authority = JSON.parse(fs.readFileSync(AUTHORITY, "utf8")) as {
    contracts: Record<string, string>;
    invocation_boundary: { output_placement: Record<string, unknown> };
  };
  expect(authority.contracts.output_placement).toBe("docs/output-placement-contract.md");
  return authority.invocation_boundary.output_placement;
}

describe("the contract document is the declared source of truth", () => {
  test("the architecture authority names it and denies a single shared default", () => {
    const placement = authorityPlacement();
    expect(fs.existsSync(CONTRACT_DOC)).toBe(true);
    expect(placement.contract).toBe("docs/output-placement-contract.md");
    expect(placement.single_shared_default).toBe(false);
    expect(placement.defaults_are_context_specific_by_design).toBe(true);
    expect(String(placement.dispatcher_default_reason)).toMatch(/artifact path/);
  });

  test("every default the document lists is the default the script actually uses", () => {
    const placement = authorityPlacement();
    const declared = placement.direct_cli_defaults as Record<string, string>;
    const doc = fs.readFileSync(CONTRACT_DOC, "utf8");
    const sources: Record<string, string> = {
      "scripts/inventory.js": "`${root}.l9inventory`",
      "scripts/apply-cli.js": "`${targetRoot}.l9out`",
      "scripts/skills-cli.js": "`${root}.l9skills`",
    };
    for (const [script, literal] of Object.entries(sources)) {
      expect(fs.readFileSync(path.join(REPO, script), "utf8")).toContain(`opt("--out", ${literal})`);
      expect(doc).toContain(declared[script]);
    }
    expect(fs.readFileSync(path.join(REPO, "scripts", "check-cli.js"), "utf8"))
      .toContain("l9-meta-injector-check-${process.pid}.json");
    expect(doc).toContain(declared["scripts/check-cli.js"]);
    expect(doc).toContain(declared["scripts/operation-cli.js"]);
  });
});

describe("dispatcher default is documented and contained", () => {
  test("the Action default lands inside the target root, as documented", () => {
    const { workspace, relative } = tempRepository();
    const config = dispatch.normalizeEnvironment({
      GITHUB_WORKSPACE: workspace,
      GITHUB_ACTION_PATH: tempDir("l9-action-"),
      RUNNER_TEMP: tempDir("l9-runner-"),
      L9_INPUT_MODE: "inventory",
      L9_INPUT_ROOT: relative,
    }) as { outDir: string; targetRoot: string };
    const placement = authorityPlacement();
    expect(config.outDir).toBe(path.join(config.targetRoot, String(placement.dispatcher_default_out)));
    expect(placement.dispatcher_default_out_is_inside_target_root).toBe(true);
  });

  test("check keeps its report out of the target repository entirely", () => {
    const { workspace, relative } = tempRepository();
    const runnerTemp = tempDir("l9-runner-");
    const config = dispatch.normalizeEnvironment({
      GITHUB_WORKSPACE: workspace,
      GITHUB_ACTION_PATH: tempDir("l9-action-"),
      RUNNER_TEMP: runnerTemp,
      L9_INPUT_MODE: "check",
      L9_INPUT_ROOT: relative,
      L9_INPUT_AUTHORITY: "acme.owner",
    }) as { reportPath: string; targetRoot: string };
    expect(path.relative(config.targetRoot, config.reportPath).startsWith("..")).toBe(true);
  });
});

describe("explicit out has the same semantics across dispatcher entrypoints", () => {
  const cases: Array<{ label: string; resolve: (workspace: string, relative: string, out: string) => string }> = [
    {
      label: "action environment",
      resolve: (workspace, relative, out) => String((dispatch.normalizeEnvironment({
        GITHUB_WORKSPACE: workspace,
        GITHUB_ACTION_PATH: tempDir("l9-action-"),
        RUNNER_TEMP: tempDir("l9-runner-"),
        L9_INPUT_MODE: "inventory",
        L9_INPUT_ROOT: relative,
        L9_INPUT_OUT: out,
      }) as { outDir: string }).outDir),
    },
    {
      label: "direct argv",
      resolve: (workspace, relative, out) => withCwd(workspace, () => String((dispatch.parseCommandLine(
        ["inventory", relative, "--out", out],
        { RUNNER_TEMP: workspace },
      ) as { outDir: string }).outDir)),
    },
  ];

  for (const { label, resolve } of cases) {
    test(`${label}: an explicit relative out resolves against the target root`, () => {
      const { workspace, relative } = tempRepository();
      expect(resolve(workspace, relative, "reports/run")).toBe(path.join(workspace, relative, "reports", "run"));
    });

    test(`${label}: an escaping, absolute, root, or Git-internal out is refused`, () => {
      const { workspace, relative } = tempRepository();
      expect(() => resolve(workspace, relative, "../escape")).toThrow(/escapes/);
      expect(() => resolve(workspace, relative, path.join(workspace, "abs"))).toThrow(/must be relative/);
      expect(() => resolve(workspace, relative, ".")).toThrow(/child path/);
      expect(() => resolve(workspace, relative, ".git/out")).toThrow(/Git internal/);
    });
  }
});

describe("governed modes create no untracked output directory", () => {
  test("apply and check declare no persisted pipeline outputs", () => {
    const placement = authorityPlacement();
    expect(placement.apply_creates_no_output_directory).toBe(true);
    expect(placement.check_creates_no_output_directory).toBe(true);
    for (const script of ["apply-cli.js", "check-cli.js"]) {
      expect(fs.readFileSync(path.join(REPO, "scripts", script), "utf8")).toContain("persistOutputs: false");
    }
  });
});
