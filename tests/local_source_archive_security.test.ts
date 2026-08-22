// local_source_archive_security.test.ts — the adversarial archive matrix.
//
// Every case here asserts the same two outcomes: the archive is held (no member
// is claimed as observed), and nothing was written outside tool-owned scratch.
// The second assertion is the one that matters — a reader that refuses a
// traversal path in its return value but has already written the file has not
// prevented anything.
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { acquireLocalSource } from "../src/local_source";
import { canonicalMemberPath, memberCollisionKey, preflightArchive } from "../src/archive_preflight";
import { DEFAULT_LOCAL_ARCHIVE_POLICY, resolveLocalArchivePolicy } from "../src/local_archive_policy";
import { readZipCentralDirectory } from "../src/zip_reader";
import { UNIX_FIFO, UNIX_SYMLINK, treeSnapshot, writeRawZip } from "./helpers/zip_fixtures";
import type { ZipMemberSpec } from "./helpers/zip_fixtures";
import type { LocalArchivePolicy } from "../src/local_archive_policy";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-archive-sec-"));
}

interface HeldOutcome {
  expanded: boolean;
  holdCodes: string[];
  memberCount: number;
  claimedMembers: string[];
  sourceUnchanged: boolean;
  parentUnchanged: boolean;
}

/** Observe one archive and report both its verdict and the filesystem effect. */
function observeArchive(members: ZipMemberSpec[], policy?: Partial<LocalArchivePolicy>): HeldOutcome {
  const parent = tmp();
  const root = path.join(parent, "src");
  fs.mkdirSync(root, { recursive: true });
  writeRawZip(path.join(root, "Case.zip"), members);
  const beforeSource = treeSnapshot(root);
  const beforeParent = treeSnapshot(parent);

  const observation = acquireLocalSource({
    path: path.join(root, "Case.zip"),
    ...(policy ? { archivePolicy: policy } : {}),
  });
  try {
    const archive = observation.archives[0];
    return {
      expanded: archive.expanded,
      holdCodes: archive.holds.map((hold) => hold.code),
      memberCount: archive.memberCount,
      claimedMembers: observation.virtualArtifacts.map((member) => member.virtualSourcePath),
      sourceUnchanged: JSON.stringify(treeSnapshot(root)) === JSON.stringify(beforeSource),
      parentUnchanged: JSON.stringify(treeSnapshot(parent)) === JSON.stringify(beforeParent),
    };
  } finally {
    observation.dispose();
  }
}

function expectHeld(outcome: HeldOutcome, code: string): void {
  expect(outcome.expanded).toBe(false);
  expect(outcome.holdCodes).toContain(code);
  expect(outcome.memberCount).toBe(0);
  expect(outcome.claimedMembers).toEqual([]);
  expect(outcome.sourceUnchanged).toBe(true);
  expect(outcome.parentUnchanged).toBe(true);
}

describe("archive preflight — hostile member paths", () => {
  test("a parent-traversal path is rejected", () => {
    expectHeld(observeArchive([{ name: "../escape.txt", content: "no" }]), "archive.path_traversal");
  });

  test("a traversal buried mid-path is rejected", () => {
    expectHeld(observeArchive([{ name: "docs/../../escape.txt", content: "no" }]), "archive.path_traversal");
  });

  test("a POSIX-absolute path is rejected", () => {
    expectHeld(observeArchive([{ name: "/absolute.txt", content: "no" }]), "archive.path_absolute");
  });

  test("a Windows drive-absolute path is rejected", () => {
    expectHeld(observeArchive([{ name: "C:\\escape.txt", content: "no" }]), "archive.path_drive_absolute");
  });

  test("a UNC path is rejected", () => {
    expectHeld(observeArchive([{ name: "\\\\server\\share\\x.txt", content: "no" }]), "archive.path_unc");
  });

  test("a backslash traversal is rejected rather than treated as a filename", () => {
    // On a POSIX host a backslash is an ordinary character; on Windows it is a
    // separator. Normalizing first means the same archive is judged the same way.
    expectHeld(observeArchive([{ name: "..\\escape.txt", content: "no" }]), "archive.path_traversal");
  });

  test("an embedded NUL in a member path is rejected", () => {
    expectHeld(observeArchive([{ name: "ok\u0000evil.txt", content: "no" }]), "archive.path_nul");
  });

  test("an over-long member path is rejected", () => {
    const long = `${"a/".repeat(40)}file.txt`;
    expectHeld(observeArchive([{ name: long, content: "x" }], { maxPathLength: 16 }), "archive.path_too_long");
  });
});

