// direct_write_atomicity.test.ts — a source file is never truncated mid-write.
//
// The comment/frontmatter injector, the adjacent sidecars and the archive
// sidecar are the direct-write mutation paths (the governed apply operation has
// its own whole-run transaction). They used to open the target itself for
// writing, which is a truncate followed by a write, and which writes through the
// existing inode. Both properties are asserted closed here: the write is staged
// beside the target and renamed in, an existing file keeps its mode, a symlink is
// refused rather than followed, and a hard link to a file outside the governed
// root keeps its bytes.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { replaceFileAtomically, type DurableFileOps, nodeFileOps } from "../src/durable_write";
import { runPipelineAsync } from "../src/pipeline";
import { inventoryTree } from "../src/inventory";
import { writeArchiveSidecar } from "../src/archives";
import { sidecarPathFor } from "../src/comment";
import { writeRawZip } from "./helpers/zip_fixtures";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-atomic-"));
}

describe("replaceFileAtomically", () => {
  test("stages a sibling, syncs it, renames it in, then syncs the directory", () => {
    const root = tmp();
    const target = path.join(root, "a.txt");
    fs.writeFileSync(target, "old");
    const calls: string[] = [];
    const ops: DurableFileOps = {
      openSync: (p, flags, mode) => { calls.push(`open:${path.basename(p).replace(/-\d+-[a-z0-9]+$/, "-N")}:${flags}`); return nodeFileOps.openSync(p, flags, mode); },
      writeSync: (h, c) => { calls.push("write"); nodeFileOps.writeSync(h, c); },
      fsyncSync: (h) => { calls.push("fsync"); nodeFileOps.fsyncSync(h); },
      closeSync: (h) => { calls.push("close"); nodeFileOps.closeSync(h); },
      renameSync: (from, to) => { calls.push(`rename->${path.basename(to)}`); nodeFileOps.renameSync(from, to); },
    };
    replaceFileAtomically(target, "new", { ops });
    expect(fs.readFileSync(target, "utf8")).toBe("new");
    expect(calls).toEqual(["open:.a.txt.l9stage-N:wx", "write", "fsync", "close", "rename->a.txt", `open:${path.basename(root)}:r`, "fsync", "close"]);
    expect(fs.readdirSync(root)).toEqual(["a.txt"]);
  });

  test("an existing target keeps its permission bits, whatever the umask", () => {
    const root = tmp();
    const target = path.join(root, "run.sh");
    fs.writeFileSync(target, "#!/bin/sh\n");
    fs.chmodSync(target, 0o775);
    const previous = process.umask(0o077);
    try {
      replaceFileAtomically(target, "#!/bin/sh\necho hi\n");
    } finally {
      process.umask(previous);
    }
    expect(fs.statSync(target).mode & 0o777).toBe(0o775);
  });

  test("a new target receives the requested mode", () => {
    const root = tmp();
    const target = path.join(root, "new.txt");
    replaceFileAtomically(target, "x", { mode: 0o600 });
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  test("a symbolic link at the target is refused, never followed", () => {
    const root = tmp();
    const outside = path.join(tmp(), "outside.txt");
    fs.writeFileSync(outside, "outside");
    const link = path.join(root, "link.txt");
    fs.symlinkSync(outside, link);
    expect(() => replaceFileAtomically(link, "hijack")).toThrow(/symbolic link/);
    expect(fs.readFileSync(outside, "utf8")).toBe("outside");
    expect(fs.readdirSync(root)).toEqual(["link.txt"]);
  });

  test("a failed staging write leaves the target and the directory untouched", () => {
    const root = tmp();
    const target = path.join(root, "a.txt");
    fs.writeFileSync(target, "old");
    const ops: DurableFileOps = { ...nodeFileOps, writeSync: () => { throw new Error("disk full"); } };
    expect(() => replaceFileAtomically(target, "new", { ops })).toThrow(/disk full/);
    expect(fs.readFileSync(target, "utf8")).toBe("old");
    expect(fs.readdirSync(root)).toEqual(["a.txt"]);
  });

  test("a hard link to a file outside the root keeps the outside bytes", () => {
    const root = tmp();
    const outside = path.join(tmp(), "outside.py");
    fs.writeFileSync(outside, "print('outside')\n");
    const inside = path.join(root, "linked.py");
    fs.linkSync(outside, inside);
    replaceFileAtomically(inside, "print('inside')\n");
    expect(fs.readFileSync(outside, "utf8")).toBe("print('outside')\n");
    expect(fs.readFileSync(inside, "utf8")).toBe("print('inside')\n");
    expect(fs.statSync(inside).nlink).toBe(1);
  });
});

describe("direct-write mutation paths go through the atomic replace", () => {
  test("pipeline injection into a hard-linked file does not reach the link's other name", async () => {
    const root = tmp();
    const outside = path.join(tmp(), "outside.py");
    fs.writeFileSync(outside, "print('outside')\n");
    fs.linkSync(outside, path.join(root, "linked.py"));
    const out = `${root}.out`;
    await runPipelineAsync({
      root, glob: "**/*", dryRun: false, outDir: out, indexDir: out, namespace: "t", authority: "t",
      nearDupThreshold: 0.9, hashPrefixLength: 16, verbose: false, llmEnabled: false,
      normalizeFilenames: false, writeInjectLog: false, localFiles: false,
    });
    expect(fs.readFileSync(path.join(root, "linked.py"), "utf8")).toContain("l9:meta");
    expect(fs.readFileSync(outside, "utf8")).toBe("print('outside')\n");
    expect(fs.readdirSync(root)).toEqual(["linked.py"]);
  });

  test("inventory sidecars and the archive sidecar leave no staging file behind", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "data.json"), "{}\n");
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false });
    expect(fs.existsSync(sidecarPathFor(path.join(root, "data.json")))).toBe(true);
    const archive = path.join(root, "Bundle.zip");
    writeRawZip(archive, [{ name: "a.md", content: "# a\n" }]);
    writeArchiveSidecar(archive, `${archive}.l9extracted`, 1);
    expect(fs.existsSync(sidecarPathFor(archive))).toBe(true);
    expect(fs.readdirSync(root).filter((n) => n.includes(".l9stage-"))).toEqual([]);
  });

  test("no direct-write path opens its target for writing in place", () => {
    for (const file of ["src/inject.ts", "src/inventory.ts", "src/archives.ts"]) {
      const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
      // Permitted plain writes: dry-run diffs and manifests under the caller's output
      // directory, and the ownership marker inside a not-yet-live extraction candidate.
      const inPlace: string[] = [];
      for (const match of source.matchAll(/fs\.writeFileSync\(([^;]*)/g)) {
        const target = match[1];
        if (/dryRunDiffPath|jsonPath|csvPath|mdPath|dupPath|LEGACY_EXTRACTION_OWNER_FILE/.test(target)) continue;
        inPlace.push(target.split("\n")[0].trim());
      }
      expect(inPlace, `${file}: ${inPlace.join(" | ")}`).toEqual([]);
    }
  });
});
