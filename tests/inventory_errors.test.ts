import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { inventoryTree } from "../src/inventory";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "l9-inverr-")); }

let stderr: jest.SpyInstance;
beforeEach(() => { stderr = jest.spyOn(process.stderr, "write").mockImplementation(() => true); });
afterEach(() => { jest.restoreAllMocks(); });

describe("inventory surfaces swallowed errors (OBS-004/006/007, PRD-002)", () => {
  test("normal run exposes an empty skippedDirs array (OBS-007 API)", () => {
    const root = tmp(); fs.writeFileSync(path.join(root, "a.md"), "# a\n");
    const r = inventoryTree({ root, outDir: tmp(), dryRun: true, now: "2026-01-01T00:00:00.000Z" });
    expect(Array.isArray(r.skippedDirs)).toBe(true);
    expect(r.skippedDirs).toEqual([]);
  });

  test("an unreadable directory is recorded in skippedDirs, not silently dropped (OBS-007)", () => {
    // Point the walk root at a FILE: readdirSync throws ENOTDIR, exercising the
    // recorded-skip path deterministically (no permission games, works as root).
    const root = tmp(); const asFile = path.join(root, "not-a-dir");
    fs.writeFileSync(asFile, "x\n");
    const r = inventoryTree({ root: asFile, outDir: tmp(), dryRun: true, now: "2026-01-01T00:00:00.000Z" });
    expect(r.skippedDirs.length).toBe(1);
    expect(r.skippedDirs[0]).toContain(asFile);
    expect(r.total).toBe(0);
    expect(stderr).toHaveBeenCalled();
  });

  test("an unwritable sidecar is recorded as sidecar_write_failed (OBS-006 / PRD-002)", () => {
    const root = tmp();
    // A binary file gets a sidecar by default. Pre-create a DIRECTORY where the
    // sidecar file must go so the write throws EISDIR — no permissions needed.
    const binPath = path.join(root, "blob.bin");
    fs.writeFileSync(binPath, Buffer.from([0, 1, 2, 0, 3]));
    fs.mkdirSync(binPath + ".l9meta.yaml");
    const r = inventoryTree({ root, outDir: tmp(), dryRun: false, now: "2026-01-01T00:00:00.000Z" });
    const rec = r.records.find((x) => x.file_name === "blob.bin")!;
    expect(rec.unknowns.some((u) => u.startsWith("sidecar_write_failed:"))).toBe(true);
  });
});
