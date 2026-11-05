import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(__dirname, "..");
const facadeSha256 = "59d75892d7c8af83916187c5af612d2c9697741a68017265059567e4ea33cba6";

function sandbox(): { dir: string; env: NodeJS.ProcessEnv; log: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-repo-execution-"));
  const bin = path.join(dir, "bin");
  const log = path.join(dir, "commands.log");
  fs.mkdirSync(bin);
  for (const name of ["Makefile", "Repo.mk"]) {
    fs.copyFileSync(path.join(root, name), path.join(dir, name));
  }
  fs.writeFileSync(path.join(bin, "npm"), [
    "#!/bin/sh",
    "printf '%s\\n' \"npm $*\" >> \"$REPO_EXECUTION_LOG\"",
    "if [ \"$*\" = \"${REPO_EXECUTION_FAIL:-}\" ]; then exit 23; fi",
    "",
  ].join("\n"), { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "git"), [
    "#!/bin/sh",
    "printf '%s\\n' \"git $*\" >> \"$REPO_EXECUTION_LOG\"",
    "exit 0",
    "",
  ].join("\n"), { mode: 0o755 });
  return {
    dir,
    log,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, REPO_EXECUTION_LOG: log },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function make(dir: string, env: NodeJS.ProcessEnv, target: string) {
  return spawnSync("make", [target], { cwd: dir, env, encoding: "utf8" });
}

function commands(log: string): string[] {
  return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
}

describe("Core repository execution", () => {
  test("declares the exact V2 contract and released make-v1 facade", () => {
    const contract = JSON.parse(fs.readFileSync(path.join(root, ".l9/repo-workflow.json"), "utf8"));
    expect(contract).toEqual({
      schema: "l9.repo-execution/v2",
      facade: "make-v1",
      required_phases: ["setup", "validate", "check", "test"],
    });
    const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "Makefile"))).digest("hex");
    expect(digest).toBe(facadeSha256);
  });

  test("ignores Core runtime state without ignoring repository contracts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-runtime-ignore-"));
    try {
      fs.copyFileSync(path.join(root, ".gitignore"), path.join(dir, ".gitignore"));
      const init = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
      expect(init.status, init.stderr).toBe(0);
      const ignored = (name: string) => spawnSync("git", ["check-ignore", "-q", name], { cwd: dir }).status;
      expect(ignored(".l9/runtime/sdk/bin/l9-ci")).toBe(0);
      expect(ignored(".l9/runtime/toolchain-alignment.json")).toBe(0);
      expect(ignored(".l9/repo-workflow.json")).toBe(1);
      expect(ignored(".l9/meta-authority.yaml")).toBe(1);
      expect(ignored(".l9/metadata-index.jsonl")).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("routes every phase to real repository commands in order", () => {
    const box = sandbox();
    try {
      for (const phase of ["setup", "validate", "check", "test"]) {
        const result = make(box.dir, box.env, phase);
        expect(result.status, result.stderr).toBe(0);
      }
      expect(commands(box.log)).toEqual([
        "npm ci --ignore-scripts",
        "npm run check:authority",
        "npm run check:manifest",
        "npm run lint",
        "npm run validate",
      ]);
    } finally {
      box.cleanup();
    }
  });

  test("fails closed when a validation command fails", () => {
    const box = sandbox();
    try {
      const result = make(box.dir, { ...box.env, REPO_EXECUTION_FAIL: "run check:authority" }, "validate");
      expect(result.status).not.toBe(0);
      expect(commands(box.log)).toEqual(["npm run check:authority"]);
    } finally {
      box.cleanup();
    }
  });

  test("preserves the publication gate and does not push on a failed check", () => {
    const box = sandbox();
    try {
      const result = make(box.dir, { ...box.env, REPO_EXECUTION_FAIL: "run lint" }, "pr");
      expect(result.status).not.toBe(0);
      expect(commands(box.log)).toEqual(["npm run lint"]);
    } finally {
      box.cleanup();
    }
  });
});
