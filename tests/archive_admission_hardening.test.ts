// archive_admission_hardening.test.ts — WU-032 (ADR-061): the ZIP reader no
// longer trusts declared sizes, and Unix modes without file-type bits classify
// by name.
//
// RC-038: a member's declared data extent must fit inside the archive before the
// central directory, and the bytes a member produces must equal its declared
// uncompressed size. A lie either way is an integrity hold, never an allocation
// failure that aborts the run and never a silent over- or under-expansion.
//
// RC-041: a Unix-host entry whose mode carries permission bits but no S_IFMT type
// bits (CPython `zipfile.writestr` writes 0o600) is classified by its name, as
// Info-ZIP and Python themselves extract it.
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { ARCHIVE_READER_VERSION } from "../src/archive_execution";
import { preflightArchive } from "../src/archive_preflight";
import type { ArchivePreflightResult } from "../src/archive_preflight";
import { expandArchivesUnderRoot, extractDirFor, extractZip } from "../src/archives";
import { inventoryTree } from "../src/inventory";
import { upsertArchiveRootMeta } from "../src/inventory_archive_member";
import { localArchivePolicyFingerprint, resolveLocalArchivePolicy } from "../src/local_archive_policy";
import { acquireLocalSource } from "../src/local_source";
import type { ArchiveManifestKey, ArchiveManifestStore } from "../src/local_source";
import {
  ZipBudgetExceededError,
  ZipFormatError,
  readZipCentralDirectory,
  streamZipMember,
} from "../src/zip_reader";
import { UNIX_SYMLINK, treeSnapshot, writeRawZip, type ZipMemberSpec } from "./helpers/zip_fixtures";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-admission-"));
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Every entry name under a directory, recursively, so leaked candidates are visible. */
function allNames(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      out.push(name);
      const abs = path.join(dir, name);
      if (fs.lstatSync(abs).isDirectory()) walk(abs);
    }
  };
  walk(root);
  return out;
}

/** The thrown value of `fn`, or a failure when it returns. */
function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to throw");
}

const TWO_POW_40 = 2 ** 40;

/** Deflate member whose Zip64-declared compressed size is 2^40 bytes. */
const HOSTILE_EXTENT: ZipMemberSpec[] = [{
  name: "payload.txt",
  content: "hello hostile\n",
  zip64: true,
  declaredCompressedSize: TWO_POW_40,
  declaredUncompressedSize: 1,
}];

const GOOD: ZipMemberSpec[] = [{ name: "good.md", content: "# Good\n" }];

/** Honest archive whose last member's compressed size is then stated one byte too large. */
function writeOverstatedExtent(archivePath: string): void {
  const content = "the last member's data ends exactly at the central directory\n";
  writeRawZip(archivePath, [
    { name: "first.txt", content: "first\n" },
    { name: "last.txt", content, stored: true, declaredCompressedSize: Buffer.byteLength(content) + 1 },
  ]);
}

/** A bomb that declares 1 byte and inflates to 8 MiB. */
const EIGHT_MIB = 8 * 1024 * 1024;
const LYING_BOMB_CONTENT = Buffer.alloc(EIGHT_MIB, 0x41);
const LYING_BOMB: ZipMemberSpec[] = [{ name: "bomb.bin", content: LYING_BOMB_CONTENT, declaredUncompressedSize: 1 }];
const GENEROUS = {
  maxCompressionRatio: 10,
  maxSingleMemberUncompressedBytes: 64 * 1024 * 1024,
  maxTotalUncompressedBytesPerArchive: 64 * 1024 * 1024,
  maxTotalUncompressedBytesPerSession: 64 * 1024 * 1024,
};

