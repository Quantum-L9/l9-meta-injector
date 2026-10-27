// archive_rewrite_fidelity.test.ts — WU-031: the inventory archive rewrite (ADR-049)
// changes only the root .l9meta.yaml member. Kept ZIP central records are copied
// verbatim (only the local-header offset is patched), the EOCD comment is carried
// through, ustar prefix+name is the TAR member path, and root-meta identity is the
// admission identity (canonical path under the collision fold).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { describe, expect, test } from "vitest";
import { canonicalMemberPath, memberCollisionKey, preflightArchive } from "../src/archive_preflight";
import { inventoryTree } from "../src/inventory";
import { peekArchiveRootMeta, upsertArchiveRootMeta } from "../src/inventory_archive_member";
import { DEFAULT_LOCAL_ARCHIVE_POLICY } from "../src/local_archive_policy";
import { peekTarRootMeta, readTarArchive } from "../src/tar_reader";
import { readZipCentralDirectory, streamZipMember } from "../src/zip_reader";
import { peekZipRootMeta } from "../src/zip_writer";
import { tarBytes, tarEntry } from "./helpers/tar_fixtures";
import { writeRawZip } from "./helpers/zip_fixtures";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-rewrite-fidelity-"));
}

const YAML = "schema: l9.meta/v3\ntitle: injected\n";

interface RawCentral {
  record: Buffer;
  nameBytes: Buffer;
  localNameBytes: Buffer;
  localHeaderOffset: number;
}

/** Independent raw ZIP parse: central records as bytes plus each member's local name. */
function parseZip(bytes: Buffer): { centrals: RawCentral[]; comment: Buffer } {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no EOCD");
  const count = bytes.readUInt16LE(eocd + 10);
  let cursor = bytes.readUInt32LE(eocd + 16);
  const centrals: RawCentral[] = [];
  for (let k = 0; k < count; k++) {
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const length = 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    const record = Buffer.from(bytes.subarray(cursor, cursor + length));
    const localHeaderOffset = record.readUInt32LE(42);
    const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    centrals.push({
      record,
      nameBytes: record.subarray(46, 46 + nameLength),
      localNameBytes: Buffer.from(bytes.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength)),
      localHeaderOffset,
    });
    cursor += length;
  }
  return { centrals, comment: Buffer.from(bytes.subarray(eocd + 22)) };
}

function maskOffset(record: Buffer): Buffer {
  const copy = Buffer.from(record);
  copy.fill(0, 42, 46);
  return copy;
}

function admits(abs: string): boolean {
  const verdict = preflightArchive({
    directory: readZipCentralDirectory(abs),
    policy: DEFAULT_LOCAL_ARCHIVE_POLICY,
    depth: 0,
    archiveCompressedBytes: fs.statSync(abs).size,
  });
  return verdict.accepted;
}

function memberBytes(abs: string, name: string): { data: Buffer; crcMatches: boolean } {
  const entry = readZipCentralDirectory(abs).entries.find((e) => e.name === name);
  if (!entry) throw new Error(`no member ${name}`);
  const chunks: Buffer[] = [];
  streamZipMember(abs, entry, { maxUncompressedBytes: 1 << 20 }, (chunk) => {
    chunks.push(Buffer.from(chunk));
  });
  const data = Buffer.concat(chunks);
  return { data, crcMatches: (zlib.crc32(data) >>> 0) === entry.crc32 };
}

function rootMetaCount(names: string[]): number {
  return names.filter((n) => memberCollisionKey(canonicalMemberPath(n)) === ".l9meta.yaml").length;
}

const CP437_NAME = Buffer.from([0x63, 0x61, 0x66, 0x82, 0x2e, 0x74, 0x78, 0x74]);
const UT_EXTRA = Buffer.from([0x55, 0x54, 0x05, 0x00, 0x01, 0xda, 0x95, 0x93, 0x60]);

