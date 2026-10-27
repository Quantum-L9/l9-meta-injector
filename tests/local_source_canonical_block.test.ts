// local_source_canonical_block.test.ts — a local source whose bytes were not all
// read cannot become a canonical Repository Model Packet (RC-046).
//
// The suite runs as root, so no permission bit can make an entry unreadable; each
// failure is injected at the `node:fs` module seam, keyed on the entry's name.
// Every other filesystem call is real.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { acquireLocalSource } from "../src/local_source";
import { canonicalBlockReason, observeLocalSourceModel, withLocalSourceModel } from "../src/local_source_model";
import { writeRawZip } from "./helpers/zip_fixtures";

const seam = vi.hoisted(() => ({
  /** Directory basename whose `readdirSync` fails with EACCES. */
  lockedDir: "",
  /** File basename whose `openSync` fails with EACCES. */
  lockedFile: "",
  /** Entry basename whose `lstatSync` fails with EACCES. */
  uninspectable: "",
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const denied = (syscall: string, target: string): NodeJS.ErrnoException => {
    const error = new Error(`EACCES: permission denied, ${syscall} '${target}'`) as NodeJS.ErrnoException;
    error.code = "EACCES";
    return error;
  };
  const named = (target: unknown, name: string): boolean =>
    name.length > 0 && typeof target !== "number" && path.basename(String(target)) === name;
  const readdirSync = ((target: fs.PathLike, ...rest: unknown[]) => {
    if (named(target, seam.lockedDir)) throw denied("scandir", String(target));
    return (actual.readdirSync as (...args: unknown[]) => unknown)(target, ...rest);
  }) as typeof fs.readdirSync;
  const openSync = ((target: fs.PathLike, ...rest: unknown[]) => {
    if (named(target, seam.lockedFile)) throw denied("open", String(target));
    return (actual.openSync as (...args: unknown[]) => unknown)(target, ...rest);
  }) as typeof fs.openSync;
  const lstatSync = ((target: fs.PathLike, ...rest: unknown[]) => {
    if (named(target, seam.uninspectable)) throw denied("lstat", String(target));
    return (actual.lstatSync as (...args: unknown[]) => unknown)(target, ...rest);
  }) as typeof fs.lstatSync;
  const patched = { readdirSync, openSync, lstatSync };
  return { ...actual, ...patched, default: { ...actual, ...patched } };
});

const PRODUCER_VERSION = "4.0.0";
const roots: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-canonical-block-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  seam.lockedDir = "";
  seam.lockedFile = "";
  seam.uninspectable = "";
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeTree(root: string): void {
  fs.writeFileSync(path.join(root, "README.md"), "# Fixture\n");
  fs.mkdirSync(path.join(root, "locked"));
  fs.writeFileSync(path.join(root, "locked", "inner.md"), "# inner\n");
  fs.writeFileSync(path.join(root, "secret-ish.md"), "# secret-ish\n");
}

function blockFor(root: string): string | null {
  const observation = acquireLocalSource({ path: root, scratchParent: tmp() });
  try {
    return canonicalBlockReason(observation);
  } finally {
    observation.dispose();
  }
}

describe("unreadable content blocks the canonical local-source packet (RC-046)", () => {
  test("REG-WU-035-RC-046-a: a file whose bytes cannot be read blocks the packet", () => {
    const root = tmp();
    writeTree(root);
    seam.lockedFile = "secret-ish.md";
    const reason = blockFor(root);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/content of 1 file\(s\) could not be read/);
    expect(() => observeLocalSourceModel({ path: root, producerVersion: PRODUCER_VERSION, interpret: false }))
      .toThrow(/could not be read/);
  });

  test("REG-WU-035-RC-046-b: a directory that cannot be listed blocks the packet", () => {
    const root = tmp();
    writeTree(root);
    seam.lockedDir = "locked";
    const reason = blockFor(root);
    expect(reason).toMatch(/1 director\(ies\) could not be listed/);
    expect(() => observeLocalSourceModel({ path: root, producerVersion: PRODUCER_VERSION, interpret: false }))
      .toThrow(/could not be listed/);
  });

  test("REG-WU-035-RC-046-c: an entry that cannot be inspected blocks the packet", () => {
    const root = tmp();
    writeTree(root);
    seam.uninspectable = "secret-ish.md";
    const reason = blockFor(root);
    expect(reason).toMatch(/1 filesystem entr\(ies\) could not be inspected/);
    expect(() => observeLocalSourceModel({ path: root, producerVersion: PRODUCER_VERSION, interpret: false }))
      .toThrow(/could not be inspected/);
  });

  test("REG-WU-035-RC-046-d: an unreadable single-file source is refused, never given a manifest-digest revision", () => {
    const root = tmp();
    const file = path.join(root, "only.md");
    fs.writeFileSync(file, "# only\n");
    seam.lockedFile = "only.md";
    let revision: string | null = null;
    let thrown: unknown = null;
    try {
      const observation = acquireLocalSource({ path: file, scratchParent: tmp() });
      revision = observation.sourceRevision;
      observation.dispose();
    } catch (error) {
      thrown = error;
    }
    expect(revision).toBeNull();
    expect(String(thrown)).toMatch(/source bytes could not be read/);
  });

  test("REG-WU-035-RC-046-d: an unreadable single-archive source is refused as well", () => {
    const root = tmp();
    const zip = path.join(root, "Bundle.zip");
    writeRawZip(zip, [{ name: "a.md", content: "# A\n" }]);
    seam.lockedFile = "Bundle.zip";
    expect(() => acquireLocalSource({ path: zip, scratchParent: tmp() })).toThrow(/source bytes could not be read/);
  });

  test("REG-WU-035-RC-046-e: a missing required content hash still blocks with the budget wording", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "big.md"), "x".repeat(4096));
    expect(() => observeLocalSourceModel({
      path: root,
      producerVersion: PRODUCER_VERSION,
      hashMaxBytes: 64,
    })).toThrow(/required content hash is missing/);
  });

  test("REG-WU-035-RC-046-f: symlinks and FIFOs are not missing hashes; the canonical packet is still produced", () => {
    const root = tmp();
    const outside = tmp();
    fs.writeFileSync(path.join(root, "README.md"), "# Fixture\n");
    fs.writeFileSync(path.join(outside, "target.txt"), "target\n");
    fs.symlinkSync(path.join(outside, "target.txt"), path.join(root, "link.txt"));
    try {
      execFileSync("mkfifo", [path.join(root, "pipe")]);
    } catch {
      // mkfifo unavailable on this platform; the symlink case still applies.
    }
    expect(blockFor(root)).toBeNull();
    const paths = withLocalSourceModel(
      { path: root, producerVersion: PRODUCER_VERSION, interpret: false },
      (result) => result.packet.payload.artifacts.map((artifact) => artifact.source_path),
    );
    expect(paths).toContain("README.md");
  });
});