describe("archive preflight — entry kinds and encryption", () => {
  test("a symlink member is rejected", () => {
    expectHeld(
      observeArchive([{ name: "link", content: "/etc/passwd", unixMode: UNIX_SYMLINK, stored: true }]),
      "archive.entry_symlink",
    );
  });

  test("a FIFO member is rejected", () => {
    expectHeld(observeArchive([{ name: "pipe", unixMode: UNIX_FIFO, stored: true }]), "archive.entry_special");
  });

  test("an encrypted member is rejected", () => {
    expectHeld(observeArchive([{ name: "secret.md", content: "x", encrypted: true }]), "archive.member_encrypted");
  });

  test("an unsupported compression method is rejected", () => {
    // 9 is Deflate64: a real method this reader deliberately does not implement.
    expectHeld(
      observeArchive([{ name: "big.md", content: "x", compressionMethod: 9 }]),
      "archive.compression_unsupported",
    );
  });
});

describe("archive preflight — collisions", () => {
  test("an exactly duplicated member path is rejected", () => {
    expectHeld(
      observeArchive([{ name: "a.txt", content: "first" }, { name: "a.txt", content: "second" }]),
      "archive.duplicate_member",
    );
  });

  test("a case-only collision is rejected", () => {
    expectHeld(
      observeArchive([{ name: "A.txt", content: "upper" }, { name: "a.txt", content: "lower" }]),
      "archive.case_collision",
    );
  });

  test("a Unicode normalization collision is rejected", () => {
    // Precomposed U+00E9 vs. `e` + U+0301: the same filename on macOS.
    expectHeld(
      observeArchive([
        { name: "caf\u00e9.md", content: "precomposed" },
        { name: "cafe\u0301.md", content: "decomposed" },
      ]),
      "archive.unicode_collision",
    );
  });

  test("a directory entry that shadows a file is rejected", () => {
    expectHeld(
      observeArchive([{ name: "docs/", content: "" }, { name: "docs", content: "file" }]),
      "archive.duplicate_member",
    );
  });

  test("an ordinary directory entry alongside its children is accepted", () => {
    const outcome = observeArchive([
      { name: "docs/", content: "" },
      { name: "docs/a.md", content: "# A\n" },
    ]);
    expect(outcome.expanded).toBe(true);
    expect(outcome.claimedMembers).toEqual(["Case.zip!/docs/a.md"]);
  });

  test("collision keys fold case and Unicode but keep distinct paths distinct", () => {
    expect(memberCollisionKey("A.txt")).toBe(memberCollisionKey("a.txt"));
    expect(memberCollisionKey("caf\u00e9.md")).toBe(memberCollisionKey("cafe\u0301.md"));
    expect(memberCollisionKey("docs/a.md")).not.toBe(memberCollisionKey("docs"));
    expect(canonicalMemberPath("docs//a.md/")).toBe("docs/a.md");
  });
});

