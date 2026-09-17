import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

describe("release identity", () => {
  it("derives exact and maintained-major identity from package version", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
    const major = pkg.version.split(".")[0];
    const exactTag = `v${pkg.version}`;
    const plan = JSON.parse(fs.readFileSync(path.join(ROOT, `docs/release/${exactTag}-release-plan.json`), "utf8"));
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].version).toBe(pkg.version);
    expect(lock.packages[""].license).toBe(pkg.license);
    expect(pkg.bin["l9-meta-injector"]).toBe("scripts/operation-cli.js");
    expect(pkg.files).toContain("scripts");
    expect(plan.release_version).toBe(pkg.version);
    expect(plan.tag).toBe(exactTag);
    expect(plan.maintained_major_tag).toBe(`v${major}`);
    expect(plan.consumer_ref).toBe(`Quantum-L9/l9-meta-injector@v${major}`);
  });
});
