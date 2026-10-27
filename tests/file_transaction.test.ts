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

  test("rolls every target back after a mid-commit fault (REG-WU-004-RC-006-f, REG-WU-004-RC-007-g)", () => {
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

  test("rolls back when the post-commit validation callback fails (REG-WU-004-RC-006-f)", () => {
    fs.writeFileSync(path.join(root, "a.md"), "old");
    expect(() => executeFileTransaction(root, [
      { path: "a.md", expectedExists: true, expectedHash: sha("old"), bytes: "new" },
    ], {
      transactionId: "txn-test-003",
      validate: () => { throw new Error("validation-failed"); },
    })).toThrow("validation-failed");
    expect(fs.readFileSync(path.join(root, "a.md"), "utf8")).toBe("old");
  });

  test("detects concurrent drift without overwriting the external change (REG-WU-004-RC-006-f, REG-WU-004-RC-007-g)", () => {
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

  test("recovers a journaled interrupted commit (REG-WU-004-RC-006-f)", () => {
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

// ---------------------------------------------------------------------------
// WU-004 (RC-006, RC-007): journal bookkeeping and commit/rollback compare-and-swap.
// A process crash is simulated faithfully in-process: at the named stage the whole
// repository (targets, staging files, journal) is copied as it stands on disk, the
// in-process run is then abandoned, and recovery runs against the copy, exactly as
// the next process would find it.
// ---------------------------------------------------------------------------

type Intent = Parameters<typeof executeFileTransaction>[1][number];
type FaultContext = Parameters<NonNullable<NonNullable<Parameters<typeof executeFileTransaction>[2]>["faultInjector"]>>[0];

const readText = (root: string, relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

function snapshotTree(root: string): Record<string, string> {
  const output: Record<string, string> = {};
  const walk = (directory: string) => {
    for (const name of fs.readdirSync(directory)) {
      const item = path.join(directory, name);
      if (fs.lstatSync(item).isDirectory()) walk(item);
      else output[path.relative(root, item).split(path.sep).join("/")] = fs.readFileSync(item, "utf8");
    }
  };
  walk(root);
  return output;
}

describe("WU-004 transaction bookkeeping and compare-and-swap", () => {
  let root: string;
  const crashRoots: string[] = [];
  beforeEach(() => { root = tempRoot(); });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    for (const item of crashRoots.splice(0)) fs.rmSync(item, { recursive: true, force: true });
  });

  /** Run a transaction and return a copy of the repository as a crash at `when` leaves it. */
  function crashAt(intents: Intent[], transactionId: string, when: (context: FaultContext) => boolean): string {
    const crashed = fs.mkdtempSync(path.join(os.tmpdir(), "l9-file-transaction-crash-"));
    crashRoots.push(crashed);
    let captured = false;
    try {
      executeFileTransaction(root, intents, {
        transactionId,
        faultInjector: (context) => {
          if (captured || !when(context)) return;
          fs.cpSync(root, crashed, { recursive: true });
          captured = true;
          throw new Error("simulated-process-exit");
        },
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("simulated-process-exit")) throw error;
    }
    expect(captured).toBe(true);
    return crashed;
  }

  test("REG-WU-004-RC-006-a: a no-op intent sorted first does not strand a crashed journal", () => {
    fs.writeFileSync(path.join(root, "a.md"), "same");
    fs.writeFileSync(path.join(root, "b.md"), "old-b");
    const crashed = crashAt([
      { path: "a.md", expectedExists: true, expectedHash: sha("same"), bytes: "same" },
      { path: "b.md", expectedExists: true, expectedHash: sha("old-b"), bytes: "new-b" },
    ], "crashskew01", ({ stage }) => stage === "original_backed_up");
    expect(fs.existsSync(path.join(crashed, "b.md"))).toBe(false);
    expect(recoverPendingTransactions(crashed)).toEqual({ recovered: ["crashskew01"], finalized: [] });
    expect(readText(crashed, "b.md")).toBe("old-b");
    expect(readText(crashed, "a.md")).toBe("same");
    expect(transactionArtifacts(crashed)).toEqual([]);
  });

  const interleavedStages: Array<[string, (context: FaultContext) => boolean]> = [
    ["journal_created", ({ stage }) => stage === "journal_created"],
    ["target_staged#0", ({ stage, index }) => stage === "target_staged" && index === 0],
    ["target_staged#2", ({ stage, index }) => stage === "target_staged" && index === 2],
    ["before_commit", ({ stage }) => stage === "before_commit"],
    ["original_backed_up#0", ({ stage, index }) => stage === "original_backed_up" && index === 0],
    ["original_backed_up#1", ({ stage, index }) => stage === "original_backed_up" && index === 1],
    ["target_committed#0", ({ stage, index }) => stage === "target_committed" && index === 0],
    ["target_committed#1", ({ stage, index }) => stage === "target_committed" && index === 1],
    ["target_committed#2", ({ stage, index }) => stage === "target_committed" && index === 2],
    ["before_validation", ({ stage }) => stage === "before_validation"],
    ["validation_succeeded", ({ stage }) => stage === "validation_succeeded"],
  ];
  test.each(interleavedStages)("REG-WU-004-RC-006-b: interleaved no-op intents recover after a crash at %s", (_label, when) => {
    for (const name of ["a0.md", "b1.md", "c2.md", "d3.md", "e4.md"]) fs.writeFileSync(path.join(root, name), `old-${name}`);
    const crashed = crashAt([
      { path: "a0.md", expectedExists: true, expectedHash: sha("old-a0.md"), bytes: "old-a0.md" },
      { path: "b1.md", expectedExists: true, expectedHash: sha("old-b1.md"), bytes: "new-b1" },
      { path: "c2.md", expectedExists: true, expectedHash: sha("old-c2.md"), bytes: "old-c2.md" },
      { path: "d3.md", expectedExists: true, expectedHash: sha("old-d3.md"), bytes: "new-d3" },
      { path: "e4.md", expectedExists: true, expectedHash: sha("old-e4.md"), bytes: "old-e4.md" },
      { path: "f5.md", expectedExists: false, bytes: "new-f5" },
    ], "interleave01", when);
    expect(recoverPendingTransactions(crashed).recovered).toEqual(["interleave01"]);
    for (const name of ["a0.md", "b1.md", "c2.md", "d3.md", "e4.md"]) expect(readText(crashed, name)).toBe(`old-${name}`);
    expect(fs.existsSync(path.join(crashed, "f5.md"))).toBe(false);
    expect(transactionArtifacts(crashed)).toEqual([]);
  });

  function writeJournal(entries: unknown[], id = "legacy001", state = "committing"): string {
    fs.mkdirSync(path.join(root, TRANSACTION_DIRECTORY), { recursive: true });
    const journalPath = path.join(root, TRANSACTION_DIRECTORY, `${id}.json`);
    fs.writeFileSync(journalPath, `${JSON.stringify({ schema: FILE_TRANSACTION_SCHEMA, transaction_id: id, state, entries })}\n`);
    return journalPath;
  }

  const replacedEntry = (file: string, token: string, overrides: Record<string, unknown> = {}) => ({
    path: file,
    tempPath: `.${file}.l9txn-${token}.tmp`,
    backupPath: `.${file}.l9txn-${token}.bak`,
    originalExists: true,
    originalHash: sha(`old-${file}`),
    originalMode: 0o644,
    newHash: sha(`new-${file}`),
    state: "committed",
    ...overrides,
  });

  test("REG-WU-004-RC-006-c: a stranded journal with a skewed but well-formed token is recovered", () => {
    fs.writeFileSync(path.join(root, "b.md"), "new-b.md");
    fs.writeFileSync(path.join(root, ".b.md.l9txn-legacy001-0001.bak"), "old-b.md");
    writeJournal([replacedEntry("b.md", "legacy001-0001")]);
    expect(recoverPendingTransactions(root).recovered).toEqual(["legacy001"]);
    expect(readText(root, "b.md")).toBe("old-b.md");
    expect(transactionArtifacts(root)).toEqual([]);
  });

  const tamperedJournals: Array<[string, () => unknown[]]> = [
    ["another directory", () => [replacedEntry("b.md", "legacy001-0000", { tempPath: "docs/.b.md.l9txn-legacy001-0000.tmp", backupPath: "docs/.b.md.l9txn-legacy001-0000.bak" })]],
    ["a different transaction id", () => [replacedEntry("b.md", "othertxn01-0000")]],
    ["mismatched .tmp/.bak tokens", () => [replacedEntry("b.md", "legacy001-0000", { backupPath: ".b.md.l9txn-legacy001-0001.bak" })]],
    ["a duplicate token", () => [replacedEntry("a.md", "legacy001-0000"), replacedEntry("b.md", "legacy001-0000")]],
    ["a foreign basename", () => [replacedEntry("b.md", "legacy001-0000", { tempPath: ".a.md.l9txn-legacy001-0000.tmp", backupPath: ".a.md.l9txn-legacy001-0000.bak" })]],
    ["a non-numeric token", () => [replacedEntry("b.md", "legacy001-00x0")]],
  ];
  test.each(tamperedJournals)("REG-WU-004-RC-006-d: a journal naming %s is refused without touching files", (_label, entries) => {
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "a.md"), "new-a.md");
    fs.writeFileSync(path.join(root, "b.md"), "new-b.md");
    fs.writeFileSync(path.join(root, ".b.md.l9txn-legacy001-0000.bak"), "old-b.md");
    fs.writeFileSync(path.join(root, "docs", ".b.md.l9txn-legacy001-0000.bak"), "old-b.md");
    writeJournal(entries());
    const before = snapshotTree(root);
    expect(() => recoverPendingTransactions(root)).toThrow("staging path mismatch");
    expect(snapshotTree(root)).toEqual(before);
  });

  const cleanupFaults: Array<[string, (context: FaultContext) => boolean]> = [
    ["backup 0", ({ stage, index }) => stage === "backup_cleanup" && index === 0],
    ["backup 1", ({ stage, index }) => stage === "backup_cleanup" && index === 1],
    ["backup 2", ({ stage, index }) => stage === "backup_cleanup" && index === 2],
    ["the journal", ({ stage }) => stage === "journal_cleanup"],
  ];
  test.each(cleanupFaults)("REG-WU-004-RC-006-e: a cleanup failure on %s after complete never rolls back", (_label, when) => {
    for (const name of ["a.md", "b.md", "c.md"]) fs.writeFileSync(path.join(root, name), `old-${name}`);
    let thrown = false;
    const result = executeFileTransaction(root, ["a.md", "b.md", "c.md"].map((name) => (
      { path: name, expectedExists: true, expectedHash: sha(`old-${name}`), bytes: `new-${name}` }
    )), {
      transactionId: "cleanup01",
      faultInjector: (context) => {
        if (!thrown && when(context)) { thrown = true; throw new Error("EBUSY: simulated unlink failure"); }
      },
    });
    expect(thrown).toBe(true);
    expect(result.rolledBack).toBe(false);
    expect(result.changedPaths).toEqual(["a.md", "b.md", "c.md"]);
    expect(result.cleanupPending?.journalPath).toBe(`${TRANSACTION_DIRECTORY}/cleanup01.json`);
    expect(result.cleanupPending?.errors.join("\n")).toContain("EBUSY");
    for (const name of ["a.md", "b.md", "c.md"]) expect(readText(root, name)).toBe(`new-${name}`);
    const journal = JSON.parse(readText(root, `${TRANSACTION_DIRECTORY}/cleanup01.json`)) as { state: string };
    expect(journal.state).toBe("complete");
    expect(recoverPendingTransactions(root)).toEqual({ recovered: [], finalized: ["cleanup01"] });
    for (const name of ["a.md", "b.md", "c.md"]) expect(readText(root, name)).toBe(`new-${name}`);
    expect(transactionArtifacts(root)).toEqual([]);
  });

  test("REG-WU-004-RC-006-e: a clean run reports no pending cleanup", () => {
    fs.writeFileSync(path.join(root, "a.md"), "old");
    const result = executeFileTransaction(root, [{ path: "a.md", expectedExists: true, expectedHash: sha("old"), bytes: "new" }], { transactionId: "cleanup02" });
    expect(result.cleanupPending).toBeUndefined();
    expect(transactionArtifacts(root)).toEqual([]);
  });

  test("REG-WU-004-RC-007-a: a concurrent edit to a later target during commit aborts and survives", () => {
    fs.writeFileSync(path.join(root, "a.md"), "old-a");
    fs.writeFileSync(path.join(root, "b.md"), "old-b");
    expect(() => executeFileTransaction(root, [
      { path: "a.md", expectedExists: true, expectedHash: sha("old-a"), bytes: "new-a" },
      { path: "b.md", expectedExists: true, expectedHash: sha("old-b"), bytes: "new-b" },
    ], {
      transactionId: "casedit01",
      faultInjector: ({ stage, index }) => {
        if (stage === "target_committed" && index === 0) fs.writeFileSync(path.join(root, "b.md"), "CONCURRENT-USER-EDIT");
      },
    })).toThrow("TRANSACTION_CONCURRENT_DRIFT");
    expect(readText(root, "a.md")).toBe("old-a");
    expect(readText(root, "b.md")).toBe("CONCURRENT-USER-EDIT");
    expect(transactionArtifacts(root)).toEqual([]);
  });

  test("REG-WU-004-RC-007-b: a target created concurrently where the plan saw none is not replaced", () => {
    fs.writeFileSync(path.join(root, "a.md"), "old-a");
    expect(() => executeFileTransaction(root, [
      { path: "a.md", expectedExists: true, expectedHash: sha("old-a"), bytes: "new-a" },
      { path: "c.md", expectedExists: false, bytes: "planned-c" },
    ], {
      transactionId: "cascreate01",
      faultInjector: ({ stage, path: target }) => {
        if (stage === "target_committed" && target === "a.md") fs.writeFileSync(path.join(root, "c.md"), "external");
      },
    })).toThrow("TRANSACTION_CONCURRENT_DRIFT");
    expect(readText(root, "c.md")).toBe("external");
    expect(readText(root, "a.md")).toBe("old-a");
    expect(transactionArtifacts(root)).toEqual([]);
  });

  test("REG-WU-004-RC-007-c: recovery refuses to clobber a target edited after a crash", () => {
    fs.writeFileSync(path.join(root, "a.md"), "old-a");
    fs.writeFileSync(path.join(root, "b.md"), "old-b");
    const crashed = crashAt([
      { path: "a.md", expectedExists: true, expectedHash: sha("old-a"), bytes: "new-a" },
      { path: "b.md", expectedExists: true, expectedHash: sha("old-b"), bytes: "new-b" },
    ], "postcrash01", ({ stage, index }) => stage === "target_committed" && index === 0);
    fs.writeFileSync(path.join(crashed, "a.md"), "USER-EDIT-AFTER-CRASH");
    expect(() => recoverPendingTransactions(crashed)).toThrow(/TRANSACTION_ROLLBACK_FAILED: .*a\.md: TRANSACTION_CONCURRENT_DRIFT/);
    expect(readText(crashed, "a.md")).toBe("USER-EDIT-AFTER-CRASH");
    expect(readText(crashed, ".a.md.l9txn-postcrash01-0000.bak")).toBe("old-a");
    expect(readText(crashed, "b.md")).toBe("old-b");
    const journal = JSON.parse(readText(crashed, `${TRANSACTION_DIRECTORY}/postcrash01.json`)) as { state: string };
    expect(journal.state).toBe("rollback_failed");
  });

  test("REG-WU-004-RC-007-d: recovery after the same crash with an untouched target restores the original", () => {
    fs.writeFileSync(path.join(root, "a.md"), "old-a");
    fs.writeFileSync(path.join(root, "b.md"), "old-b");
    const crashed = crashAt([
      { path: "a.md", expectedExists: true, expectedHash: sha("old-a"), bytes: "new-a" },
      { path: "b.md", expectedExists: true, expectedHash: sha("old-b"), bytes: "new-b" },
    ], "postcrash02", ({ stage, index }) => stage === "target_committed" && index === 0);
    expect(recoverPendingTransactions(crashed).recovered).toEqual(["postcrash02"]);
    expect(readText(crashed, "a.md")).toBe("old-a");
    expect(readText(crashed, "b.md")).toBe("old-b");
    expect(transactionArtifacts(crashed)).toEqual([]);
  });

  test("REG-WU-004-RC-007-e: recovery does not delete a created file edited after a crash", () => {
    fs.writeFileSync(path.join(root, "a.md"), "old-a");
    const crashed = crashAt([
      { path: "a.md", expectedExists: true, expectedHash: sha("old-a"), bytes: "new-a" },
      { path: "c.md", expectedExists: false, bytes: "created-c" },
    ], "postcrash03", ({ stage, path: target }) => stage === "target_committed" && target === "c.md");
    fs.writeFileSync(path.join(crashed, "c.md"), "USER-EDIT-OF-CREATED-FILE");
    expect(() => recoverPendingTransactions(crashed)).toThrow(/c\.md: TRANSACTION_CONCURRENT_DRIFT/);
    expect(readText(crashed, "c.md")).toBe("USER-EDIT-OF-CREATED-FILE");
  });

  test("REG-WU-004-RC-007-f: rollback after a failed validation refuses to overwrite a target edited during validation", () => {
    fs.writeFileSync(path.join(root, "a.md"), "old-a");
    let failure: unknown;
    try {
      executeFileTransaction(root, [{ path: "a.md", expectedExists: true, expectedHash: sha("old-a"), bytes: "new-a" }], {
        transactionId: "valedit01",
        validate: () => {
          fs.writeFileSync(path.join(root, "a.md"), "EDITED-DURING-VALIDATION");
          throw new Error("validation-failed");
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(String(failure)).toContain("validation-failed");
    expect(String(failure)).toMatch(/TRANSACTION_ROLLBACK_FAILED: a\.md: TRANSACTION_CONCURRENT_DRIFT/);
    expect(readText(root, "a.md")).toBe("EDITED-DURING-VALIDATION");
    expect(readText(root, ".a.md.l9txn-valedit01-0000.bak")).toBe("old-a");
  });

  test("AC-WU-004-RC-007-01: a backup tampered before cleanup is retained and reported, not deleted", () => {
    fs.writeFileSync(path.join(root, "a.md"), "old-a");
    const result = executeFileTransaction(root, [{ path: "a.md", expectedExists: true, expectedHash: sha("old-a"), bytes: "new-a" }], {
      transactionId: "baktamper01",
      faultInjector: ({ stage }) => {
        if (stage === "validation_succeeded") fs.writeFileSync(path.join(root, ".a.md.l9txn-baktamper01-0000.bak"), "NOT-THE-ORIGINAL");
      },
    });
    expect(readText(root, "a.md")).toBe("new-a");
    expect(result.cleanupPending?.retainedBackups).toEqual([".a.md.l9txn-baktamper01-0000.bak"]);
    expect(readText(root, ".a.md.l9txn-baktamper01-0000.bak")).toBe("NOT-THE-ORIGINAL");
    expect(() => recoverPendingTransactions(root)).toThrow(/TRANSACTION_FINALIZATION_FAILED: .*baktamper01-0000\.bak/);
    expect(readText(root, ".a.md.l9txn-baktamper01-0000.bak")).toBe("NOT-THE-ORIGINAL");
  });
});
