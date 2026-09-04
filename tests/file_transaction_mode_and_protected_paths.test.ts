import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TRANSACTION_DIRECTORY, executeFileTransaction } from "../src/file_transaction";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const modeOf = (file: string) => fs.statSync(file).mode & 0o777;

function withUmask<T>(mask: number, run: () => T): T {
  const previous = process.umask(mask);
  try {
    return run();
  } finally {
    process.umask(previous);
  }
}

describe("transaction file modes survive the process umask", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-txn-mode-")); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test("an existing target keeps its exact mode under a restrictive umask", () => {
    fs.writeFileSync(path.join(root, "x.md"), "old\n");
    fs.chmodSync(path.join(root, "x.md"), 0o775);
    const result = withUmask(0o077, () =>
      executeFileTransaction(root, [{ path: "x.md", expectedExists: true, expectedHash: sha("old\n"), bytes: "new\n" }]),
    );
    expect(result.committedWrites).toBe(1);
    expect(fs.readFileSync(path.join(root, "x.md"), "utf8")).toBe("new\n");
    expect(modeOf(path.join(root, "x.md"))).toBe(0o775);
  });

  test("a new target receives the intent's mode, or the 0o644 default, under a restrictive umask", () => {
    withUmask(0o077, () =>
      executeFileTransaction(root, [
        { path: "explicit.md", expectedExists: false, bytes: "n\n", mode: 0o664 },
        { path: "nested/default.md", expectedExists: false, bytes: "n\n" },
      ]),
    );
    expect(modeOf(path.join(root, "explicit.md"))).toBe(0o664);
    expect(modeOf(path.join(root, "nested", "default.md"))).toBe(0o644);
  });

  test("replacing a target hard-linked from outside the root leaves the outside bytes alone", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "l9-txn-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "shared.md"), "shared\n");
      fs.linkSync(path.join(outside, "shared.md"), path.join(root, "linked.md"));
      executeFileTransaction(root, [{ path: "linked.md", expectedExists: true, expectedHash: sha("shared\n"), bytes: "changed\n" }]);
      expect(fs.readFileSync(path.join(root, "linked.md"), "utf8")).toBe("changed\n");
      expect(fs.readFileSync(path.join(outside, "shared.md"), "utf8")).toBe("shared\n");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("transaction targets exclude protected repository state", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-txn-protected-")); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test.each([
    [".git/config", /Git internal state/],
    ["sub/.git/HEAD", /Git internal state/],
    [".l9/meta-authority.yaml", /protected repository state/],
    [`${TRANSACTION_DIRECTORY}/forged.json`, /protected repository state/],
    [TRANSACTION_DIRECTORY, /protected repository state/],
  ])("refuses %s", (target, expected) => {
    fs.mkdirSync(path.join(root, ".l9"));
    expect(() => executeFileTransaction(root, [{ path: target, expectedExists: false, bytes: "x" }])).toThrow(expected);
    expect(fs.existsSync(path.join(root, target))).toBe(false);
  });

  test("still accepts the canonical metadata index beside the authority", () => {
    const result = executeFileTransaction(root, [{ path: ".l9/metadata-index.jsonl", expectedExists: false, bytes: "{}\n" }]);
    expect(result.committedWrites).toBe(1);
    expect(fs.readFileSync(path.join(root, ".l9", "metadata-index.jsonl"), "utf8")).toBe("{}\n");
  });
});
