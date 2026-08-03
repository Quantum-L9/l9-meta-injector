import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

// Guards the packed CLI's child-script dispatch. `operation-cli.js` ->
// `lib/operation-dispatch.js` resolves `actionPath` and then joins `scripts/`
// onto it; if `actionPath` points at the `scripts/` directory instead of the
// package root, the child path becomes `<pkg>/scripts/scripts/<mode>.js` and the
// CLI crashes with "Cannot find module". The rest of the suite exercises the
// engine directly and never runs the CLI, so this spawns it for real.
const CLI = path.resolve(__dirname, "..", "scripts", "operation-cli.js");

const roots: string[] = [];
function tempProject(): { cwd: string; rel: string } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "l9-cli-dispatch-"));
  roots.push(cwd);
  fs.mkdirSync(path.join(cwd, "proj"));
  fs.writeFileSync(path.join(cwd, "proj", "doc.md"), "# Guide\n\nbody text\n", "utf8");
  return { cwd, rel: "proj" };
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("packed CLI dispatch", () => {
  test("inventory dispatches to the child script from the package root", () => {
    const { cwd, rel } = tempProject();
    const output = execFileSync("node", [CLI, "inventory", rel], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    // Reaches the child inventory script (proves actionPath -> package root).
    expect(output).toContain("inventory:");
    // The bug signature: a doubled scripts/ segment in the resolved child path.
    expect(output).not.toContain(`${path.sep}scripts${path.sep}scripts${path.sep}`);
  });

  test("child script path is not doubled under scripts/", () => {
    const { cwd, rel } = tempProject();
    let combined = "";
    try {
      combined = execFileSync("node", [CLI, "inventory", rel], { cwd, encoding: "utf8" });
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string };
      combined = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    expect(combined).not.toMatch(/Cannot find module.*scripts[\\/]scripts[\\/]/);
  });
});