describe("RC-038 — declared data extents are bounded before any allocation", () => {
  test("REG-WU-032-RC-038-038-a: local-files holds an impossible extent and keeps expanding the next archive", () => {
    const root = tmp();
    writeRawZip(path.join(root, "a_hostile.zip"), HOSTILE_EXTENT);
    writeRawZip(path.join(root, "b_good.zip"), GOOD);

    const result = expandArchivesUnderRoot(root, { dryRun: false, verbose: false });
    const hostile = result.archives.find((archive) => archive.zipPath.endsWith("a_hostile.zip"));
    const good = result.archives.find((archive) => archive.zipPath.endsWith("b_good.zip"));
    expect(hostile?.heldReason).toContain("archive.format_unreadable");
    expect(good?.heldReason ?? null).toBeNull();
    expect(result.extractedRoots).toEqual([extractDirFor(path.join(root, "b_good.zip"))]);
    expect(fs.readFileSync(path.join(extractDirFor(path.join(root, "b_good.zip")), "good.md"), "utf8"))
      .toBe("# Good\n");
    expect(fs.existsSync(extractDirFor(path.join(root, "a_hostile.zip")))).toBe(false);
    expect(allNames(root).filter((name) => name.includes(".candidate-"))).toEqual([]);
  });

  test("REG-WU-032-RC-038-038-b: local-source holds an impossible extent, claims no member, and disposes scratch", () => {
    const root = tmp();
    const scratchParent = tmp();
    writeRawZip(path.join(root, "a_hostile.zip"), HOSTILE_EXTENT);
    writeRawZip(path.join(root, "b_good.zip"), GOOD);
    const before = treeSnapshot(root);

    const observation = acquireLocalSource({ path: root, scratchParent });
    try {
      const hostile = observation.archives.find((archive) => archive.sourcePath === "a_hostile.zip");
      const good = observation.archives.find((archive) => archive.sourcePath === "b_good.zip");
      expect(hostile?.expanded).toBe(false);
      expect(hostile?.holds.map((hold) => hold.code)).toEqual(["archive.format_unreadable"]);
      expect(good?.expanded).toBe(true);
      expect(observation.virtualArtifacts.map((member) => member.virtualSourcePath)).toEqual(["b_good.zip!/good.md"]);
    } finally {
      observation.dispose();
    }
    expect(fs.readdirSync(scratchParent)).toEqual([]);
    expect(treeSnapshot(root)).toEqual(before);
  });

  test("REG-WU-032-RC-038-038-c: a last member whose data ends exactly at the central directory is accepted", () => {
    const root = tmp();
    const archivePath = path.join(root, "honest.zip");
    const content = "the last member's data ends exactly at the central directory\n";
    writeRawZip(archivePath, [{ name: "first.txt", content: "first\n" }, { name: "last.txt", content, stored: true }]);
    const bytes = fs.readFileSync(archivePath);
    const centralOffset = bytes.readUInt32LE(bytes.length - 22 + 16);
    const directory = readZipCentralDirectory(archivePath);
    const last = directory.entries[1];
    expect(last.localHeaderOffset + 30 + "last.txt".length + last.compressedSize).toBe(centralOffset);

    const verdict = preflightArchive({
      directory,
      policy: resolveLocalArchivePolicy(),
      depth: 0,
      archiveCompressedBytes: bytes.length,
    });
    expect(verdict.accepted).toBe(true);
    const extractDir = path.join(root, "out");
    expect(extractZip(archivePath, extractDir)).toBe(2);
    expect(fs.readFileSync(path.join(extractDir, "last.txt"), "utf8")).toBe(content);
  });

  test("REG-WU-032-RC-038-038-d: a compressed size one byte past the central directory is refused at directory read", () => {
    const root = tmp();
    const archivePath = path.join(root, "overstated.zip");
    writeOverstatedExtent(archivePath);
    const error = thrown(() => readZipCentralDirectory(archivePath));
    expect(error).toBeInstanceOf(ZipFormatError);
    expect(error.message).toMatch(/extends past the start of the central directory/);

    const observation = acquireLocalSource({ path: archivePath });
    try {
      expect(observation.archives[0].expanded).toBe(false);
      expect(observation.archives[0].holds.map((hold) => hold.code)).toEqual(["archive.format_unreadable"]);
      expect(observation.virtualArtifacts).toEqual([]);
    } finally {
      observation.dispose();
    }
    const result = expandArchivesUnderRoot(root, { dryRun: false, verbose: false });
    expect(result.archives[0].heldReason).toContain("archive.format_unreadable");
    expect(result.extractedRoots).toEqual([]);
  });

  test("REG-WU-032-RC-038-038-j: a warm 1.1.0 'accepted' verdict is never replayed for the 1.2.0 reader", () => {
    const root = tmp();
    const archivePath = path.join(root, "overstated.zip");
    writeOverstatedExtent(archivePath);
    const staleAccepted: ArchivePreflightResult = {
      accepted: true,
      holds: [],
      members: [],
      directories: [],
      declaredUncompressedBytes: 0,
      declaredCompressedBytes: 0,
    };
    const keyOf = (key: ArchiveManifestKey): string =>
      `${key.archiveContentHash}|${key.readerVersion}|${key.policyFingerprint}`;
    const store = new Map<string, ArchivePreflightResult>();
    store.set(keyOf({
      archiveContentHash: `sha256:${sha256(fs.readFileSync(archivePath))}`,
      readerVersion: "1.1.0",
      policyFingerprint: localArchivePolicyFingerprint(resolveLocalArchivePolicy()),
    }), staleAccepted);
    const seen: string[] = [];
    const manifests: ArchiveManifestStore = {
      get: (key) => { seen.push(key.readerVersion); return store.get(keyOf(key)); },
      put: (key, value) => { store.set(keyOf(key), value); },
    };

    const observation = acquireLocalSource({ path: root, scratchParent: tmp(), archiveManifests: manifests });
    try {
      expect(seen).toEqual(["1.2.0"]);
      expect(ARCHIVE_READER_VERSION).toBe("1.2.0");
      expect(observation.archives[0].expanded).toBe(false);
      expect(observation.archives[0].holds.map((hold) => hold.code)).toEqual(["archive.format_unreadable"]);
    } finally {
      observation.dispose();
    }
  });

  test("REG-WU-032-RC-038-038-k: inventory holds the rewrite of an impossible extent and leaves the bytes alone", () => {
    const root = tmp();
    const archivePath = path.join(root, "a_hostile.zip");
    writeRawZip(archivePath, HOSTILE_EXTENT);
    const before = fs.readFileSync(archivePath);
    const result = inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false });
    const record = result.records.find((row) => row.file_name === "a_hostile.zip");
    expect(record?.unknowns.some((unknown) => unknown.startsWith("archive_rewrite_held:archive.format_unreadable")))
      .toBe(true);
    expect(fs.readFileSync(archivePath)).toEqual(before);
  });
});

