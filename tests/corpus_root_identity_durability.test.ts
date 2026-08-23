// corpus_root_identity_durability.test.ts — how much a root id is worth, and
// how much a written file is worth.
//
// Two properties that look unrelated and share a shape: both are about a claim
// being weaker than it appears.
//
// A root id is `H(root_key)`, and the key defaults to the final segment of the
// path the disk was mounted at. That is a good default and a weak identity —
// `/Volumes/Backup` and an unrelated `/mnt/usb/Backup` produce the same id — so
// a diff that reports `root_unchanged` between two runs may be comparing two
// different drives. The class is now recorded and the diff says so.
//
// A rename is atomic, so no reader sees a half-written file while the system is
// running. It says nothing about a power cut: both the bytes and the directory
// entry naming them can still be in the page cache. The write path now syncs
// both, in the order that makes each step cover what the previous one does not.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FileCorpusCache } from "../src/corpus_cache";
import { buildCorpusDiff } from "../src/corpus_diff";
import { commitFileDurably, syncDirectory, writeFileDurably } from "../src/durable_write";
import type { DurableFileOps } from "../src/durable_write";
import { runCorpusScan } from "../src/corpus_scan";

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-root-id-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});
function corpusAt(parent: string, name: string): string {
  const root = path.join(parent, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "plan.md"), "# Plan\n\nSome prose about a plan.\n", "utf8");
  return root;
}

describe("root_identity_class", () => {
  it("is inferred when the key came from the mount point", async () => {
    const result = await runCorpusScan({
      roots: [{ path: corpusAt(tmp(), "Backup") }],
      producerVersion: "test",
    });
    expect(result.snapshot.roots[0]?.root_key).toBe("Backup");
    expect(result.snapshot.roots[0]?.root_identity_class).toBe("inferred");
    expect(result.candidates.roots[0]?.root_identity_class).toBe("inferred");
  });

  it("is declared when the operator named the root", async () => {
    const result = await runCorpusScan({
      roots: [{ path: corpusAt(tmp(), "Backup"), name: "january-backup" }],
      producerVersion: "test",
    });
    expect(result.snapshot.roots[0]?.root_key).toBe("january-backup");
    expect(result.snapshot.roots[0]?.root_identity_class).toBe("declared");
  });

  it("survives a root that could not be read, which is when it matters most", async () => {
    const parent = tmp();
    const missing = path.join(parent, "Unplugged");
    const result = await runCorpusScan({
      roots: [{ path: corpusAt(parent, "Present") }, { path: missing }],
      producerVersion: "test",
      allowPartialRoots: true,
    });
    const failed = result.snapshot.roots.find((root) => root.observation_status !== "observed");
    // A drive that was not there is exactly the case where an operator will ask
    // later whether this is the same drive they meant, so the class has to be on
    // the row rather than only on the rows that worked.
    expect(failed?.root_identity_class).toBe("inferred");
  });
});

describe("the diff's longitudinal identity guard", () => {
  /** Two runs over one root, so the diff has something to compare. */
  async function twoRuns(spec: { path: string; name?: string }) {
    const first = await runCorpusScan({ roots: [spec], producerVersion: "test" });
    fs.writeFileSync(path.join(spec.path, "extra.md"), "# Extra\n\nMore prose.\n", "utf8");
    const second = await runCorpusScan({
      roots: [spec], producerVersion: "test", previousSnapshot: first.snapshot,
    });
    return { first, second };
  }

  it("cautions when two runs were matched on a key nobody declared", async () => {
    const { second } = await twoRuns({ path: corpusAt(tmp(), "Backup") });
    const diff = second.diff;

    expect(diff?.roots[0]?.category).toBe("root_changed");
    expect(diff?.roots[0]?.identity_basis).toBe("inferred");
    expect(diff?.longitudinal_identity_cautions).toHaveLength(1);
    const caution = diff?.longitudinal_identity_cautions[0];
    expect(caution?.root_key).toBe("Backup");
    expect(caution?.message).toContain("mount point");
    // And it says what to do about it rather than only that something is wrong.
    expect(caution?.message).toContain("--root");
  });

  it("stays silent when the operator named the root", async () => {
    const { second } = await twoRuns({
      path: corpusAt(tmp(), "Backup"), name: "january-backup",
    });
    expect(second.diff?.roots[0]?.identity_basis).toBe("declared");
    expect(second.diff?.longitudinal_identity_cautions).toEqual([]);
  });

  it("reads a snapshot with no class as inferred, which is the cautious reading", async () => {
    const root = corpusAt(tmp(), "Backup");
    const first = await runCorpusScan({
      roots: [{ path: root, name: "january-backup" }], producerVersion: "test",
    });
    const second = await runCorpusScan({
      roots: [{ path: root, name: "january-backup" }], producerVersion: "test",
    });

    // A snapshot from before the class existed says nothing about how its keys
    // were chosen. Assuming `declared` would manufacture a guarantee out of a
    // missing field; assuming `inferred` produces a caution that is at worst
    // unnecessary.
    const legacy = {
      ...first.snapshot,
      roots: first.snapshot.roots.map(({ root_identity_class: _dropped, ...rest }) => rest),
    } as typeof first.snapshot;

    const diff = buildCorpusDiff(legacy, second.snapshot);
    expect(diff.roots[0]?.identity_basis).toBe("mixed");
    expect(diff.longitudinal_identity_cautions).toHaveLength(1);
    expect(diff.longitudinal_identity_cautions[0]?.previous_class).toBe("inferred");
    expect(diff.longitudinal_identity_cautions[0]?.current_class).toBe("declared");
  });

  it("makes no claim about a root that appeared or vanished", async () => {
    const parent = tmp();
    const first = await runCorpusScan({
      roots: [{ path: corpusAt(parent, "One") }], producerVersion: "test",
    });
    const second = await runCorpusScan({
      roots: [{ path: corpusAt(parent, "Two") }],
      producerVersion: "test",
      previousSnapshot: first.snapshot,
    });
    // Neither row spans two runs, so neither asserts continuity and neither is
    // cautioned. A caution on an added root would be noise.
    expect(second.diff?.roots.map((root) => root.category).sort())
      .toEqual(["root_added", "root_removed"]);
    expect(second.diff?.longitudinal_identity_cautions).toEqual([]);
  });
});

