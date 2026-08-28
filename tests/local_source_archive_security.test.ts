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
import type { ArchiveManifestStore } from "../src/local_source";
import { canonicalMemberPath, memberCollisionKey, preflightArchive } from "../src/archive_preflight";
import type { ArchivePreflightResult } from "../src/archive_preflight";
import { DEFAULT_LOCAL_ARCHIVE_POLICY, localArchivePolicyFingerprint, resolveLocalArchivePolicy } from "../src/local_archive_policy";
import { ZipBudgetExceededError, readZipCentralDirectory, streamZipMember } from "../src/zip_reader";
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

describe("resolved-policy fingerprint", () => {
  test("is stable for the same resolved policy regardless of override order", () => {
    const a = resolveLocalArchivePolicy({ maxMemberCount: 5, maxCompressionRatio: 12 });
    const b = resolveLocalArchivePolicy({ maxCompressionRatio: 12, maxMemberCount: 5 });
    expect(localArchivePolicyFingerprint(a)).toBe(localArchivePolicyFingerprint(b));
    // And stable across calls, so it can serve as a cache identity at all.
    expect(localArchivePolicyFingerprint(a)).toBe(localArchivePolicyFingerprint(a));
  });

  test("every field of the resolved policy contributes to the identity", () => {
    // The point of F-001: a field that does not reach the fingerprint is a field
    // whose tightening can be silently ignored by a warm cache. Asserted over the
    // whole policy rather than a chosen few, so a new field is covered when it is
    // added instead of when someone remembers to extend this test.
    const base = resolveLocalArchivePolicy();
    const baseline = localArchivePolicyFingerprint(base);
    const seen = new Map<string, string>();
    for (const key of Object.keys(base) as (keyof typeof base)[]) {
      const current = base[key];
      const altered = typeof current === "number"
        ? { ...base, [key]: current + 1 }
        : { ...base, [key]: `${String(current)}-x` };
      const moved = localArchivePolicyFingerprint(altered);
      expect(moved, `changing ${String(key)} left the fingerprint unchanged`).not.toBe(baseline);
      const collided = seen.get(moved);
      expect(collided, `${String(key)} and ${collided} produced the same fingerprint`).toBeUndefined();
      seen.set(moved, String(key));
    }
    expect(seen.size).toBe(Object.keys(base).length);
  });

  test("a stricter policy at the same contract version has a different identity", () => {
    // The exact confusion F-001 describes: same declared version, different rules.
    const permissive = resolveLocalArchivePolicy({ maxCompressionRatio: 200 });
    const strict = resolveLocalArchivePolicy({ maxCompressionRatio: 10 });
    expect(permissive.version).toBe(strict.version);
    expect(localArchivePolicyFingerprint(permissive)).not.toBe(localArchivePolicyFingerprint(strict));
  });

  test("the defaults and an explicit restatement of them agree", () => {
    // A caller who passes the defaults back in must not miss their own warm cache.
    expect(localArchivePolicyFingerprint(resolveLocalArchivePolicy()))
      .toBe(localArchivePolicyFingerprint({ ...DEFAULT_LOCAL_ARCHIVE_POLICY }));
  });

  test("a warm permissive verdict cannot answer a stricter same-version policy", () => {
    // F-001 end to end, through live acquisition rather than the key function:
    // warm the store with a policy that accepts this archive, then observe the
    // exact same bytes under a policy that forbids it while declaring the same
    // version. The second run must reach preflight and hold, not read the first
    // run's "accepted" back out of the cache.
    const entries = new Map<string, ArchivePreflightResult>();
    const lookups: string[] = [];
    const store: ArchiveManifestStore = {
      get: (key) => {
        lookups.push(key.policyFingerprint);
        return entries.get(JSON.stringify(key));
      },
      put: (key, value) => { entries.set(JSON.stringify(key), value); },
    };

    const parent = tmp();
    const root = path.join(parent, "src");
    fs.mkdirSync(root, { recursive: true });
    // 512 KiB of one repeated byte deflates around a thousand to one: accepted
    // under a ratio ceiling of 100000, refused under one of 10.
    writeRawZip(path.join(root, "Case.zip"), [{ name: "bomb.txt", content: "A".repeat(512 * 1024) }]);

    const observe = (policy: Partial<LocalArchivePolicy>) => {
      const observation = acquireLocalSource({
        path: path.join(root, "Case.zip"),
        archivePolicy: policy,
        archiveManifests: store,
      });
      try {
        const archive = observation.archives[0];
        return { expanded: archive.expanded, holdCodes: archive.holds.map((hold) => hold.code) };
      } finally {
        observation.dispose();
      }
    };

    const permissive = observe({ maxCompressionRatio: 100000 });
    expect(permissive.expanded).toBe(true);
    expect(permissive.holdCodes).toEqual([]);
    expect(entries.size).toBe(1);

    const strict = observe({ maxCompressionRatio: 10 });
    expect(strict.expanded).toBe(false);
    expect(strict.holdCodes).toContain("archive.compression_ratio_exceeded");

    // The two runs asked different questions, so they asked under different keys
    // and the stricter one wrote its own verdict rather than reusing the entry.
    expect(entries.size).toBe(2);
    expect(lookups).toHaveLength(2);
    expect(lookups[0]).not.toBe(lookups[1]);
    // And the versions really were identical, which is what made this reachable.
    expect(resolveLocalArchivePolicy({ maxCompressionRatio: 100000 }).version)
      .toBe(resolveLocalArchivePolicy({ maxCompressionRatio: 10 }).version);
  });

  test("an unchanged policy still reuses its own warm verdict", () => {
    // The fingerprint must not defeat the cache it is protecting: the same
    // resolved policy over the same bytes is the same question, and answering it
    // from the store is the whole point of having one.
    const entries = new Map<string, ArchivePreflightResult>();
    let hits = 0;
    const store: ArchiveManifestStore = {
      get: (key) => {
        const found = entries.get(JSON.stringify(key));
        if (found !== undefined) hits += 1;
        return found;
      },
      put: (key, value) => { entries.set(JSON.stringify(key), value); },
    };

    const parent = tmp();
    const root = path.join(parent, "src");
    fs.mkdirSync(root, { recursive: true });
    writeRawZip(path.join(root, "Case.zip"), [{ name: "note.txt", content: "plain text" }]);

    for (let run = 0; run < 2; run++) {
      const observation = acquireLocalSource({
        path: path.join(root, "Case.zip"),
        archivePolicy: { maxCompressionRatio: 200 },
        archiveManifests: store,
      });
      try {
        expect(observation.archives[0].expanded).toBe(true);
      } finally {
        observation.dispose();
      }
    }
    expect(entries.size).toBe(1);
    expect(hits).toBe(1);
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

describe("zip64 central-directory records", () => {
  test("placeholder sizes and offsets are resolved from the extra field", () => {
    // A real producer writes 0xFFFFFFFF placeholders and carries the true values in
    // the Zip64 extended-information field once they no longer fit in 32 bits. The
    // reader must consume that positional list correctly or it reports a member as
    // 4 GiB and refuses a perfectly ordinary archive.
    const root = tmp();
    writeRawZip(path.join(root, "big.zip"), [
      { name: "first.txt", content: "first member", zip64: true },
      { name: "docs/second.md", content: "# Second\n".repeat(20), zip64: true },
    ]);

    const directory = readZipCentralDirectory(path.join(root, "big.zip"));
    expect(directory.entries.map((entry) => entry.name)).toEqual(["first.txt", "docs/second.md"]);
    for (const entry of directory.entries) {
      expect(entry.uncompressedSize).not.toBe(0xffffffff);
      expect(entry.compressedSize).not.toBe(0xffffffff);
      expect(entry.localHeaderOffset).not.toBe(0xffffffff);
    }
    expect(directory.entries[0].uncompressedSize).toBe("first member".length);
    expect(directory.entries[1].uncompressedSize).toBe("# Second\n".repeat(20).length);
  });

  test("a zip64 archive round-trips through acquisition with exact member hashes", () => {
    const root = tmp();
    const body = "# Second\n".repeat(20);
    writeRawZip(path.join(root, "big.zip"), [
      { name: "first.txt", content: "first member", zip64: true },
      { name: "docs/second.md", content: body, zip64: true },
    ]);
    const before = treeSnapshot(root);

    const observation = acquireLocalSource({ path: path.join(root, "big.zip") });
    try {
      expect(observation.archives[0].expanded).toBe(true);
      expect(observation.virtualArtifacts.map((member) => member.virtualSourcePath))
        .toEqual(["big.zip!/docs/second.md", "big.zip!/first.txt"]);
      const second = observation.virtualArtifacts
        .find((member) => member.memberPath === "docs/second.md");
      expect(second?.sizeBytes).toBe(body.length);
      expect(second?.contentHash)
        .toBe(`sha256:${createHash("sha256").update(body).digest("hex")}`);
      expect(treeSnapshot(root)).toEqual(before);
    } finally {
      observation.dispose();
    }
  });

  test("a truncated zip64 payload leaves the placeholder rather than reading past it", () => {
    // The reader consumes one 64-bit value per placeholder and stops when the
    // payload runs out, instead of reading whatever follows the extra field.
    const root = tmp();
    writeRawZip(path.join(root, "ok.zip"), [{ name: "a.txt", content: "plain", zip64: true }]);
    const bytes = fs.readFileSync(path.join(root, "ok.zip"));
    // Shrink the declared extra-field length so its payload no longer covers all
    // three values; the record itself stays structurally parseable.
    const eocdOffset = bytes.length - 22;
    const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
    const extraLengthAt = centralOffset + 30;
    expect(bytes.readUInt16LE(extraLengthAt)).toBe(4 + 24);
    bytes.writeUInt16LE(4 + 8, extraLengthAt);
    bytes.writeUInt16LE(8, centralOffset + 46 + bytes.readUInt16LE(centralOffset + 28) + 2);
    // Drop the 16 bytes the shortened payload no longer declares and shrink the
    // directory's declared size to match. The subject here is a truncated zip64
    // payload, not a directory with unconsumed bytes after its last record --
    // readZipCentralDirectory now rejects the latter outright, which would fail
    // this test for a reason it is not about.
    const eocd = bytes.subarray(eocdOffset);
    eocd.writeUInt32LE(eocd.readUInt32LE(12) - 16, 12);
    fs.writeFileSync(path.join(root, "ok.zip"), Buffer.concat([bytes.subarray(0, eocdOffset - 16), eocd]));

    const directory = readZipCentralDirectory(path.join(root, "ok.zip"));
    // The first placeholder resolved; the two the payload could not cover stayed put.
    expect(directory.entries[0].uncompressedSize).toBe("plain".length);
    expect(directory.entries[0].compressedSize).toBe(0xffffffff);
    expect(directory.entries[0].localHeaderOffset).toBe(0xffffffff);
  });

  /**
   * Build a valid archive, corrupt its bytes, and report both what the reader
   * says and what the live acquisition seam does with it.
   *
   * Both halves matter. A reader that throws while the seam still claims members
   * has moved the defect rather than closed it, so every case below asserts the
   * refusal *and* the absence of claims.
   */
  function corruptedArchive(
    members: ZipMemberSpec[],
    corrupt: (bytes: Buffer) => Buffer,
  ): { read: () => unknown; outcome: HeldOutcome } {
    const parent = tmp();
    const root = path.join(parent, "src");
    fs.mkdirSync(root, { recursive: true });
    const archivePath = path.join(root, "Case.zip");
    writeRawZip(archivePath, members);
    fs.writeFileSync(archivePath, corrupt(fs.readFileSync(archivePath)));

    const beforeSource = treeSnapshot(root);
    const beforeParent = treeSnapshot(parent);
    const observation = acquireLocalSource({ path: archivePath });
    try {
      const archive = observation.archives[0];
      return {
        read: () => readZipCentralDirectory(archivePath),
        outcome: {
          expanded: archive.expanded,
          holdCodes: archive.holds.map((hold) => hold.code),
          memberCount: archive.memberCount,
          claimedMembers: observation.virtualArtifacts.map((member) => member.virtualSourcePath),
          sourceUnchanged: JSON.stringify(treeSnapshot(root)) === JSON.stringify(beforeSource),
          parentUnchanged: JSON.stringify(treeSnapshot(parent)) === JSON.stringify(beforeParent),
        },
      };
    } finally {
      observation.dispose();
    }
  }

  /** Overwrite the EOCD's declared total-entry count, leaving the records alone. */
  function declareEntryCount(bytes: Buffer, count: number): Buffer {
    const eocdOffset = bytes.length - 22;
    bytes.writeUInt16LE(count, eocdOffset + 8);
    bytes.writeUInt16LE(count, eocdOffset + 10);
    return bytes;
  }

  test("a directory declaring more entries than it carries is refused", () => {
    // Reading stopped when the records ran out and returned the short list as if
    // it were the archive. Every member the declaration accounts for and the
    // directory does not is a member preflight would never have seen.
    const { read, outcome } = corruptedArchive(
      [{ name: "a.md", content: "# A\n" }],
      (bytes) => declareEntryCount(bytes, 3),
    );
    expect(read).toThrow(/declares 3 entries but 1 could be parsed/);
    expectHeld(outcome, "archive.format_unreadable");
  });

  test("a directory declaring fewer entries than it carries is refused", () => {
    // The mirror case: members present but unaccounted for. Refusing both keeps
    // the count an equality rather than a floor.
    const { read, outcome } = corruptedArchive(
      [{ name: "a.md", content: "# A\n" }, { name: "b.md", content: "# B\n" }],
      (bytes) => declareEntryCount(bytes, 1),
    );
    expect(read).toThrow(/declares 1 entries but 2 could be parsed/);
    expectHeld(outcome, "archive.format_unreadable");
  });

  test("bytes trailing the last central-directory record are refused", () => {
    // The parse loop exits when fewer than a fixed header's bytes remain, so
    // padding after the final record used to be discarded in silence. The
    // declared byte span must be consumed exactly, not merely covered.
    const { read, outcome } = corruptedArchive(
      [{ name: "a.md", content: "# A\n" }],
      (bytes) => {
        const eocdOffset = bytes.length - 22;
        const eocd = Buffer.from(bytes.subarray(eocdOffset));
        eocd.writeUInt32LE(eocd.readUInt32LE(12) + 8, 12);
        return Buffer.concat([bytes.subarray(0, eocdOffset), Buffer.alloc(8), eocd]);
      },
    );
    expect(read).toThrow(/declares \d+ bytes but \d+ were consumed/);
    expectHeld(outcome, "archive.format_unreadable");
  });

  test("an incomplete final central-directory record is refused", () => {
    // Fewer than CENTRAL_FIXED_SIZE trailing bytes: too short to parse as a
    // record, and previously too short to notice.
    const { read, outcome } = corruptedArchive(
      [{ name: "a.md", content: "# A\n" }],
      (bytes) => {
        const eocdOffset = bytes.length - 22;
        const eocd = Buffer.from(bytes.subarray(eocdOffset));
        eocd.writeUInt32LE(eocd.readUInt32LE(12) + 10, 12);
        return Buffer.concat([bytes.subarray(0, eocdOffset), Buffer.alloc(10), eocd]);
      },
    );
    expect(read).toThrow(/declares \d+ bytes but \d+ were consumed/);
    expectHeld(outcome, "archive.format_unreadable");
  });

  test("a deflated member is bounded by the decompressor, not by the bytes it emits", () => {
    // The module documents deflate as synchronously buffered whole under a
    // ceiling zlib enforces. This is that claim, tested directly: the ceiling has
    // to stop the inflate itself, because a check on emitted chunks would run
    // only after the full output had already been allocated.
    const root = tmp();
    const archivePath = path.join(root, "big.zip");
    writeRawZip(archivePath, [{ name: "big.txt", content: "A".repeat(512 * 1024) }]);
    const entry = readZipCentralDirectory(archivePath).entries[0];
    expect(entry.compressionMethod).toBe(8);

    const chunks: Buffer[] = [];
    expect(() => streamZipMember(
      archivePath,
      entry,
      { maxUncompressedBytes: 4096 },
      (chunk) => { chunks.push(chunk); },
    )).toThrow(ZipBudgetExceededError);
    // Nothing reached the sink: the refusal happened inside the inflate, before
    // any chunk existed to hand on.
    expect(chunks).toEqual([]);

    // And the same member under a sufficient ceiling still round-trips, so the
    // bound is a ceiling rather than a ban on deflated members.
    const ok: Buffer[] = [];
    const result = streamZipMember(
      archivePath,
      entry,
      { maxUncompressedBytes: 1024 * 1024 },
      (chunk) => { ok.push(chunk); },
    );
    expect(result.bytesWritten).toBe(512 * 1024);
    expect(Buffer.concat(ok).toString()).toBe("A".repeat(512 * 1024));
  });
});