describe("archive budgets", () => {
  test("too many members is refused before extraction", () => {
    const members = Array.from({ length: 12 }, (_, index) => ({
      name: `f${index}.txt`,
      content: "x",
    }));
    expectHeld(observeArchive(members, { maxMemberCount: 5 }), "archive.member_count_exceeded");
  });

  test("a single oversized member is refused", () => {
    expectHeld(
      observeArchive([{ name: "big.txt", content: "x".repeat(4096) }], {
        maxSingleMemberUncompressedBytes: 64,
        maxCompressionRatio: 100000,
      }),
      "archive.member_too_large",
    );
  });

  test("an oversized total expansion is refused", () => {
    expectHeld(
      observeArchive(
        [{ name: "a.txt", content: "x".repeat(512) }, { name: "b.txt", content: "y".repeat(512) }],
        { maxTotalUncompressedBytesPerArchive: 600, maxCompressionRatio: 100000 },
      ),
      "archive.total_uncompressed_exceeded",
    );
  });

  test("an excessive compression ratio is refused", () => {
    // 512 KiB of a single repeated byte deflates to a few hundred bytes.
    expectHeld(
      observeArchive([{ name: "bomb.txt", content: "A".repeat(512 * 1024) }], { maxCompressionRatio: 10 }),
      "archive.compression_ratio_exceeded",
    );
  });

  test("a declared size that understates the real expansion is caught at runtime", () => {
    // The central directory claims 10 bytes; the deflate stream produces 256 KiB.
    // A metadata-only check would authorize this archive.
    const outcome = observeArchive(
      [{ name: "liar.txt", content: "A".repeat(256 * 1024), declaredUncompressedSize: 10 }],
      { maxSingleMemberUncompressedBytes: 4096, maxCompressionRatio: 100000 },
    );
    expect(outcome.expanded).toBe(false);
    expect(outcome.claimedMembers).toEqual([]);
    expect(outcome.holdCodes).toContain("archive.extracted_bytes_exceeded");
    expect(outcome.sourceUnchanged).toBe(true);
    expect(outcome.parentUnchanged).toBe(true);
  });

  test("the session expansion budget bounds a tree of many archives", () => {
    const root = tmp();
    for (let i = 0; i < 4; i++) {
      writeRawZip(path.join(root, `pack${i}.zip`), [{ name: "a.txt", content: "x".repeat(400) }]);
    }
    const before = treeSnapshot(root);

    const observation = acquireLocalSource({
      path: root,
      archivePolicy: { maxTotalUncompressedBytesPerSession: 900, maxCompressionRatio: 100000 },
    });
    try {
      const expanded = observation.archives.filter((archive) => archive.expanded);
      const held = observation.archives.filter((archive) => !archive.expanded);
      expect(expanded).toHaveLength(2);
      expect(held).toHaveLength(2);
      expect(held.every((archive) =>
        archive.holds.some((hold) => hold.code === "archive.session_budget_exceeded"))).toBe(true);
      expect(observation.virtualArtifacts).toHaveLength(2);
      expect(treeSnapshot(root)).toEqual(before);
    } finally {
      observation.dispose();
    }
  });

  test("nested depth beyond the limit is not expanded", () => {
    const root = tmp();
    const staging = tmp();
    writeRawZip(path.join(staging, "inner.zip"), [{ name: "deep.md", content: "# Deep\n" }]);
    writeRawZip(path.join(root, "outer.zip"), [
      { name: "inner.zip", content: fs.readFileSync(path.join(staging, "inner.zip")), stored: true },
    ]);

    const observation = acquireLocalSource({ path: root, archivePolicy: { maxNestedDepth: 0 } });
    try {
      expect(observation.virtualArtifacts.map((member) => member.virtualSourcePath))
        .toEqual(["outer.zip!/inner.zip"]);
      expect(observation.diagnostics.map((diagnostic) => diagnostic.code))
        .toContain("archive.nesting_depth_exceeded");
    } finally {
      observation.dispose();
    }
  });

  test("defaults are conservative and explicitly versioned", () => {
    expect(DEFAULT_LOCAL_ARCHIVE_POLICY.version).toBe("1");
    expect(resolveLocalArchivePolicy({ maxMemberCount: 3 })).toMatchObject({
      maxMemberCount: 3,
      version: "1",
      maxNestedDepth: DEFAULT_LOCAL_ARCHIVE_POLICY.maxNestedDepth,
    });
    // A caller override never silently loosens an unrelated limit.
    expect(resolveLocalArchivePolicy({ maxMemberCount: 3 }).maxCompressionRatio)
      .toBe(DEFAULT_LOCAL_ARCHIVE_POLICY.maxCompressionRatio);
  });
});

