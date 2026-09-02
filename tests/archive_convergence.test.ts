import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import {
  ArchiveExecutionContext,
  resolveArchiveExecution,
} from "../src/archive_execution";
import {
  expandArchivesUnderRoot,
  extractDirFor,
  extractZip,
  listZipMembers,
} from "../src/archives";
import { streamZipMember } from "../src/zip_reader";
import { writeRawZip } from "./helpers/zip_fixtures";

const EOCD_SIGNATURE = 0x06054b50;

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-archive-convergence-"));
}

function trailingEocdOffset(bytes: Buffer): number {
  for (let offset = bytes.length - 22; offset >= 0; offset--) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("EOCD not found");
}

function setZipComment(zipPath: string, comment: Buffer): void {
  const bytes = fs.readFileSync(zipPath);
  const eocd = trailingEocdOffset(bytes);
  bytes.writeUInt16LE(comment.length, eocd + 20);
  fs.writeFileSync(zipPath, Buffer.concat([bytes.subarray(0, eocd + 22), comment]));
}

/**
 * Put a fully-framed fake EOCD inside the real EOCD comment. It declares only
 * the first central entry, exactly the prefix-hiding shape the parser must reject.
 */
function appendPrefixHidingFakeEocd(zipPath: string): void {
  const bytes = fs.readFileSync(zipPath);
  const realEocd = trailingEocdOffset(bytes);
  const centralStart = bytes.readUInt32LE(realEocd + 16);
  const firstNameLength = bytes.readUInt16LE(centralStart + 28);
  const firstExtraLength = bytes.readUInt16LE(centralStart + 30);
  const firstCommentLength = bytes.readUInt16LE(centralStart + 32);
  const firstCentralSize = 46 + firstNameLength + firstExtraLength + firstCommentLength;

  const prefix = Buffer.from("comment-prefix", "utf8");
  const suffix = Buffer.from("comment-suffix", "utf8");
  const fake = Buffer.alloc(22);
  fake.writeUInt32LE(EOCD_SIGNATURE, 0);
  fake.writeUInt16LE(0, 4);
  fake.writeUInt16LE(0, 6);
  fake.writeUInt16LE(1, 8);
  fake.writeUInt16LE(1, 10);
  fake.writeUInt32LE(firstCentralSize, 12);
  fake.writeUInt32LE(centralStart, 16);
  fake.writeUInt16LE(suffix.length, 20);
  setZipComment(zipPath, Buffer.concat([prefix, fake, suffix]));
}

