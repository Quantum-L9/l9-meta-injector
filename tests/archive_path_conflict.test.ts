// archive_path_conflict.test.ts — a path cannot be both a file and a directory.
//
// Two members, `a` and `a/b`, both regular files: no filesystem can hold both.
// Before the rule below existed the verdict depended on central-directory order —
// `a/b` first was held as an unreadable format, `a` first threw EEXIST out of
// extraction and leaked the scratch root. The rule is order-independent and is
// judged in preflight, before any byte is written, on both archive paths.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { acquireLocalSource } from "../src/local_source";
import { expandArchivesUnderRoot } from "../src/archives";
import { preflightArchive } from "../src/archive_preflight";
import { resolveLocalArchivePolicy } from "../src/local_archive_policy";
import { readZipCentralDirectory } from "../src/zip_reader";
import { ARCHIVE_READER_VERSION } from "../src/archive_execution";
import { ARCHIVE_READER_VERSION as LOCAL_SOURCE_READER_VERSION } from "../src/local_source";
import { treeSnapshot, writeRawZip, type ZipMemberSpec } from "./helpers/zip_fixtures";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-path-conflict-"));
}

function preflight(specs: ZipMemberSpec[]) {
  const archive = path.join(tmp(), "Case.zip");
  writeRawZip(archive, specs);
  return preflightArchive({
    directory: readZipCentralDirectory(archive),
    policy: resolveLocalArchivePolicy(),
    depth: 0,
    archiveCompressedBytes: fs.statSync(archive).size,
  });
}

describe("archive preflight — file/directory path conflicts", () => {
  test("a file followed by a child under it is held", () => {
    const result = preflight([{ name: "a", content: "x" }, { name: "a/b", content: "y" }]);
    expect(result.accepted).toBe(false);
    expect(result.holds.map((h) => [h.code, h.memberPath])).toEqual([["archive.path_conflict", "a"]]);
  });

  test("the reverse order receives the identical verdict", () => {
    const result = preflight([{ name: "a/b", content: "y" }, { name: "a", content: "x" }]);
    expect(result.accepted).toBe(false);
    expect(result.holds.map((h) => [h.code, h.memberPath])).toEqual([["archive.path_conflict", "a"]]);
  });

  test("a deeper ancestor declared as a file is caught too", () => {
    const result = preflight([{ name: "x/y/z.txt", content: "1" }, { name: "x/y", content: "2" }]);
    expect(result.holds.map((h) => h.code)).toEqual(["archive.path_conflict"]);
  });

  test("an explicit directory entry beside a file of the same path stays a duplicate", () => {
    const result = preflight([{ name: "docs/", content: "" }, { name: "docs", content: "file" }]);
    expect(result.holds.map((h) => h.code)).toEqual(["archive.duplicate_member"]);
  });

  test("a component longer than any filesystem stores is held before extraction", () => {
    const result = preflight([{ name: `${"n".repeat(256)}.txt`, content: "x" }]);
    expect(result.holds.map((h) => h.code)).toEqual(["archive.path_too_long"]);
  });

  test("ordinary nested files and directories are unaffected", () => {
    const result = preflight([
      { name: "a/", content: "" },
      { name: "a/b.txt", content: "1" },
      { name: "a/c/d.txt", content: "2" },
      { name: "ab", content: "3" },
    ]);
    expect(result.accepted).toBe(true);
    expect(result.members.map((m) => m.canonicalPath)).toEqual(["a/b.txt", "a/c/d.txt", "ab"]);
  });
});

describe("archive path conflicts — both archive paths hold, neither throws, nothing leaks", () => {
  for (const [label, specs] of [
    ["file-then-child", [{ name: "a", content: "x" }, { name: "a/b", content: "y" }]],
    ["child-then-file", [{ name: "a/b", content: "y" }, { name: "a", content: "x" }]],
  ] as Array<[string, ZipMemberSpec[]]>) {
    test(`read-only observation holds ${label} and disposes its scratch`, () => {
      const root = tmp();
      const scratchParent = tmp();
      writeRawZip(path.join(root, "Case.zip"), specs);
      const before = treeSnapshot(root);
      const observation = acquireLocalSource({ path: root, scratchParent });
      expect(observation.archives[0].expanded).toBe(false);
      expect(observation.archives[0].holds.map((h) => h.code)).toEqual(["archive.path_conflict"]);
      expect(observation.virtualArtifacts).toEqual([]);
      expect(observation.stable).toBe(true);
      observation.dispose();
      expect(fs.readdirSync(scratchParent)).toEqual([]);
      expect(treeSnapshot(root)).toEqual(before);
    });

    test(`local-files materialization holds ${label} without a candidate left behind`, () => {
      const root = tmp();
      writeRawZip(path.join(root, "Case.zip"), specs);
      const before = treeSnapshot(root);
      const result = expandArchivesUnderRoot(root, { dryRun: false, verbose: false });
      expect(result.archives).toHaveLength(1);
      expect(result.archives[0].heldReason).toContain("archive.path_conflict");
      expect(result.extractedRoots).toEqual([]);
      expect(treeSnapshot(root)).toEqual(before);
    });
  }
});

describe("reader version", () => {
  test("is declared once and re-exported, and names the rule change", () => {
    expect(LOCAL_SOURCE_READER_VERSION).toBe(ARCHIVE_READER_VERSION);
    expect(ARCHIVE_READER_VERSION).toBe("1.1.0");
  });

  test("a warm 1.0.0 verdict is not consulted for a 1.1.0 reader", () => {
    const root = tmp();
    writeRawZip(path.join(root, "Case.zip"), [{ name: "a", content: "x" }, { name: "a/b", content: "y" }]);
    const seen: string[] = [];
    const observation = acquireLocalSource({
      path: root,
      scratchParent: tmp(),
      archiveManifests: {
        get: (key) => { seen.push(key.readerVersion); return undefined; },
        put: () => {},
      },
    });
    observation.dispose();
    expect(seen).toEqual(["1.1.0"]);
  });
});
