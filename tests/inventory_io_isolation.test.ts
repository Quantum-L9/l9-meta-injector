// inventory_io_isolation.test.ts — a filesystem failure while rewriting an archive
// is a hold on that archive's record, never an exception that aborts the walk after
// earlier entries were annotated (RC-056 / F-057).
//
// The suite runs as root, so no permission bit can make an entry unreadable or a
// directory unwritable; each failure is injected at the `node:fs` module seam, keyed
// on an entry basename. Every other filesystem call is real.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { inventoryTree } from "../src/inventory";
import { buildTarArchive } from "../src/tar_writer";
import { buildZipBuffer } from "../src/zip_writer";

const seam = vi.hoisted(() => ({
  /** Archive basename whose atomic-replace staging open fails with EACCES. */
  stagingLockedFor: "",
  /** File basename whose reads (`openSync` for reading, `readFileSync`) fail with EACCES. */
  unreadable: "",
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const failure = (syscall: string, target: string): NodeJS.ErrnoException => {
    const error = new Error(`EACCES: simulated failure, ${syscall} '${target}'`) as NodeJS.ErrnoException;
    error.code = "EACCES";
    return error;
  };
  const openSync = ((target: fs.PathLike, flags?: fs.OpenMode, ...rest: unknown[]) => {
    const base = path.basename(String(target));
    if (seam.stagingLockedFor && flags === "wx" && base.startsWith(`.${seam.stagingLockedFor}.l9stage-`)) {
      throw failure("open", String(target));
    }
    if (seam.unreadable && base === seam.unreadable && (flags === undefined || flags === "r")) {
      throw failure("open", String(target));
    }
    return (actual.openSync as (...args: unknown[]) => number)(target, flags, ...rest);
  }) as typeof fs.openSync;
  const readFileSync = ((target: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (seam.unreadable && typeof target !== "number" && path.basename(String(target)) === seam.unreadable) {
      throw failure("open", String(target));
    }
    return (actual.readFileSync as (...args: unknown[]) => unknown)(target, ...rest);
  }) as typeof fs.readFileSync;
  const patched = { openSync, readFileSync };
  return { ...actual, ...patched, default: { ...actual, ...patched } };
});

const roots: string[] = [];
function tmp(prefix = "l9-inv-io-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  seam.stagingLockedFor = "";
  seam.unreadable = "";
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("WU-074 RC-056: archive rewrite I/O failures are isolated to their record", () => {
  test("REG-WU-074-RC-056-RC056-a: a failed archive replace is held, later entries are annotated, and manifests are written", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a_first.md"), "# first\n");
    const zip = buildZipBuffer([{ name: "readme.txt", data: Buffer.from("hello\n") }]);
    fs.writeFileSync(path.join(root, "pack.zip"), zip);
    fs.writeFileSync(path.join(root, "z_later.md"), "# later\n");
    seam.stagingLockedFor = "pack.zip";
    const out = path.join(tmp(), "out");
    const result = inventoryTree({ root, outDir: out, folderSidecars: false, now: "2030-01-01T00:00:00.000Z" });
    const rec = result.records.find((r) => r.relative_path === "pack.zip")!;
    expect(rec.unknowns).toContain("archive_rewrite_held:archive.rewrite_io_failed:EACCES");
    expect(fs.readFileSync(path.join(root, "pack.zip"))).toEqual(zip);
    expect(fs.readFileSync(path.join(root, "a_first.md"), "utf8")).toContain("inspected_at:");
    expect(fs.readFileSync(path.join(root, "z_later.md"), "utf8")).toContain("inspected_at:");
    expect(fs.existsSync(path.join(out, "inventory.json"))).toBe(true);
    expect(fs.readdirSync(root).filter((name) => name.includes(".l9stage-"))).toEqual([]);
  });

  test("REG-WU-074-RC-056-RC056-c: an unreadable tar admitted by name is held and the run completes", () => {
    const root = tmp();
    const tar = buildTarArchive([{ name: "readme.txt", content: "hello\n" }]);
    fs.writeFileSync(path.join(root, "locked.tar"), tar);
    fs.writeFileSync(path.join(root, "z_later.md"), "# later\n");
    seam.unreadable = "locked.tar";
    const out = path.join(tmp(), "out");
    const result = inventoryTree({ root, outDir: out, folderSidecars: false, now: "2030-01-01T00:00:00.000Z" });
    const rec = result.records.find((r) => r.relative_path === "locked.tar")!;
    expect(rec.unknowns).toContain("archive_rewrite_held:archive.rewrite_io_failed:EACCES");
    expect(fs.readFileSync(path.join(root, "z_later.md"), "utf8")).toContain("inspected_at:");
    expect(fs.existsSync(path.join(out, "inventory.json"))).toBe(true);
  });
});
