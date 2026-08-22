// OBS-005 / OBS-008: a read error must be surfaced, not silently reclassified as
// "binary". fs primitives are non-configurable (spyOn fails), so mock the
// module: openSync throws, everything else is the real implementation.
import { vi, test, expect, beforeEach, afterEach, type MockInstance, type Mock } from "vitest";

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, openSync: vi.fn(actual.openSync) };
});

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { inventoryTree } from "../src/inventory";
import { findFiles } from "../src/retrieval";

const actual = await vi.importActual<typeof import("fs")>("fs");
function tmp() { return actual.mkdtempSync(path.join(os.tmpdir(), "l9-rderr-")); }

let stderr: MockInstance;
beforeEach(() => { stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true); });
afterEach(() => { (fs.openSync as unknown as Mock).mockImplementation(actual.openSync); vi.restoreAllMocks(); });

test("inventory records read_failed, distinct from a binary skip (OBS-005)", () => {
  const root = tmp(); actual.writeFileSync(path.join(root, "note.md"), "# note\nbody text\n");
  (fs.openSync as unknown as Mock).mockImplementation(() => { throw new Error("EACCES: cannot open"); });
  const r = inventoryTree({ root, outDir: tmp(), dryRun: false, now: "2026-01-01T00:00:00.000Z" });
  const rec = r.records.find((x) => x.file_name === "note.md")!;
  expect(rec.unknowns.some((u) => u.startsWith("read_failed:"))).toBe(true);
});

test("retrieval keeps a readable known-text file eligible (OBS-008)", () => {
  const root = tmp();
  actual.writeFileSync(path.join(root, "data.xyz"), "plain text content\n");
  actual.writeFileSync(path.join(root, "keep.md"), "# keep\n");
  // No read failure: both files are readable UTF-8, so both stay eligible. This is
  // the half of OBS-008 that must never regress — a byte probe on a known-text
  // extension must not start excluding perfectly readable files.
  const files = findFiles(root, "**/*");
  expect(files.some((f) => f.endsWith("data.xyz"))).toBe(true);
  expect(files.some((f) => f.endsWith("keep.md"))).toBe(true);
});

test("retrieval excludes an unreadable file and reports it, whatever its extension (OBS-008)", () => {
  const root = tmp();
  actual.writeFileSync(path.join(root, "data.xyz"), "plain text content\n");
  actual.writeFileSync(path.join(root, "keep.md"), "# keep\n");
  (fs.openSync as unknown as Mock).mockImplementation(() => { throw new Error("EACCES: unreadable"); });

  const files = findFiles(root, "**/*");

  // A known-text extension no longer exempts a file from being read before it is
  // declared eligible: eligibility means the pipeline may decode and rewrite the
  // file, and a file that cannot be opened cannot be either. Both are excluded,
  // and the access error is surfaced rather than reported as "binary" (OBS-005).
  expect(files.some((f) => f.endsWith("data.xyz"))).toBe(false);
  expect(files.some((f) => f.endsWith("keep.md"))).toBe(false);
  expect(stderr).toHaveBeenCalled();
  const reported = stderr.mock.calls.map((call) => String(call[0])).join("");
  expect(reported).toContain("excluded unreadable file");
  expect(reported).toContain("keep.md");
});