describe("RC-038 — produced bytes must equal the declared uncompressed size", () => {
  test("REG-WU-032-RC-038-038-e: an understated deflate size stops at the declared size on both paths", () => {
    const root = tmp();
    const archivePath = path.join(root, "lie.zip");
    writeRawZip(archivePath, LYING_BOMB);
    const entry = readZipCentralDirectory(archivePath).entries[0];
    expect(entry.uncompressedSize).toBe(1);

    let produced = 0;
    const error = thrown(() => streamZipMember(
      archivePath,
      entry,
      { maxUncompressedBytes: GENEROUS.maxSingleMemberUncompressedBytes },
      (chunk) => { produced += chunk.length; },
    ));
    expect(error).toBeInstanceOf(ZipFormatError);
    expect(error.name).toBe("ZipSizeMismatchError");
    expect(produced).toBeLessThanOrEqual(1);

    // local-files: extractZip refuses with the integrity error and leaves no
    // extraction directory or candidate behind.
    const extractDir = extractDirFor(archivePath);
    expect(() => extractZip(archivePath, extractDir, undefined, { policy: GENEROUS })).toThrow(ZipFormatError);
    expect(fs.existsSync(extractDir)).toBe(false);
    expect(allNames(root)).toEqual(["lie.zip"]);
    const expanded = expandArchivesUnderRoot(root, { dryRun: false, verbose: false, archivePolicy: GENEROUS });
    expect(expanded.archives[0].heldReason).toContain("archive.integrity_failed");
    expect(allNames(root)).toEqual(["lie.zip"]);

    // local-source: the member is an integrity failure and nothing stays staged.
    const scratchParent = tmp();
    const observation = acquireLocalSource({ path: root, scratchParent, archivePolicy: GENEROUS });
    try {
      expect(observation.archives[0].expanded).toBe(false);
      expect(observation.archives[0].holds.map((hold) => hold.code)).toEqual(["archive.member_integrity_failed"]);
      expect(observation.virtualArtifacts).toEqual([]);
      const scratchRoots = fs.readdirSync(scratchParent);
      const staged = scratchRoots.flatMap((name) => {
        const members = path.join(scratchParent, name, "members");
        return fs.existsSync(members) ? allNames(members).filter((n) => n === "bomb.bin") : [];
      });
      expect(staged).toEqual([]);
    } finally {
      observation.dispose();
    }
    expect(fs.readdirSync(scratchParent)).toEqual([]);
  });

  test("REG-WU-032-RC-038-038-f: an overstated deflate size (1000 declared, 11 produced) is an integrity hold", () => {
    const root = tmp();
    writeRawZip(path.join(root, "over.zip"), [{ name: "short.txt", content: "eleven byte", declaredUncompressedSize: 1000 }]);
    const observation = acquireLocalSource({ path: root, scratchParent: tmp() });
    try {
      expect(observation.archives[0].expanded).toBe(false);
      expect(observation.archives[0].holds.map((hold) => hold.code)).toEqual(["archive.member_integrity_failed"]);
      expect(observation.virtualArtifacts).toEqual([]);
    } finally {
      observation.dispose();
    }
    const expanded = expandArchivesUnderRoot(root, { dryRun: false, verbose: false });
    expect(expanded.archives[0].heldReason).toContain("archive.integrity_failed");
    expect(expanded.extractedRoots).toEqual([]);
  });

  test("REG-WU-032-RC-038-038-g: a stored member whose declared size understates its data is an integrity hold", () => {
    const root = tmp();
    writeRawZip(path.join(root, "stored.zip"), [
      { name: "big.txt", content: "s".repeat(4096), stored: true, declaredUncompressedSize: 1 },
    ]);
    const observation = acquireLocalSource({ path: root, scratchParent: tmp(), archivePolicy: { maxCompressionRatio: 100000 } });
    try {
      expect(observation.archives[0].expanded).toBe(false);
      expect(observation.archives[0].holds.map((hold) => hold.code)).toEqual(["archive.member_integrity_failed"]);
      expect(observation.virtualArtifacts).toEqual([]);
    } finally {
      observation.dispose();
    }
  });

  test("REG-WU-032-RC-038-038-h: honest deflate, stored and zero-length members keep exact sizes and digests", () => {
    const deflated = "# Deflated\n".repeat(64);
    const stored = "stored plain text\n";
    const specs: ZipMemberSpec[] = [
      { name: "deflated.md", content: deflated },
      { name: "stored.txt", content: stored, stored: true },
      { name: "empty.txt", content: "" },
    ];
    const root = tmp();
    writeRawZip(path.join(root, "honest.zip"), specs);

    const observation = acquireLocalSource({ path: root, scratchParent: tmp() });
    try {
      expect(observation.archives[0].expanded).toBe(true);
      const byName = new Map(observation.virtualArtifacts.map((member) => [member.memberPath, member]));
      for (const [name, body] of [["deflated.md", deflated], ["stored.txt", stored], ["empty.txt", ""]]) {
        expect(byName.get(name)?.sizeBytes).toBe(Buffer.byteLength(body));
        expect(byName.get(name)?.contentHash).toBe(`sha256:${sha256(body)}`);
      }
    } finally {
      observation.dispose();
    }

    const expanded = expandArchivesUnderRoot(root, { dryRun: false, verbose: false });
    expect(expanded.archives[0].heldReason ?? null).toBeNull();
    const extractDir = extractDirFor(path.join(root, "honest.zip"));
    expect(fs.readFileSync(path.join(extractDir, "deflated.md"), "utf8")).toBe(deflated);
    expect(fs.readFileSync(path.join(extractDir, "stored.txt"), "utf8")).toBe(stored);
    expect(fs.readFileSync(path.join(extractDir, "empty.txt")).length).toBe(0);
  });

  test("REG-WU-032-RC-038-038-i: the caller's ceiling still binds inside inflate with ZipBudgetExceededError", () => {
    const root = tmp();
    const archivePath = path.join(root, "big.zip");
    writeRawZip(archivePath, [{ name: "big.txt", content: "A".repeat(512 * 1024) }]);
    const entry = readZipCentralDirectory(archivePath).entries[0];
    const chunks: Buffer[] = [];
    expect(() => streamZipMember(archivePath, entry, { maxUncompressedBytes: 4096 }, (chunk) => { chunks.push(chunk); }))
      .toThrow(ZipBudgetExceededError);
    expect(chunks).toEqual([]);
  });
});