describe("archive reader", () => {
  test("central-directory metadata is read without a subprocess", () => {
    const root = tmp();
    writeRawZip(path.join(root, "meta.zip"), [
      { name: "stored.txt", content: "plain", stored: true },
      { name: "deflated.md", content: "# Deflated\n".repeat(40) },
      { name: "dir/", content: "" },
    ]);
    const directory = readZipCentralDirectory(path.join(root, "meta.zip"));
    expect(directory.declaredEntryCount).toBe(3);
    expect(directory.entries.map((entry) => [entry.name, entry.kind, entry.compressionMethod])).toEqual([
      ["stored.txt", "file", 0],
      ["deflated.md", "file", 8],
      ["dir/", "directory", 0],
    ]);
  });

  test("a truncated archive is held rather than partially read", () => {
    const parent = tmp();
    const root = path.join(parent, "src");
    fs.mkdirSync(root, { recursive: true });
    const archivePath = path.join(root, "Case.zip");
    writeRawZip(archivePath, [{ name: "a.md", content: "# A\n" }]);
    const bytes = fs.readFileSync(archivePath);
    fs.writeFileSync(archivePath, bytes.subarray(0, Math.floor(bytes.length / 2)));
    const before = treeSnapshot(root);

    const observation = acquireLocalSource({ path: archivePath });
    try {
      expect(observation.archives[0].expanded).toBe(false);
      expect(observation.archives[0].holds.map((hold) => hold.code)).toContain("archive.format_unreadable");
      expect(observation.virtualArtifacts).toEqual([]);
      expect(treeSnapshot(root)).toEqual(before);
    } finally {
      observation.dispose();
    }
  });

  test("preflight is a pure function of the central directory", () => {
    const root = tmp();
    writeRawZip(path.join(root, "pure.zip"), [{ name: "../x", content: "no" }]);
    const directory = readZipCentralDirectory(path.join(root, "pure.zip"));
    const before = treeSnapshot(root);
    const result = preflightArchive({
      directory,
      policy: resolveLocalArchivePolicy(),
      depth: 0,
      archiveCompressedBytes: 200,
    });
    expect(result.accepted).toBe(false);
    expect(treeSnapshot(root)).toEqual(before);
  });
});

describe("unsupported archive formats", () => {
  test("a tar.gz is classified, hashed, and never guessed at", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "bundle.tgz"), Buffer.from([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3]));

    const observation = acquireLocalSource({ path: root });
    try {
      const record = observation.inventory.records.find((r) => r.relative_path === "bundle.tgz");
      expect(record?.artifact_type).toBe("archive");
      expect(record?.content_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(observation.diagnostics.map((d) => d.code)).toContain("archive.format_not_expanded");
      expect(observation.virtualArtifacts).toEqual([]);
    } finally {
      observation.dispose();
    }
  });

  test("--no-expand-archives hashes the archive and observes no member", () => {
    const root = tmp();
    writeRawZip(path.join(root, "Bundle.zip"), [{ name: "a.md", content: "# A\n" }]);

    const observation = acquireLocalSource({ path: root, expandArchives: false });
    try {
      expect(observation.virtualArtifacts).toEqual([]);
      expect(observation.archives).toEqual([]);
      expect(observation.diagnostics.map((d) => d.code))
        .toContain("local-source.archive_expansion_disabled");
      const record = observation.inventory.records.find((r) => r.relative_path === "Bundle.zip");
      expect(record?.content_hash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      observation.dispose();
    }
  });
});

