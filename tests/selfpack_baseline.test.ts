/**
 * WU-071 (RC-109): selfpack never passes vacuously. A missing committed baseline is a
 * hard failure (exit 2, nothing written) unless an update is explicitly requested.
 *
 * selfpack writes its baseline beside itself, so every case runs a copy of
 * scripts/selfpack.js inside a disposable mirror (fixtures, dist and node_modules
 * linked read-only) and never touches this repository's committed baseline.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const REPO = path.join(__dirname, "..");
const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function mirror(): { root: string; baseline: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-selfpack-mirror-"));
  made.push(root);
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(path.join(REPO, "scripts", "selfpack.js"), path.join(root, "scripts", "selfpack.js"));
  fs.copyFileSync(path.join(REPO, "package.json"), path.join(root, "package.json"));
  for (const name of ["dist", "fixtures", "node_modules"]) fs.symlinkSync(path.join(REPO, name), path.join(root, name), "dir");
  return { root, baseline: path.join(root, "scripts", "selfpack.baseline.json") };
}

function selfpack(root: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const childEnv = { ...process.env, ...env };
  if (!("SELFPACK_UPDATE" in env)) delete childEnv.SELFPACK_UPDATE;
  return spawnSync(process.execPath, [path.join(root, "scripts", "selfpack.js"), ...args], { cwd: root, env: childEnv, encoding: "utf8" });
}

describe("selfpack baseline contract (RC-109)", () => {
  test("REG-WU-071-RC-109-a: no baseline and no update request is a hard failure that writes nothing", () => {
    const { root, baseline } = mirror();
    const result = selfpack(root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("scripts/selfpack.baseline.json");
    expect(result.stderr).toContain("selfpack:update");
    expect(fs.existsSync(baseline)).toBe(false);
  }, 60_000);

  test("REG-WU-071-RC-109-b: --update and SELFPACK_UPDATE=1 write the baseline and exit 0", () => {
    const { root, baseline } = mirror();
    const viaFlag = selfpack(root, ["--update"]);
    expect(viaFlag.status).toBe(0);
    expect(fs.existsSync(baseline)).toBe(true);
    fs.rmSync(baseline);
    const viaEnv = selfpack(root, [], { SELFPACK_UPDATE: "1" });
    expect(viaEnv.status).toBe(0);
    expect(fs.existsSync(baseline)).toBe(true);
  }, 60_000);

  test("REG-WU-071-RC-109-c: a matching baseline passes and a differing one drifts", () => {
    const { root, baseline } = mirror();
    expect(selfpack(root, ["--update"]).status).toBe(0);
    const matching = selfpack(root);
    expect(matching.status).toBe(0);
    expect(matching.stdout).toContain("output matches baseline");
    fs.writeFileSync(baseline, fs.readFileSync(baseline, "utf8").replace(/"scanned": \d+/, "\"scanned\": -1"));
    const drift = selfpack(root);
    expect(drift.status).toBe(1);
    expect(drift.stderr).toContain("scripts/selfpack.baseline.json");
  }, 90_000);
});