describe("WU-031 RC-037 ZIP rewrite copies original central records", () => {
  test("REG-WU-031-RC-037-037-a: invalid-UTF-8 central name bytes survive the rewrite", () => {
    const abs = path.join(tmp(), "legacy.zip");
    writeRawZip(abs, [
      { name: "caf?.txt", nameBytes: CP437_NAME, utf8Flag: false, content: "legacy\n" },
      { name: "plain.txt", content: "plain\n" },
    ]);
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: true });
    const { centrals } = parseZip(fs.readFileSync(abs));
    const kept = centrals.find((c) => c.nameBytes.equals(CP437_NAME));
    expect(kept, "kept member keeps its original central name bytes").toBeDefined();
    expect(kept!.nameBytes.toString("hex")).toBe("636166822e747874");
    expect(kept!.localNameBytes.equals(kept!.nameBytes)).toBe(true);
  });

  test("REG-WU-031-RC-037-037-b: comments, central extra, internal attributes and version-needed are preserved", () => {
    const abs = path.join(tmp(), "meta.zip");
    writeRawZip(
      abs,
      [
        {
          name: "kept.txt",
          content: "kept\n",
          stored: true,
          comment: "per-member comment",
          centralExtra: UT_EXTRA,
          internalAttributes: 1,
          versionNeeded: 10,
        },
      ],
      { comment: "Archive comment written by the user" },
    );
    const before = parseZip(fs.readFileSync(abs));
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: true });
    const after = parseZip(fs.readFileSync(abs));
    const original = before.centrals[0]!;
    const rewritten = after.centrals.find((c) => c.nameBytes.equals(original.nameBytes))!;
    expect(maskOffset(rewritten.record).equals(maskOffset(original.record))).toBe(true);
    expect(after.comment.toString("utf8")).toBe("Archive comment written by the user");
    expect(after.comment.equals(before.comment)).toBe(true);
  });

  test("REG-WU-031-RC-037-037-c: valid UTF-8 names with and without bit 11 stay byte-identical", () => {
    const abs = path.join(tmp(), "utf8.zip");
    writeRawZip(abs, [
      { name: "café.txt", content: "flagged\n" },
      { name: "naïve.txt", utf8Flag: false, content: "unflagged\n" },
    ]);
    const before = parseZip(fs.readFileSync(abs));
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: true });
    const after = parseZip(fs.readFileSync(abs));
    for (const original of before.centrals) {
      const kept = after.centrals.find((c) => c.nameBytes.equals(original.nameBytes));
      expect(kept).toBeDefined();
      expect(kept!.localNameBytes.equals(original.nameBytes)).toBe(true);
    }
  });

  test("REG-WU-031-RC-037-037-d: a data-descriptor member still receives a root meta member with intact data", () => {
    const root = tmp();
    const abs = path.join(root, "dd.zip");
    const data = Buffer.from("hello\n");
    const crc = zlib.crc32(data) >>> 0;
    const nameBytes = Buffer.from("readme.txt", "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0008, 6);
    local.writeUInt16LE(nameBytes.length, 26);
    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc, 4);
    desc.writeUInt32LE(data.length, 8);
    desc.writeUInt32LE(data.length, 12);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0008, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    const localBlob = Buffer.concat([local, nameBytes, data, desc]);
    const cd = Buffer.concat([central, nameBytes]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(localBlob.length, 16);
    fs.writeFileSync(abs, Buffer.concat([localBlob, cd, eocd]));
    const result = inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false, now: "2026-09-11T18:00:00.000Z" });
    expect(peekZipRootMeta(abs)).toContain("2026-09-11T18:00:00.000Z");
    const unknowns = result.records.find((row) => row.file_name === "dd.zip")?.unknowns ?? [];
    expect(unknowns.some((u) => u.startsWith("archive_rewrite_held"))).toBe(false);
    const kept = memberBytes(abs, "readme.txt");
    expect(kept.data.equals(data)).toBe(true);
    expect(kept.crcMatches).toBe(true);
  });

  test("REG-WU-031-RC-037-037-e: a Zip64-placeholder local-header offset holds archive.zip64 and leaves the file untouched", () => {
    const abs = path.join(tmp(), "placeholder.zip");
    writeRawZip(abs, [{ name: "big.txt", content: "not actually big\n", zip64: true }]);
    const before = fs.readFileSync(abs);
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: false, hold: "archive.zip64" });
    expect(fs.readFileSync(abs).equals(before)).toBe(true);
  });

  test("REG-WU-031-RC-037-037-f: a rewritten archive admits, converges, and keeps local/central names in agreement", () => {
    const root = tmp();
    const abs = path.join(root, "pack.zip");
    writeRawZip(
      abs,
      [
        { name: "caf?.txt", nameBytes: CP437_NAME, utf8Flag: false, content: "legacy\n" },
        { name: "kept.txt", content: "kept\n", comment: "member comment", centralExtra: UT_EXTRA, internalAttributes: 1 },
      ],
      { comment: "archive comment" },
    );
    const now = "2026-09-11T12:00:00.000Z";
    const run = (n: number): ReturnType<typeof inventoryTree> =>
      inventoryTree({ root, outDir: path.join(tmp(), `out${n}`), folderSidecars: false, now });
    const first = run(1);
    const firstUnknowns = first.records.find((r) => r.file_name === "pack.zip")?.unknowns ?? [];
    expect(firstUnknowns.some((u) => u.startsWith("archive_rewrite_held"))).toBe(false);
    expect(admits(abs)).toBe(true);
    for (const central of parseZip(fs.readFileSync(abs)).centrals) {
      expect(central.localNameBytes.equals(central.nameBytes)).toBe(true);
    }
    run(2);
    const second = fs.readFileSync(abs);
    run(3);
    expect(fs.readFileSync(abs).equals(second)).toBe(true);
    expect(parseZip(second).comment.toString("utf8")).toBe("archive comment");
  });

  test("REG-WU-031-RC-037-037-g: an existing root meta as the last member with a comment is replaced and kept offsets are patched", () => {
    const abs = path.join(tmp(), "last.zip");
    writeRawZip(abs, [
      { name: "one.txt", content: "one\n" },
      { name: "two.txt", content: "two two\n", stored: true },
      { name: ".l9meta.yaml", content: "title: old\n", comment: "old meta comment" },
    ]);
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: true });
    const names = readZipCentralDirectory(abs).entries.map((e) => e.name);
    expect(names).toEqual(["one.txt", "two.txt", ".l9meta.yaml"]);
    for (const [name, text] of [["one.txt", "one\n"], ["two.txt", "two two\n"], [".l9meta.yaml", YAML]] as const) {
      const member = memberBytes(abs, name);
      expect(member.data.toString("utf8")).toBe(text);
      expect(member.crcMatches).toBe(true);
    }
  });
});

