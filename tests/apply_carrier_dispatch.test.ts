import * as fs from "node:fs";
import * as path from "node:path";

describe("apply dispatch source contract", () => {
  test("routes apply through the governed apply CLI, not the legacy pipeline CLI", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "lib", "operation-dispatch.js"), "utf8");
    expect(source).toContain('script = path.join(scripts, "apply-cli.js")');
    expect(source).not.toMatch(/mode === "apply"[\s\S]{0,600}pipeline-cli\.js/);
  });

  test("governed apply uses one whole-run transaction and forbids legacy writes", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "apply.ts"), "utf8");
    expect(source).toContain("executeFileTransaction");
    expect(source).toContain("recoverPendingTransactions");
    expect(source).toContain("METADATA_INDEX_RELATIVE_PATH");
    expect(source).not.toContain("writeMetadataIndex(");
    expect(source).not.toMatch(/injectFile\(planned\.sourcePath/);
  });
});
