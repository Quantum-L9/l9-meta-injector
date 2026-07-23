import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";

const REPO = path.resolve(__dirname, "..");
const lib = require(path.join(REPO, "scripts/lib/architecture-authority.js"));
function run(script: string, args: string[] = []) {
  return cp.spawnSync(process.execPath, [path.join(REPO, script), ...args], { cwd: REPO, encoding: "utf8" });
}

describe("RAA-005 architecture authority", () => {
  test("the active authority corpus is internally consistent", () => {
    const r = run("scripts/check-architecture-authority.js");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("architecture-authority: OK");
  });
  test("the deterministic authority manifest is current", () => {
    const r = run("scripts/generate-architecture-manifest.js", ["--check"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("architecture-manifest: OK");
  });
  test("the authority shape rejects undeclared fields", () => {
    const authority = JSON.parse(fs.readFileSync(path.join(REPO, "docs/architecture-authority.json"), "utf8"));
    authority.unexpected = true;
    expect(lib.validateAuthorityDocument(authority)).toContain("authority.unexpected is not allowed");
  });
  test("the traceability map rejects duplicate capability names", () => {
    const trace = JSON.parse(fs.readFileSync(path.join(REPO, "docs/traceability-map.json"), "utf8"));
    trace.capabilities.push({ ...trace.capabilities[0] });
    expect(lib.validateTraceabilityDocument(trace).some((x: string) => x.includes("duplicated"))).toBe(true);
  });
  test("legacy archive and moved schemas retain audited blob identities", () => {
    expect(lib.verifyLegacyArchive(REPO)).toEqual([]);
  });
});