describe("WU-031 RC-039 TAR member path is ustar prefix + name", () => {
  const nestedPrefix = `project-${"d".repeat(110)}`;

  test("REG-WU-031-RC-039-039-a: a nested long-path .l9meta.yaml is never peeked and survives the rewrite", () => {
    const abs = path.join(tmp(), "nested.tar");
    const nested = tarEntry({ name: ".l9meta.yaml", prefix: nestedPrefix, content: "title: nested user metadata\n" });
    const bytes = Buffer.concat([tarEntry({ name: "keep.txt", content: "keep\n" }), nested, Buffer.alloc(1024)]);
    fs.writeFileSync(abs, bytes);
    expect(peekTarRootMeta(bytes)).toBeNull();
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: true });
    const read = readTarArchive(fs.readFileSync(abs));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.members.map((m) => m.name)).toEqual(["keep.txt", `${nestedPrefix}/.l9meta.yaml`, ".l9meta.yaml"]);
    expect(read.members[1]!.rawRecord.equals(nested)).toBe(true);
    expect(read.members[2]!.content.toString("utf8")).toBe(YAML);
  });

  test("REG-WU-031-RC-039-039-b: traversal carried in the prefix holds archive.path_traversal", () => {
    const abs = path.join(tmp(), "traversal.tar");
    const bytes = tarBytes([{ name: "evil.txt", prefix: `../${"b".repeat(110)}`, content: "x" }]);
    fs.writeFileSync(abs, bytes);
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: false, hold: "archive.path_traversal" });
    expect(fs.readFileSync(abs).equals(bytes)).toBe(true);
  });

  test("REG-WU-031-RC-039-039-c: equal name fields under different prefixes are not duplicates", () => {
    const abs = path.join(tmp(), "prefixes.tar");
    fs.writeFileSync(abs, tarBytes([
      { name: "x.txt", prefix: "a".repeat(120), content: "a" },
      { name: "x.txt", prefix: "b".repeat(120), content: "b" },
    ]));
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: true });
  });

  test("REG-WU-031-RC-039-039-d: an absolute prefix holds archive.path_absolute", () => {
    const abs = path.join(tmp(), "absolute.tar");
    const bytes = tarBytes([{ name: "passwd", prefix: `/${"e".repeat(110)}`, content: "x" }]);
    fs.writeFileSync(abs, bytes);
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: false, hold: "archive.path_absolute" });
    expect(fs.readFileSync(abs).equals(bytes)).toBe(true);
  });

  test("REG-WU-031-RC-039-039-e: a GNU-magic header never splices bytes at offset 345 into the name", () => {
    const atime = Buffer.from("14652000000\0", "latin1");
    const read = readTarArchive(tarBytes([{ name: "gnu.txt", gnuMagic: true, prefix: atime, content: "g" }]));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.members.map((m) => m.name)).toEqual(["gnu.txt"]);
  });

  test("REG-WU-031-RC-039-039-f: zero-prefix fixtures keep their names and dispositions", () => {
    const read = readTarArchive(tarBytes([
      { name: "docs/", type: "5", mode: 0o755 },
      { name: "docs/a.md", content: "# A\n" },
    ]));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.members.map((m) => m.name)).toEqual(["docs/", "docs/a.md"]);
    const abs = path.join(tmp(), "dup.tar");
    fs.writeFileSync(abs, tarBytes([{ name: "same.txt", content: "one" }, { name: "same.txt", content: "two" }]));
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: false, hold: "archive.duplicate_member" });
  });

  test("REG-WU-031-RC-039-039-g: a full-width prefix and name compose a 256-character path", () => {
    const read = readTarArchive(tarBytes([{ name: "n".repeat(100), prefix: "p".repeat(155), content: "x" }]));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.members[0]!.name).toBe(`${"p".repeat(155)}/${"n".repeat(100)}`);
  });
});

