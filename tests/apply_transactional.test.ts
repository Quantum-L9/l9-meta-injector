import * as fs from "node:fs";
import * as path from "node:path";

describe("governed apply transaction contract", () => {
  test("does not write repository targets through legacy mutators", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "apply.ts"), "utf8");
    expect(source).toContain("executeFileTransaction");
    expect(source).toContain("recoverPendingTransactions");
    expect(source.indexOf("recoverPendingTransactions(root)")).toBeLessThan(source.indexOf("inspectRepositoryAuthority(root"));
    expect(source).not.toContain("writeMetadataIndex(");
    expect(source).not.toMatch(/injectFile\(planned\.sourcePath/);
  });

  test("keeps backups until post-commit validation succeeds", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "file_transaction.ts"), "utf8");
    expect(source).toContain("options.validate?.()");
    expect(source.indexOf("options.validate?.()")).toBeLessThan(source.indexOf("removeIfExists(entry.backup)"));
    expect(source).toContain("rollbackEntries");
    expect(source).toContain("TRANSACTION_CONCURRENT_DRIFT");
  });

  test("records the transaction summary in ApplyResult", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "operation_contracts.ts"), "utf8");
    expect(source).toContain("export interface ApplyTransactionSummary");
    expect(source).toContain("transaction: ApplyTransactionSummary");
  });
});
