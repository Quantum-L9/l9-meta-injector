import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

describe("v4 release identity", () => {
  it("keeps package, lock, executable, and release plan aligned", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
    const plan = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/release/v4.0.0-release-plan.json"), "utf8"));
    expect(pkg.version).toBe("4.0.0");
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].version).toBe(pkg.version);
    expect(lock.packages[""].license).toBe(pkg.license);
    expect(pkg.bin["l9-meta-injector"]).toBe("scripts/operation-cli.js");
    expect(pkg.files).toContain("scripts");
    expect(plan.tag).toBe(`v${pkg.version}`);
  });
});
