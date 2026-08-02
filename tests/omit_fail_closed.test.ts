import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { buildOmitMatcher } from "../src/omit";

const roots: string[] = [];
function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-omit-strict-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("fail-closed omit sources", () => {
  test("loads a valid repository .l9metaignore", () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, ".l9metaignore"), "generated/\n*.tmp\n", "utf8");
    const matcher = buildOmitMatcher({ root });
    expect(matcher.shouldOmit("generated/a.txt")).toBe(true);
    expect(matcher.shouldOmit("x.tmp")).toBe(true);
    expect(matcher.sources).toContain(".l9metaignore");
  });

  test("rejects a symlinked .l9metaignore", () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, "rules.txt"), "secret/\n", "utf8");
    fs.symlinkSync("rules.txt", path.join(root, ".l9metaignore"));
    expect(() => buildOmitMatcher({ root })).toThrow(/must not be a symbolic link/);
  });

  test("rejects missing and non-file explicit omit paths", () => {
    const root = tempRoot();
    expect(() => buildOmitMatcher({ root, omitFile: "missing.ignore" })).toThrow(/cannot be inspected/);
    fs.mkdirSync(path.join(root, "rules"));
    expect(() => buildOmitMatcher({ root, omitFile: "rules" })).toThrow(/must be a regular file/);
  });

  test("rejects binary or invalid UTF-8 omit files", () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, "bad.ignore"), Buffer.from([0xff, 0xfe, 0x00]));
    expect(() => buildOmitMatcher({ root, omitFile: "bad.ignore" })).toThrow(/valid UTF-8|NUL/);
  });
});
