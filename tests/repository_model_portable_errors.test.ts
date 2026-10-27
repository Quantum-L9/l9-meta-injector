// repository_model_portable_errors.test.ts — an unreadable entry must not make the
// Repository Model Packet depend on where the tree is checked out (RC-032, F-041).
//
// The suite runs as root, so no permission bit can make an entry unreadable; the
// failure is injected at the `node:fs` module seam instead, keyed on the entry's
// own name so that two copies of one tree at different absolute paths fail the
// same way. Every other filesystem call is real.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { emitRepositoryModelBundle, observeRepositoryModel, type RepositoryModelPacket } from "../src/repository_model";

const seam = vi.hoisted(() => ({
  /** Directory basename whose `readdirSync` fails with EACCES. */
  lockedDir: "",
  /** File basename whose reads (`openSync`, `readFileSync`) fail with EACCES. */
  lockedFile: "",
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const denied = (syscall: string, target: string): NodeJS.ErrnoException => {
    const error = new Error(`EACCES: permission denied, ${syscall} '${target}'`) as NodeJS.ErrnoException;
    error.code = "EACCES";
    return error;
  };
  const readdirSync = ((target: fs.PathLike, ...rest: unknown[]) => {
    if (seam.lockedDir && path.basename(String(target)) === seam.lockedDir) throw denied("scandir", path.resolve(String(target)));
    return (actual.readdirSync as (...args: unknown[]) => unknown)(target, ...rest);
  }) as typeof fs.readdirSync;
  const openSync = ((target: fs.PathLike, ...rest: unknown[]) => {
    if (seam.lockedFile && path.basename(String(target)) === seam.lockedFile) throw denied("open", path.resolve(String(target)));
    return (actual.openSync as (...args: unknown[]) => unknown)(target, ...rest);
  }) as typeof fs.openSync;
  const readFileSync = ((target: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (seam.lockedFile && typeof target !== "number" && path.basename(String(target)) === seam.lockedFile) {
      throw denied("open", path.resolve(String(target)));
    }
    return (actual.readFileSync as (...args: unknown[]) => unknown)(target, ...rest);
  }) as typeof fs.readFileSync;
  const patched = { readdirSync, openSync, readFileSync };
  return { ...actual, ...patched, default: { ...actual, ...patched } };
});

const REPO = path.resolve(__dirname, "..");
const SAMPLE_ROOT = path.join(REPO, "fixtures", "repository-model", "sample-repo");
const GOLDEN = path.join(REPO, "fixtures", "repository-model", "expected-bundle");
const REVISION = "git:0000000000000000000000000000000000000000";
const PRODUCER_VERSION = "4.0.0";

const scratchDirs: string[] = [];
function scratch(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `l9-rm-portable-${name}-`));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  seam.lockedDir = "";
  seam.lockedFile = "";
});
afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** One tree, written identically wherever it is placed. */
function writeTree(root: string): void {
  fs.writeFileSync(path.join(root, "README.md"), "# Fixture\n");
  fs.mkdirSync(path.join(root, "locked"));
  fs.writeFileSync(path.join(root, "locked", "inner.md"), "# inner\n");
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "docs", "secret-ish.md"), "# secret-ish\n");
}

function observe(root: string): RepositoryModelPacket {
  return observeRepositoryModel({
    root,
    repositoryName: "fixture",
    sourceRevision: REVISION,
    producerVersion: PRODUCER_VERSION,
    interpret: false,
  });
}

function twoCheckouts(): { first: string; second: string } {
  const first = path.join(scratch("a"), "checkout-a", "project");
  const second = path.join(scratch("b"), "machine-b-mount", "project");
  for (const root of [first, second]) {
    fs.mkdirSync(root, { recursive: true });
    writeTree(root);
  }
  return { first, second };
}

describe("repository model identity with unreadable entries (RC-032)", () => {
  it("REG-WU-028-RC-032-B04-a: an unreadable directory yields the same identity at two absolute paths", () => {
    const { first, second } = twoCheckouts();
    seam.lockedDir = "locked";
    const a = observe(first);
    const b = observe(second);

    expect(b.source_snapshot.semantic_hash).toBe(a.source_snapshot.semantic_hash);
    expect(b.semantic_hash).toBe(a.semantic_hash);
    expect(b.packet_id).toBe(a.packet_id);
    const unreadable = a.payload.diagnostics.filter((d) => d.code === "directory-unreadable");
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0].details).toEqual({ directory: "locked", reason: "EACCES" });
  });

  it("REG-WU-028-RC-032-B04-b: an unreadable file yields the same identity at two absolute paths", () => {
    const { first, second } = twoCheckouts();
    seam.lockedFile = "secret-ish.md";
    const a = observe(first);
    const b = observe(second);

    expect(b.source_snapshot.semantic_hash).toBe(a.source_snapshot.semantic_hash);
    expect(b.semantic_hash).toBe(a.semantic_hash);
    expect(b.packet_id).toBe(a.packet_id);
    const unknowns = a.payload.diagnostics
      .filter((d) => d.code === "inventory-unknown")
      .map((d) => d.details?.unknown);
    expect(unknowns).toContain("stat_failed:EACCES");
  });

  it("REG-WU-028-RC-032-B04-c: no packet string carries either absolute root", () => {
    const { first, second } = twoCheckouts();
    seam.lockedDir = "locked";
    seam.lockedFile = "secret-ish.md";
    for (const root of [first, second]) {
      const serialized = JSON.stringify(observe(root));
      expect(serialized).not.toContain(first);
      expect(serialized).not.toContain(second);
      expect(serialized).not.toContain(os.tmpdir());
    }
  });

  it("REG-WU-028-RC-032-B04-d: a fully readable tree still reproduces the committed golden packet", () => {
    const packet = observeRepositoryModel({
      root: SAMPLE_ROOT,
      repositoryName: "sample-repo",
      sourceRevision: REVISION,
      producerVersion: PRODUCER_VERSION,
    });
    const emitted = path.join(scratch("golden"), "bundle");
    emitRepositoryModelBundle(packet, { outDir: emitted });
    for (const rel of ["packet.json", "manifest.json", path.join("receipts", "validation-receipt.json")]) {
      expect(fs.readFileSync(path.join(emitted, rel), "utf8")).toBe(fs.readFileSync(path.join(GOLDEN, rel), "utf8"));
    }
  });
});
