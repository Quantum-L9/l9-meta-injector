// OBS-005 / OBS-008: a read error must be surfaced, not silently reclassified as
// "binary". fs primitives are non-configurable (jest.spyOn fails), so mock the
// module: openSync throws, everything else is the real implementation.
jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return { ...actual, openSync: jest.fn(actual.openSync) };
});

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { inventoryTree } from "../src/inventory";
import { findFiles } from "../src/retrieval";

const actual = jest.requireActual("fs") as typeof fs;
function tmp() { return actual.mkdtempSync(path.join(os.tmpdir(), "l9-rderr-")); }

let stderr: jest.SpyInstance;
beforeEach(() => { stderr = jest.spyOn(process.stderr, "write").mockImplementation(() => true); });
afterEach(() => { (fs.openSync as jest.Mock).mockImplementation(actual.openSync); jest.restoreAllMocks(); });

test("inventory records read_failed, distinct from a binary skip (OBS-005)", () => {
  const root = tmp(); actual.writeFileSync(path.join(root, "note.md"), "# note\nbody text\n");
  (fs.openSync as jest.Mock).mockImplementation(() => { throw new Error("EACCES: cannot open"); });
  const r = inventoryTree({ root, outDir: tmp(), dryRun: false, now: "2026-01-01T00:00:00.000Z" });
  const rec = r.records.find((x) => x.file_name === "note.md")!;
  expect(rec.unknowns.some((u) => u.startsWith("read_failed:"))).toBe(true);
});

test("retrieval excludes an unreadable unknown-extension file and reports it (OBS-008)", () => {
  const root = tmp();
  actual.writeFileSync(path.join(root, "data.xyz"), "plain text content\n");
  actual.writeFileSync(path.join(root, "keep.md"), "# keep\n");
  // openSync is only reached for unknown-extension files (the binary sniff).
  (fs.openSync as jest.Mock).mockImplementation(() => { throw new Error("EACCES: unreadable"); });
  const files = findFiles(root, "**/*");
  expect(files.some((f) => f.endsWith("data.xyz"))).toBe(false); // excluded
  expect(files.some((f) => f.endsWith("keep.md"))).toBe(true);   // known text, unaffected
  expect(stderr).toHaveBeenCalled();
});
