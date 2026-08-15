import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  executeFileTransaction,
  recoverPendingTransactions,
  FILE_TRANSACTION_SCHEMA,
  TRANSACTION_DIRECTORY,
} from "../src/file_transaction";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "l9-file-transaction-"));

function transactionArtifacts(root: string): string[] {
  const output: string[] = [];
  const walk = (directory: string) => {
    if (!fs.existsSync(directory)) return;
    for (const name of fs.readdirSync(directory)) {
      const item = path.join(directory, name);
      const stat = fs.lstatSync(item);
      if (stat.isDirectory()) walk(item);
      else if (name.includes(".l9txn-") || item.includes(`${path.sep}.transactions${path.sep}`)) output.push(item);
    }
  };
  walk(root);
  return output;
}

describe("whole-run file transaction", () => {
  let root: string;
  beforeEach(() => { root = tempRoot(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test("commits all targets and preserves an existing file mode", () => {
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs/a.md"), "old-a\n");
    fs.chmodSync(path.join(root, "docs/a.md"), 0o640);
    const result = executeFileTransaction(root, [
      { path: "docs/a.md", expectedExists: true, expectedHash: sha("old-a\n"), bytes: "new-a\n" },
      { path: ".l9/metadata-index.jsonl", expectedExists: false, bytes: "{\"a\":1}\n" },
    ], { transactionId: "txn-test-001" });
    expect(result.changedPaths).toEqual([".l9/metadata-index.jsonl", "docs/a.md"]);
    expect(fs.readFileSync(path.join(root, "docs/a.md"), "utf8")).toBe("new-a\n");
    expect(fs.statSync(path.join(root, "docs/a.md")).mode & 0o777).toBe(0o640);
    expect(transactionArtifacts(root)).toEqual([]);
  });

  test("rolls every target back after a mid-commit fault", () => {
    fs.writeFileSync(path.join(root, "a.md"), "old-a");
    fs.writeFileSync(path.join(root, "b.md"), "old-b");
    expect(() => executeFileTransaction(root, [
      { path: "a.md", expectedExists: true, expectedHash: sha("old-a"), bytes: "new-a" },
      { path: "b.md", expectedExists: true, expectedHash: sha("old-b"), bytes: "new-b" },
    ], {
      transactionId: "txn-test-002",
      faultInjector: ({ stage, index }) => {
        if (stage === "target_committed" && index === 0) throw new Error("fault-after-first-commit");
      },
    })).toThrow("fault-after-first-commit");
    expect(fs.readFileSync(path.join(root, "a.md"), "utf8")).toBe("old-a");
    expect(fs.readFileSync(path.join(root, "b.md"), "utf8")).toBe("old-b");
    expect(transactionArtifacts(root)).toEqual([]);
  });

  test("rolls back when the post-commit validation callback fails", () => {
    fs.writeFileSync(path.join(root, "a.md"), "old");
    expect(() => executeFileTransaction(root, [
      { path: "a.md", expectedExists: true, expectedHash: sha("old"), bytes: "new" },
    ], {
      transactionId: "txn-test-003",
      validate: () => { throw new Error("validation-failed"); },
    })).toThrow("validation-failed");
    expect(fs.readFileSync(path.join(root, "a.md"), "utf8")).toBe("old");
  });

  test("detects concurrent drift without overwriting the external change", () => {
    fs.writeFileSync(path.join(root, "a.md"), "old");
    expect(() => executeFileTransaction(root, [
      { path: "a.md", expectedExists: true, expectedHash: sha("old"), bytes: "new" },
    ], {
      transactionId: "txn-test-004",
      faultInjector: ({ stage }) => {
        if (stage === "before_commit") fs.writeFileSync(path.join(root, "a.md"), "external");
      },
    })).toThrow("TRANSACTION_CONCURRENT_DRIFT");
    expect(fs.readFileSync(path.join(root, "a.md"), "utf8")).toBe("external");
  });

  test("recovers a journaled interrupted commit", () => {
    fs.mkdirSync(path.join(root, TRANSACTION_DIRECTORY), { recursive: true });
    fs.writeFileSync(path.join(root, "a.md"), "new");
    const backupPath = ".a.md.l9txn-crash001-0000.bak";
    fs.writeFileSync(path.join(root, backupPath), "old");
    const journal = {
      schema: FILE_TRANSACTION_SCHEMA,
      transaction_id: "crash001",
      state: "committing",
      entries: [{
        path: "a.md",
        tempPath: ".a.md.l9txn-crash001-0000.tmp",
        backupPath,
        originalExists: true,
        originalHash: sha("old"),
        originalMode: 0o644,
        newHash: sha("new"),
        state: "committed",
      }],
    };
    fs.writeFileSync(path.join(root, TRANSACTION_DIRECTORY, "crash001.json"), `${JSON.stringify(journal)}\n`);
    expect(recoverPendingTransactions(root).recovered).toEqual(["crash001"]);
    expect(fs.readFileSync(path.join(root, "a.md"), "utf8")).toBe("old");
    expect(transactionArtifacts(root)).toEqual([]);
  });
});
