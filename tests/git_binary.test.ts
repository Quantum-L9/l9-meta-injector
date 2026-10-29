/**
 * WU-069 (RC-106): gitBinary resolves an absolute path only. A relative PATH entry
 * ('.', 'relbin') would hand back a cwd-relative name that a later spawn with another
 * cwd re-resolves, which is the PATH hijack the module exists to prevent.
 *
 * gitBinary memoizes per process, so each case runs in a child process with a
 * controlled PATH. The cases are POSIX-only: the hijack stub is a `#!/bin/sh` script
 * named `git`, while on Windows gitBinary looks for git.exe / git.cmd; the
 * isAbsolute guard under test is platform-neutral.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const MODULE = path.join(__dirname, "..", "scripts", "lib", "git-binary.js");
const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function realGitDirectory(): string {
  const { gitBinary } = require(MODULE) as { gitBinary: (onMissing: (message: string) => never) => string };
  const git = gitBinary((message) => { throw new Error(message); });
  expect(path.isAbsolute(git)).toBe(true);
  return path.dirname(git);
}

function workdirWithStub(relativeDir: string): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "l9-git-binary-"));
  made.push(cwd);
  const stubDir = path.join(cwd, relativeDir);
  fs.mkdirSync(stubDir, { recursive: true });
  fs.writeFileSync(path.join(stubDir, "git"), "#!/bin/sh\necho HIJACK\n", { mode: 0o755 });
  return cwd;
}

function resolveIn(cwd: string, pathValue: string): { status: number | null; stdout: string; stderr: string } {
  const script = `const { gitBinary } = require(${JSON.stringify(MODULE)});
const resolved = gitBinary((message) => { process.stdout.write("MISSING:" + message); process.exit(3); });
process.stdout.write(resolved);`;
  const result = spawnSync(process.execPath, ["-e", script], { cwd, env: { ...process.env, PATH: pathValue }, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe.skipIf(process.platform === "win32")("gitBinary resolves absolute paths only (RC-106)", () => {
  test("REG-WU-069-RC-106-a: a '.' PATH entry ahead of the real git is skipped", () => {
    const realDir = realGitDirectory();
    const cwd = workdirWithStub(".");
    const result = resolveIn(cwd, [".", realDir].join(path.delimiter));
    expect(result.status).toBe(0);
    expect(path.isAbsolute(result.stdout)).toBe(true);
    expect(result.stdout).toBe(path.join(realDir, "git"));
  });

  test("REG-WU-069-RC-106-b: a relative directory PATH entry is skipped", () => {
    const realDir = realGitDirectory();
    const cwd = workdirWithStub("relbin");
    const result = resolveIn(cwd, ["relbin", realDir].join(path.delimiter));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(path.join(realDir, "git"));
  });

  test("REG-WU-069-RC-106-c: only relative PATH entries means git is missing", () => {
    const cwd = workdirWithStub("relbin");
    fs.copyFileSync(path.join(cwd, "relbin", "git"), path.join(cwd, "git"));
    fs.chmodSync(path.join(cwd, "git"), 0o755);
    const result = resolveIn(cwd, [".", "relbin"].join(path.delimiter));
    expect(result.status).toBe(3);
    expect(result.stdout).toBe("MISSING:cannot locate a git executable on PATH");
  });

  test("REG-WU-069-RC-106-d: the default PATH still yields an absolute git", () => {
    const realDir = realGitDirectory();
    const result = resolveIn(os.tmpdir(), process.env.PATH ?? "");
    expect(result.status).toBe(0);
    expect(path.isAbsolute(result.stdout)).toBe(true);
    expect(path.dirname(result.stdout)).toBe(realDir);
  });
});
