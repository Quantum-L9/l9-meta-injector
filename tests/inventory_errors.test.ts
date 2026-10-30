import { vi, describe, test, expect, beforeEach, afterEach, type MockInstance } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { inventoryTree } from "../src/inventory";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "l9-inverr-")); }

let stderr: MockInstance;
beforeEach(() => { stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true); });
afterEach(() => { vi.restoreAllMocks(); });

describe("inventory surfaces swallowed errors (OBS-004/006/007, PRD-002)", () => {
  test("normal run exposes an empty skippedDirs array (OBS-007 API)", () => {
    const root = tmp(); fs.writeFileSync(path.join(root, "a.md"), "# a\n");
    const r = inventoryTree({ root, outDir: tmp(), dryRun: true, now: "2026-01-01T00:00:00.000Z" });
    expect(Array.isArray(r.skippedDirs)).toBe(true);
    expect(r.skippedDirs).toEqual([]);
  });

  test("REG-WU-028-RC-032-B04-e: an unreadable directory is recorded in skippedDirs, not silently dropped (OBS-007)", () => {
    // Point the walk root at a FILE: readdirSync throws ENOTDIR, exercising the
    // recorded-skip path deterministically (no permission games, works as root).
    const root = tmp(); const asFile = path.join(root, "not-a-dir");
    fs.writeFileSync(asFile, "x\n");
    const r = inventoryTree({ root: asFile, outDir: tmp(), dryRun: true, now: "2026-01-01T00:00:00.000Z" });
    expect(r.skippedDirs).toHaveLength(1);
    // The entry is the root-relative directory plus the errno code: the absolute
    // checkout path would make every packet built from this inventory depend on
    // where the tree lives (RC-032). The operator still gets the full message on stderr.
    expect(r.skippedDirs).toEqual([".: ENOTDIR"]);
    expect(r.skippedDirs[0]).not.toContain(asFile);
    expect(stderr.mock.calls.map((call) => String(call[0])).join("")).toContain(asFile);
    expect(r.total).toBe(0);
    expect(stderr).toHaveBeenCalled();
  });

  test("REG-WU-074-RC-051-RC051-f / REG-WU-074-RC-056-RC056-d: an unwritable sidecar is recorded as sidecar_write_failed (OBS-006 / PRD-002)", () => {
    const root = tmp();
    // JSON uses sidecar strategy. Pre-create a DIRECTORY where the sidecar file
    // must go so the write throws EISDIR — no permissions needed.
    const jsonPath = path.join(root, "data.json");
    fs.writeFileSync(jsonPath, "{\"a\":1}\n");
    fs.mkdirSync(jsonPath + ".l9meta.yaml");
    const r = inventoryTree({ root, outDir: tmp(), dryRun: false, now: "2026-01-01T00:00:00.000Z" });
    const rec = r.records.find((x) => x.file_name === "data.json")!;
    expect(rec.unknowns.some((u) => u.startsWith("sidecar_write_failed:"))).toBe(true);
  });

  test("REG-WU-074-RC-056-RC056-b: a directory where a folder sidecar belongs is recorded and the run completes", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "sub"));
    fs.writeFileSync(path.join(root, "sub", "note.md"), "# note\n");
    fs.mkdirSync(path.join(root, "sub", ".l9meta.yaml"));
    fs.writeFileSync(path.join(root, "z_later.md"), "# later\n");
    const out = tmp();
    const r = inventoryTree({ root, outDir: out, dryRun: false, now: "2026-01-01T00:00:00.000Z" });
    const folder = r.records.find((x) => x.relative_path === "sub")!;
    expect(folder.unknowns.some((u) => u.startsWith("sidecar_write_failed:"))).toBe(true);
    expect(fs.statSync(path.join(root, "sub", ".l9meta.yaml")).isDirectory()).toBe(true);
    // Later entries are still annotated and the manifests are written.
    expect(fs.readFileSync(path.join(root, "z_later.md"), "utf8")).toContain("inspected_at:");
    expect(fs.existsSync(path.join(out, "inventory.json"))).toBe(true);
  });
});
