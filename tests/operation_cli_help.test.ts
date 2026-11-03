/**
 * Consumer-facing CLI usability (plan T4): `--help` / `-h` print the usage on stdout
 * and exit 0, the bin is committed executable, and the ADR-022 absolute-root refusal
 * names the supported invocation instead of leaving a consumer to guess it.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";

const CLI = path.join(__dirname, "..", "scripts", "operation-cli.js");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

describe("operation-cli help and root guidance", () => {
  test.each([["--help"], ["-h"]])("%s prints usage on stdout and exits 0", (flag) => {
    const result = runCli([flag], os.tmpdir());
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^usage: l9-meta-injector <inventory\|check\|apply\|skills\|pipeline> <root>/);
    expect(result.stdout).toContain(".l9/meta-authority.yaml");
    expect(result.stderr).toBe("");
  });

  test("--help after a mode still prints help and exits 0", () => {
    const result = runCli(["inventory", "--help"], os.tmpdir());
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^usage: l9-meta-injector/);
  });

  test("help does not advertise the refused --no-fail-on-issues form", () => {
    const result = runCli(["--help"], os.tmpdir());
    expect(result.stdout).toContain("--no-fail-on-issues is refused");
  });

  test("a missing root still fails as invalid input and points at --help", () => {
    const result = runCli(["inventory"], os.tmpdir());
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("run 'l9-meta-injector --help' for details");
  });

  test("an absolute root is refused with the supported invocation named", () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "l9-cli-abs-"));
    try {
      const result = runCli(["inventory", target], os.tmpdir());
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/root must be relative, got absolute path/);
      expect(result.stderr).toContain("cd <repo> && l9-meta-injector inventory .");
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test("the bin is committed with the executable bit", () => {
    const listed = spawnSync("git", ["ls-files", "-s", "--", "scripts/operation-cli.js"], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
    });
    if (listed.status !== 0 || listed.stdout.trim() === "") return; // not a git checkout (packed tree)
    expect(listed.stdout.split(/\s+/)[0]).toBe("100755");
  });
});