describe("archive convergence invariants", () => {
  test("a legal ZIP comment may contain EOCD signature bytes without shadowing the real record", () => {
    const root = tmp();
    const zipPath = path.join(root, "comment.zip");
    writeRawZip(zipPath, [{ name: "a.md", content: "alpha" }]);

    const comment = Buffer.alloc(48, 0x41);
    comment.writeUInt32LE(EOCD_SIGNATURE, 8);
    // The signature-shaped bytes are followed by enough data to look tempting,
    // but their own encoded comment length does not reach physical EOF.
    comment.writeUInt16LE(0, 28);
    setZipComment(zipPath, comment);

    expect(listZipMembers(zipPath)).toEqual(["a.md"]);
  });

  test("a framed fake EOCD inside the real comment cannot hide a central-directory suffix", () => {
    const root = tmp();
    const zipPath = path.join(root, "prefix-hide.zip");
    writeRawZip(zipPath, [
      { name: "visible.md", content: "visible" },
      { name: "must-not-hide.txt", content: "tail" },
    ]);
    appendPrefixHidingFakeEocd(zipPath);

    expect(() => listZipMembers(zipPath)).toThrow(/central directory does not terminate/);
  });

  test("one run-scoped archive-count budget governs sibling archives", () => {
    const root = tmp();
    writeRawZip(path.join(root, "A.zip"), [{ name: "a.txt", content: "a" }]);
    writeRawZip(path.join(root, "B.zip"), [{ name: "b.txt", content: "b" }]);

    const result = expandArchivesUnderRoot(root, {
      dryRun: false,
      verbose: false,
      archivePolicy: { maxNestedArchiveCount: 1 },
    });

    expect(result.archives).toHaveLength(2);
    expect(result.archives[0].heldReason).toBeUndefined();
    expect(result.archives[1].heldReason).toMatch(/archive count limit of 1 reached/);
    expect(fs.existsSync(extractDirFor(path.join(root, "A.zip")))).toBe(true);
    expect(fs.existsSync(extractDirFor(path.join(root, "B.zip")))).toBe(false);
  });

  test("dry-run consumes the same in-memory session budget without source mutation", () => {
    const root = tmp();
    const a = path.join(root, "A.zip");
    const b = path.join(root, "B.zip");
    writeRawZip(a, [{ name: "a.txt", content: "a" }]);
    writeRawZip(b, [{ name: "b.txt", content: "b" }]);

    const result = expandArchivesUnderRoot(root, {
      dryRun: true,
      verbose: false,
      archivePolicy: { maxNestedArchiveCount: 1 },
    });

    expect(result.archives[0].heldReason).toMatch(/dry-run: 1 member/);
    expect(result.archives[1].heldReason).toMatch(/archive count limit of 1 reached/);
    expect(fs.existsSync(extractDirFor(a))).toBe(false);
    expect(fs.existsSync(extractDirFor(b))).toBe(false);
  });

  test("invalid programmatic policy values fail closed before archive execution", () => {
    const root = tmp();
    writeRawZip(path.join(root, "A.zip"), [{ name: "a.txt", content: "a" }]);

    expect(() => expandArchivesUnderRoot(root, {
      dryRun: false,
      verbose: false,
      archivePolicy: { maxMemberCount: Number.POSITIVE_INFINITY },
    })).toThrow(/maxMemberCount must be a positive finite integer/);

    expect(() => resolveArchiveExecution({ maxNestedDepth: -1 }))
      .toThrow(/maxNestedDepth must be a non-negative finite integer/);
  });

  test("an archive context keeps reading the immutable staged bytes after the live path changes", () => {
    const root = tmp();
    const zipPath = path.join(root, "stable.zip");
    writeRawZip(zipPath, [{ name: "before.txt", content: "before", stored: true }]);
    const resolution = resolveArchiveExecution();
    const context = new ArchiveExecutionContext({
      zipPath,
      extractDir: extractDirFor(zipPath),
      depth: 0,
      resolution,
    });

    try {
      writeRawZip(zipPath, [{ name: "after.txt", content: "after", stored: true }]);
      expect(context.centralDirectory.entries.map((entry) => entry.name)).toEqual(["before.txt"]);
      const chunks: Buffer[] = [];
      const entry = context.centralDirectory.entries[0];
      const result = streamZipMember(
        context.stagedZipPath,
        entry,
        { maxUncompressedBytes: 1024 },
        (chunk) => chunks.push(Buffer.from(chunk)),
      );
      expect(result.crc32).toBe(entry.crc32);
      expect(Buffer.concat(chunks).toString("utf8")).toBe("before");
    } finally {
      context.dispose();
    }
  });

  test("the hard processing deadline remains enforceable after admission", () => {
    let now = 0;
    const root = tmp();
    const zipPath = path.join(root, "deadline.zip");
    writeRawZip(zipPath, [{ name: "a.txt", content: "a", stored: true }]);
    const resolution = resolveArchiveExecution({ maxProcessingMs: 1 }, () => now);
    const context = new ArchiveExecutionContext({
      zipPath,
      extractDir: extractDirFor(zipPath),
      depth: 0,
      resolution,
    });
    try {
      now = 2;
      expect(() => context.assertProcessingWithinBudget()).toThrow(/processing budget/);
    } finally {
      context.dispose();
    }
  });

  test("destructive ownership refuses a complete v2 marker belonging to another archive", () => {
    const root = tmp();
    const a = path.join(root, "A.zip");
    const b = path.join(root, "B.zip");
    writeRawZip(a, [{ name: "a.txt", content: "a" }]);
    writeRawZip(b, [{ name: "b.txt", content: "b" }]);
    const aTarget = extractDirFor(a);
    const bTarget = extractDirFor(b);
    expect(extractZip(a, aTarget)).toBe(1);
    fs.renameSync(aTarget, bTarget);

    expect(() => extractZip(b, bTarget)).toThrow(/ownership belongs to A\.zip, not B\.zip/);
    expect(fs.readFileSync(path.join(bTarget, "a.txt"), "utf8")).toBe("a");
  });

  test("v2 ownership records staged archive, reader, and semantic policy provenance", () => {
    const root = tmp();
    const zipPath = path.join(root, "marker.zip");
    const target = extractDirFor(zipPath);
    writeRawZip(zipPath, [{ name: "a.txt", content: "a" }]);
    expect(extractZip(zipPath, target)).toBe(1);

    const marker = JSON.parse(
      fs.readFileSync(path.join(target, ".l9extracted-owner.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(marker.schema).toBe("l9-meta-injector.local-files-extraction/v2");
    expect(marker.owner).toBe("l9-meta-injector.local-files");
    expect(marker.archive).toBe("marker.zip");
    expect(marker.archive_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(marker.reader_version).toBe("1.0.0");
    expect(marker.policy_fingerprint).toMatch(/^lap1:[0-9a-f]{64}$/);
  });
});