describe("audit regressions", () => {
  test("a '.' segment cannot alias another member's staged bytes", () => {
    // `./a.txt` and `a.txt` are distinct names that resolve to one staged file.
    // Without canonicalizing away the `.`, both were accepted as separate members
    // and the second overwrote the first, so the first member's recorded digest
    // stopped describing the bytes any later read would see.
    expect(canonicalMemberPath("./a.txt")).toBe("a.txt");
    expect(canonicalMemberPath("docs/./b.md")).toBe("docs/b.md");
    expect(canonicalMemberPath("/absolute.txt")).toBe("/absolute.txt");
    expect(canonicalMemberPath("../escape.txt")).toBe("../escape.txt");

    expectHeld(
      observeArchive([
        { name: "a.txt", content: "first" },
        { name: "./a.txt", content: "second" },
      ]),
      "archive.duplicate_member",
    );
  });

  test("a member whose bytes are staged is the member whose digest was recorded", () => {
    const parent = tmp();
    const root = path.join(parent, "src");
    fs.mkdirSync(root, { recursive: true });
    writeRawZip(path.join(root, "Case.zip"), [
      { name: "one.txt", content: "one" },
      { name: "docs/two.txt", content: "two" },
    ]);
    const observation = acquireLocalSource({ path: path.join(root, "Case.zip") });
    try {
      for (const member of observation.virtualArtifacts) {
        const staged = fs.readFileSync(member.stagedPath);
        const digest = `sha256:${createHash("sha256").update(staged).digest("hex")}`;
        expect(digest).toBe(member.contentHash);
        expect(staged).toHaveLength(member.sizeBytes);
      }
    } finally {
      observation.dispose();
    }
  });

  test("an exhausted allowance is reported as a budget refusal, not a malformed archive", () => {
    // Two archives with identical byte counts; the session allowance covers the
    // first and leaves nothing for the second. The refusal must name the budget.
    const root = tmp();
    writeRawZip(path.join(root, "a.zip"), [{ name: "m.txt", content: "x".repeat(400) }]);
    writeRawZip(path.join(root, "b.zip"), [{ name: "m.txt", content: "y".repeat(400) }]);
    const before = treeSnapshot(root);

    const observation = acquireLocalSource({
      path: root,
      archivePolicy: { maxTotalUncompressedBytesPerSession: 400, maxCompressionRatio: 100000 },
    });
    try {
      const held = observation.archives.filter((archive) => !archive.expanded);
      expect(held).toHaveLength(1);
      const codes = held[0].holds.map((hold) => hold.code);
      expect(codes).toContain("archive.session_budget_exceeded");
      expect(codes).not.toContain("archive.format_unreadable");
      expect(observation.virtualArtifacts).toHaveLength(1);
      expect(treeSnapshot(root)).toEqual(before);
    } finally {
      observation.dispose();
    }
  });

  test("two archives with identical bytes do not share staging", () => {
    // A digest-only staging key aliased them, so discarding one held archive's
    // partial staging deleted the other's already-extracted members.
    const root = tmp();
    const bytes = (() => {
      const staging = tmp();
      writeRawZip(path.join(staging, "x.zip"), [{ name: "m.txt", content: "shared" }]);
      return fs.readFileSync(path.join(staging, "x.zip"));
    })();
    fs.writeFileSync(path.join(root, "first.zip"), bytes);
    fs.writeFileSync(path.join(root, "second.zip"), bytes);

    const observation = acquireLocalSource({ path: root });
    try {
      const members = observation.virtualArtifacts;
      expect(members.map((member) => member.virtualSourcePath))
        .toEqual(["first.zip!/m.txt", "second.zip!/m.txt"]);
      // Same bytes, same digest, but two distinct staged files.
      expect(members[0].contentHash).toBe(members[1].contentHash);
      expect(members[0].stagedPath).not.toBe(members[1].stagedPath);
      for (const member of members) expect(fs.existsSync(member.stagedPath)).toBe(true);
    } finally {
      observation.dispose();
    }
  });
});