describe("WU-031 RC-042 root-meta identity is the admission identity", () => {
  test("REG-WU-031-RC-042-042-a: a './/.l9meta.yaml' ZIP member is peeked and replaced, and the rewrite converges", () => {
    const abs = path.join(tmp(), "dotslash.zip");
    writeRawZip(abs, [
      { name: "keep.txt", content: "keep\n" },
      { name: ".//.l9meta.yaml", content: "title: user meta\n" },
    ]);
    expect(peekArchiveRootMeta(abs)).toBe("title: user meta\n");
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: true });
    expect(rootMetaCount(readZipCentralDirectory(abs).entries.map((e) => e.name))).toBe(1);
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: true });
  });

  test("REG-WU-031-RC-042-042-b: './/./.l9meta.yaml' converges in ZIP and TAR to exactly one root meta", () => {
    const zipAbs = path.join(tmp(), "dotdot.zip");
    writeRawZip(zipAbs, [
      { name: "keep.txt", content: "keep\n" },
      { name: ".//./.l9meta.yaml", content: "title: user meta\n" },
    ]);
    expect(peekArchiveRootMeta(zipAbs)).toBe("title: user meta\n");
    expect(upsertArchiveRootMeta(zipAbs, YAML)).toEqual({ rewritten: true });
    expect(rootMetaCount(readZipCentralDirectory(zipAbs).entries.map((e) => e.name))).toBe(1);
    expect(upsertArchiveRootMeta(zipAbs, YAML)).toEqual({ rewritten: true });

    const tarAbs = path.join(tmp(), "dotdot.tar");
    fs.writeFileSync(tarAbs, tarBytes([
      { name: "keep.txt", content: "keep\n" },
      { name: ".//./.l9meta.yaml", content: "title: user meta\n" },
    ]));
    expect(peekArchiveRootMeta(tarAbs)).toBe("title: user meta\n");
    expect(upsertArchiveRootMeta(tarAbs, YAML)).toEqual({ rewritten: true });
    expect(upsertArchiveRootMeta(tarAbs, YAML)).toEqual({ rewritten: true });
    const read = readTarArchive(fs.readFileSync(tarAbs));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(rootMetaCount(read.members.map((m) => m.name))).toBe(1);
  });

  test("REG-WU-031-RC-042-042-c: a case-variant '.L9META.yaml' is replaced and the second upsert is not held", () => {
    const abs = path.join(tmp(), "case.zip");
    writeRawZip(abs, [
      { name: "keep.txt", content: "keep\n" },
      { name: ".L9META.yaml", content: "title: shouty\n" },
    ]);
    expect(peekArchiveRootMeta(abs)).toBe("title: shouty\n");
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: true });
    expect(readZipCentralDirectory(abs).entries.map((e) => e.name)).toEqual(["keep.txt", ".l9meta.yaml"]);
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: true });
  });

  test("REG-WU-031-RC-042-042-d: nested metas are kept and never peeked; a '..' spelling is held by admission", () => {
    const nestedAbs = path.join(tmp(), "nested.zip");
    writeRawZip(nestedAbs, [
      { name: "keep.txt", content: "keep\n" },
      { name: "docs/.l9meta.yaml", content: "title: nested\n" },
    ]);
    expect(peekArchiveRootMeta(nestedAbs)).toBeNull();
    expect(upsertArchiveRootMeta(nestedAbs, YAML)).toEqual({ rewritten: true });
    expect(readZipCentralDirectory(nestedAbs).entries.map((e) => e.name)).toEqual([
      "keep.txt",
      "docs/.l9meta.yaml",
      ".l9meta.yaml",
    ]);

    const traversalAbs = path.join(tmp(), "dotdot.zip");
    writeRawZip(traversalAbs, [
      { name: "keep.txt", content: "keep\n" },
      { name: "x/../.l9meta.yaml", content: "title: sneaky\n" },
    ]);
    expect(peekArchiveRootMeta(traversalAbs)).toBeNull();
    expect(upsertArchiveRootMeta(traversalAbs, YAML)).toEqual({ rewritten: false, hold: "archive.path_traversal" });
  });

  test("REG-WU-031-RC-042-042-e: a legacy root 'l9meta.yaml' is peeked and replaced by '.l9meta.yaml'", () => {
    const abs = path.join(tmp(), "legacy.zip");
    writeRawZip(abs, [
      { name: "keep.txt", content: "keep\n" },
      { name: "l9meta.yaml", content: "title: legacy\n" },
    ]);
    expect(peekArchiveRootMeta(abs)).toBe("title: legacy\n");
    expect(upsertArchiveRootMeta(abs, YAML)).toEqual({ rewritten: true });
    expect(readZipCentralDirectory(abs).entries.map((e) => e.name)).toEqual(["keep.txt", ".l9meta.yaml"]);
  });

  test("REG-WU-031-RC-042-042-f: TAR duplicate detection uses the canonical key, matching ZIP preflight", () => {
    const tarAbs = path.join(tmp(), "dup.tar");
    const bytes = tarBytes([{ name: "a.txt", content: "one" }, { name: "./a.txt", content: "two" }]);
    fs.writeFileSync(tarAbs, bytes);
    expect(upsertArchiveRootMeta(tarAbs, YAML)).toEqual({ rewritten: false, hold: "archive.duplicate_member" });
    expect(fs.readFileSync(tarAbs).equals(bytes)).toBe(true);

    // Interior '.' and empty segments are the same member for ZIP preflight too.
    const interiorAbs = path.join(tmp(), "interior.tar");
    const interior = tarBytes([{ name: "docs/a.txt", content: "one" }, { name: "docs/.//a.txt", content: "two" }]);
    fs.writeFileSync(interiorAbs, interior);
    expect(upsertArchiveRootMeta(interiorAbs, YAML)).toEqual({ rewritten: false, hold: "archive.duplicate_member" });
    expect(fs.readFileSync(interiorAbs).equals(interior)).toBe(true);

    const zipAbs = path.join(tmp(), "dup.zip");
    writeRawZip(zipAbs, [{ name: "a.txt", content: "one" }, { name: "./a.txt", content: "two" }]);
    expect(upsertArchiveRootMeta(zipAbs, YAML)).toEqual({ rewritten: false, hold: "archive.duplicate_member" });
  });
});