describe("durability of a written file", () => {
  /** A recording wrapper around the real syscalls: order observed, work done. */
  function recordingOps(order: string[]): DurableFileOps {
    const directories = new Set<number>();
    return {
      openSync(target, flags, mode) {
        const handle = mode === undefined
          ? fs.openSync(target, flags)
          : fs.openSync(target, flags, mode);
        if (fs.fstatSync(handle).isDirectory()) directories.add(handle);
        return handle;
      },
      writeSync(handle, contents) {
        order.push("write");
        fs.writeFileSync(handle, contents, "utf8");
      },
      fsyncSync(handle) {
        order.push(directories.has(handle) ? "fsync:dir" : "fsync:file");
        fs.fsyncSync(handle);
      },
      closeSync(handle) {
        directories.delete(handle);
        fs.closeSync(handle);
      },
      renameSync(from, to) {
        order.push("rename");
        fs.renameSync(from, to);
      },
    };
  }

  it("writes, syncs the bytes, renames, and syncs the parent, in that order", () => {
    const directory = tmp();
    const target = path.join(directory, "entry.json");
    const order: string[] = [];

    commitFileDurably({
      staging: `${target}.tmp`,
      target,
      contents: '{"ok":true}\n',
      ops: recordingOps(order),
    });

    // Each step covers what the previous one does not. Syncing the bytes before
    // the rename means the name can never come to point at contents that were
    // never written; syncing the parent afterwards means the name itself is on
    // the device. Reorder any two and there is a power-cut moment that leaves a
    // file which parses and is wrong.
    expect(order).toEqual(["write", "fsync:file", "rename", "fsync:dir"]);
    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual({ ok: true });
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it("applies permissions while the descriptor is still open", () => {
    const directory = tmp();
    const target = path.join(directory, "perm.json");
    let sawOpenHandle = false;
    writeFileDurably(target, "{}\n", {
      mode: 0o600,
      between: () => {
        // The file exists and is mid-write: this is the window in which a mode
        // change lands on the file that is about to be synced rather than on
        // whatever the path names afterwards.
        sawOpenHandle = fs.existsSync(target);
        fs.chmodSync(target, 0o600);
      },
    });
    expect(sawOpenHandle).toBe(true);
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  it("tolerates a filesystem that will not sync a directory", () => {
    // Windows refuses to open a directory as a file, and some filesystems refuse
    // the sync. Neither may take down a write: the in-system atomicity the
    // rename provides is unaffected, and a durability improvement that throws
    // where it cannot apply is worse than one that does not.
    const refusing: DurableFileOps = {
      ...recordingOps([]),
      openSync() {
        throw new Error("EISDIR: illegal operation on a directory");
      },
    };
    expect(() => syncDirectory(tmp(), refusing)).not.toThrow();

    // And a commit still completes on such a filesystem.
    const directory = tmp();
    const target = path.join(directory, "entry.json");
    const order: string[] = [];
    const ops = recordingOps(order);
    const halfRefusing: DurableFileOps = {
      ...ops,
      openSync(t, flags, mode) {
        if (flags === "r") throw new Error("EISDIR");
        return ops.openSync(t, flags, mode);
      },
    };
    commitFileDurably({ staging: `${target}.tmp`, target, contents: "{}\n", ops: halfRefusing });
    expect(order).toEqual(["write", "fsync:file", "rename"]);
    expect(fs.readFileSync(target, "utf8")).toBe("{}\n");
  });

  it("leaves a cache entry either absent or complete, never partial", () => {
    const cacheRoot = path.join(tmp(), "cache");
    const cache = new FileCorpusCache({ root: cacheRoot, producerVersion: "test" });
    cache.put("normalized_document", "key-a", { decodes: true, token_count: 7 });

    // No staging file survives the write, and what is on disk parses whole.
    const files: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else files.push(absolute);
      }
    };
    walk(cacheRoot);
    expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(() => JSON.parse(fs.readFileSync(file, "utf8"))).not.toThrow();
    }
    expect(cache.get("normalized_document", "key-a")).toEqual({ decodes: true, token_count: 7 });
  });

  it("leaves a session manifest whole, because a torn resume file is silently harmful", async () => {
    const { CorpusSessionStore, DEFAULT_CORPUS_BUDGETS } = await import("../src/corpus_session");
    const directory = tmp();
    const file = path.join(directory, "session", "corpus-session.json");
    const store = CorpusSessionStore.open({
      file,
      roots: [{ root_key: "r", root_id: "root:r", absolute_path: directory }],
      budgets: { ...DEFAULT_CORPUS_BUDGETS, archive: {} },
      now: "2026-01-01T00:00:00.000Z",
    });
    store.save("2026-01-01T00:00:01.000Z");

    // A `completed_source_ids` list torn by a power cut can still parse, and the
    // next attempt would then skip work that was never done — the one failure a
    // resume feature must not have.
    expect(JSON.parse(fs.readFileSync(file, "utf8")).session_id).toBe(store.id);
    expect(fs.existsSync(`${file}.${process.pid}.tmp`)).toBe(false);
  });
});