describe("RC-041 — Unix modes without file-type bits classify by name", () => {
  function entryFor(spec: ZipMemberSpec) {
    const archivePath = path.join(tmp(), "mode.zip");
    writeRawZip(archivePath, [spec]);
    const directory = readZipCentralDirectory(archivePath);
    const verdict = preflightArchive({
      directory,
      policy: resolveLocalArchivePolicy(),
      depth: 0,
      archiveCompressedBytes: fs.statSync(archivePath).size,
    });
    return { entry: directory.entries[0], verdict };
  }

  test("REG-WU-032-RC-041-041-a: a permission-only file mode is a file and keeps its recorded mode", () => {
    const { entry, verdict } = entryFor({ name: "report.txt", content: "report\n", unixMode: 0o600 });
    expect(entry.kind).toBe("file");
    expect(entry.unixMode).toBe(0o600);
    expect(verdict.accepted).toBe(true);
  });

  test("REG-WU-032-RC-041-041-b: a permission-only mode on a trailing-slash name is a directory", () => {
    const { entry } = entryFor({ name: "dir/", unixMode: 0o755 });
    expect(entry.kind).toBe("directory");
    expect(entry.unixMode).toBe(0o755);
  });

  test("REG-WU-032-RC-041-041-c: a symlink mode is still a symlink and still held", () => {
    const { entry, verdict } = entryFor({ name: "link", content: "/etc/passwd", unixMode: UNIX_SYMLINK, stored: true });
    expect(entry.kind).toBe("symlink");
    expect(verdict.holds.map((hold) => hold.code)).toEqual(["archive.entry_symlink"]);
  });

  test("REG-WU-032-RC-041-041-d: an unrecognized non-zero type value stays unknown and held", () => {
    const { entry, verdict } = entryFor({ name: "odd", content: "x", unixMode: 0o170644 });
    expect(entry.kind).toBe("unknown");
    expect(verdict.holds.map((hold) => hold.code)).toEqual(["archive.entry_kind_unknown"]);
  });

  test("REG-WU-032-RC-041-041-e: a CPython writestr-style archive is expanded, extracted and rewritten", () => {
    const specs: ZipMemberSpec[] = [{ name: "report.txt", content: "made by zipfile.writestr\n", unixMode: 0o600 }];
    const sourceRoot = tmp();
    writeRawZip(path.join(sourceRoot, "py.zip"), specs);
    const observation = acquireLocalSource({ path: sourceRoot, scratchParent: tmp() });
    try {
      expect(observation.archives[0].expanded).toBe(true);
      expect(observation.virtualArtifacts.map((member) => member.virtualSourcePath)).toEqual(["py.zip!/report.txt"]);
    } finally {
      observation.dispose();
    }

    const expanded = expandArchivesUnderRoot(sourceRoot, { dryRun: false, verbose: false });
    expect(expanded.archives[0].heldReason ?? null).toBeNull();
    expect(fs.readFileSync(path.join(extractDirFor(path.join(sourceRoot, "py.zip")), "report.txt"), "utf8"))
      .toBe("made by zipfile.writestr\n");

    const rewriteRoot = tmp();
    const rewritePath = path.join(rewriteRoot, "py.zip");
    writeRawZip(rewritePath, specs);
    expect(upsertArchiveRootMeta(rewritePath, "schema: l9.meta/v3\ntitle: injected\n")).toEqual({ rewritten: true });
  });

  test("REG-WU-032-RC-041-041-f: a Unix entry with no mode at all keeps the name rule", () => {
    expect(entryFor({ name: "plain.txt", content: "x", unixMode: 0 }).entry).toMatchObject({ kind: "file", unixMode: null });
    expect(entryFor({ name: "folder/", unixMode: 0 }).entry).toMatchObject({ kind: "directory", unixMode: null });
  });
});
