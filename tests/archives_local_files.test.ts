import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { describe, expect, test } from "vitest";
import { runPipelineAsync } from "../src/pipeline";
import { findFiles } from "../src/retrieval";
import { PipelineConfig } from "../src/schema";
import {
  extractDirFor,
  expandArchivesUnderRoot,
  extractZip,
  listZipMembers,
  writeArchiveSidecar,
} from "../src/archives";
import { sidecarPathFor } from "../src/comment";
import { UNIX_SYMLINK, treeSnapshot, writeRawZip } from "./helpers/zip_fixtures";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-archives-"));
}

/** Path -> content digest for every file under a root; the mutation oracle. */
function treeSnapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (entry.isDirectory()) { out[`${rel}/`] = "dir"; walk(abs); }
      else if (entry.isFile()) out[rel] = createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
      else out[rel] = `other:${entry.isSymbolicLink() ? "symlink" : "special"}`;
    }
  };
  walk(root);
  return out;
}

function cfg(root: string, out: string, localFiles = false): PipelineConfig {
  return {
    root, glob: "**/*", dryRun: false, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
    writeInjectLog: false, localFiles,
  };
}

/** Build a zip via system `zip` (same dependency surface as extraction). */
function makeZip(zipPath: string, stagingDir: string, members: Record<string, string>): void {
  fs.mkdirSync(stagingDir, { recursive: true });
  for (const [rel, body] of Object.entries(members)) {
    const abs = path.join(stagingDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
  const names = Object.keys(members);
  execFileSync("zip", ["-q", "-r", zipPath, ...names], { cwd: stagingDir });
}

/**
 * Flip one byte of a member's stored data in place, so the central directory's
 * CRC no longer matches the bytes the extractor will produce.
 */
function corruptStoredMember(zipPath: string, memberName: string): void {
  const bytes = fs.readFileSync(zipPath);
  const name = Buffer.from(memberName, "utf8");
  for (let i = 0; i + 30 <= bytes.length; i++) {
    if (bytes.readUInt32LE(i) !== 0x04034b50) continue;
    const nameLength = bytes.readUInt16LE(i + 26);
    const extraLength = bytes.readUInt16LE(i + 28);
    const stored = bytes.subarray(i + 30, i + 30 + nameLength);
    if (!stored.equals(name)) continue;
    const dataStart = i + 30 + nameLength + extraLength;
    bytes[dataStart] = bytes[dataStart] ^ 0xff;
    fs.writeFileSync(zipPath, bytes);
    return;
  }
  throw new Error(`member ${memberName} not found in ${zipPath}`);
}

describe("archives — local-files expansion", () => {
  test("default findFiles excludes .zip (repo mode)", () => {
    const root = tmp();
    const staging = path.join(root, "_stage");
    makeZip(path.join(root, "pack.zip"), staging, { "note.md": "# hello skill capability action\n" });
    fs.writeFileSync(path.join(root, "loose.md"), "# loose skill capability function\n");
    const found = findFiles(root, "**/*");
    expect(found.some((f) => f.endsWith(".zip"))).toBe(false);
    expect(found.some((f) => f.endsWith("loose.md"))).toBe(true);
  });

  test("expandArchivesUnderRoot extracts members and writes sidecar", () => {
    const root = tmp();
    const staging = path.join(root, "_stage");
    const zipPath = path.join(root, "pack.zip");
    makeZip(zipPath, staging, {
      "docs/readme.md": "# Kernel runtime executor sandbox\n\nskill capability action\n",
      "src/util.py": "print('hi')\n",
    });
    const result = expandArchivesUnderRoot(root, { dryRun: false, verbose: false });
    expect(result.archives).toHaveLength(1);
    const extractDir = extractDirFor(zipPath);
    expect(fs.existsSync(path.join(extractDir, "docs", "readme.md"))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, "src", "util.py"))).toBe(true);
    expect(fs.existsSync(sidecarPathFor(zipPath))).toBe(true);
    const sc = fs.readFileSync(sidecarPathFor(zipPath), "utf8");
    expect(sc).toMatch(/artifact_type: archive/);
    expect(sc).toMatch(/member_count: 2/);
  });

  // ADR-036: dry run means zero source-tree mutation. This path used to extract
  // during a dry run and skip only the sidecar, so "dry run" described something
  // the code did not do.
  test("dryRun performs zero source mutation and reports what a real run would extract", () => {
    const root = tmp();
    const zipPath = path.join(root, "pack.zip");
    makeZip(zipPath, path.join(root, "_stage"), { "a.md": "# doctrine governance policy principle\n" });
    const before = treeSnapshot(root);

    const result = expandArchivesUnderRoot(root, { dryRun: true, verbose: false });

    expect(fs.existsSync(extractDirFor(zipPath))).toBe(false);
    expect(fs.existsSync(sidecarPathFor(zipPath))).toBe(false);
    expect(treeSnapshot(root)).toEqual(before);
    expect(result.extractedRoots).toEqual([]);
    expect(result.archives).toHaveLength(1);
    expect(result.archives[0].memberCount).toBe(0);
    expect(result.archives[0].heldReason).toMatch(/dry-run: 1 member\(s\) would be extracted/);
  });

  test("an existing sibling directory without an ownership marker is never deleted", () => {
    const root = tmp();
    const zipPath = path.join(root, "Foo.zip");
    makeZip(zipPath, path.join(root, "_stage"), { "a.md": "# skill capability function action\n" });
    // A user directory that merely happens to be named like an extraction target.
    const userDir = extractDirFor(zipPath);
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, "IMPORTANT_USER_DATA"), "irreplaceable\n");
    const before = treeSnapshot(root);

    const result = expandArchivesUnderRoot(root, { dryRun: false, verbose: false });

    expect(fs.readFileSync(path.join(userDir, "IMPORTANT_USER_DATA"), "utf8")).toBe("irreplaceable\n");
    expect(treeSnapshot(root)).toEqual(before);
    expect(result.archives[0].heldReason).toMatch(/carries no .* ownership marker/);
    expect(() => extractZip(zipPath, userDir)).toThrow(/never removed/);
  });

  test("a tool-owned extraction directory may be refreshed", () => {
    const root = tmp();
    const zipPath = path.join(root, "Bar.zip");
    makeZip(zipPath, path.join(root, "_stage"), { "a.md": "# skill capability function action\n" });

    const first = expandArchivesUnderRoot(root, { dryRun: false, verbose: false });
    expect(first.archives[0].heldReason).toBeUndefined();
    expect(fs.existsSync(path.join(extractDirFor(zipPath), ".l9extracted-owner.json"))).toBe(true);

    const second = expandArchivesUnderRoot(root, { dryRun: false, verbose: false });
    expect(second.archives[0].heldReason).toBeUndefined();
    expect(second.archives[0].memberCount).toBe(1);
  });

  test("refresh materializes through a candidate swap and leaves no candidate or backup behind", () => {
    const root = tmp();
    const zipPath = path.join(root, "Swap.zip");
    writeRawZip(zipPath, [
      { name: "old.md", content: "# old\n" },
      { name: "nested/keep.txt", content: "keep" },
    ]);
    const extractDir = extractDirFor(zipPath);
    expect(extractZip(zipPath, extractDir)).toBe(2);
    expect(fs.existsSync(path.join(extractDir, "old.md"))).toBe(true);

    // Second run with a different member set: the old members must disappear,
    // the new one must appear, and no candidate/backup directory may remain.
    writeRawZip(zipPath, [{ name: "new.md", content: "# new\n" }]);
    expect(extractZip(zipPath, extractDir)).toBe(1);
    expect(fs.existsSync(path.join(extractDir, "new.md"))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, "old.md"))).toBe(false);
    expect(fs.existsSync(path.join(extractDir, "nested", "keep.txt"))).toBe(false);
    const leftovers = fs
      .readdirSync(root)
      .filter((name) => name.includes("candidate-") || name.includes("previous-"));
    expect(leftovers).toEqual([]);
  });

  test("a member that fails mid-write leaves the previous extraction intact and no candidate behind", () => {
    const root = tmp();
    const zipPath = path.join(root, "Crc.zip");
    writeRawZip(zipPath, [
      { name: "good.md", content: "# good\n" },
      { name: "bad.txt", content: "data", stored: true },
    ]);
    const extractDir = extractDirFor(zipPath);
    expect(extractZip(zipPath, extractDir)).toBe(2);

    // Corrupt the stored bytes of bad.txt: preflight still accepts (the declared
    // sizes are unchanged) but the CRC check fails during materialization.
    corruptStoredMember(zipPath, "bad.txt");
    const before = treeSnapshot(root);

    expect(() => extractZip(zipPath, extractDir)).toThrow(/CRC|integrity/);

    // The previous extraction is byte-identical — the member that existed from
    // the first run still carries its original bytes, never the corrupted ones —
    // and no candidate directory remains.
    expect(fs.existsSync(path.join(extractDir, "good.md"))).toBe(true);
    expect(fs.readFileSync(path.join(extractDir, "bad.txt"), "utf8")).toBe("data");
    expect(treeSnapshot(root)).toEqual(before);
    const leftovers = fs
      .readdirSync(root)
      .filter((name) => name.includes("candidate-") || name.includes("previous-"));
    expect(leftovers).toEqual([]);
  });

  test("dry-run reports the same preflight refusal as a real run", () => {
    const root = tmp();
    const zipPath = path.join(root, "DryHostile.zip");
    writeRawZip(zipPath, [{ name: "link", content: "/etc/passwd", unixMode: UNIX_SYMLINK, stored: true }]);
    const before = treeSnapshot(root);

    const result = expandArchivesUnderRoot(root, { dryRun: true, verbose: false });

    // The same hold a real run would refuse with, not a "would extract" promise.
    expect(result.archives[0].heldReason).toMatch(/refusing to extract.*entry_symlink/);
    expect(treeSnapshot(root)).toEqual(before);
    expect(fs.existsSync(extractDirFor(zipPath))).toBe(false);
  });

  test("dry-run reports the ownership refusal for an existing unmarked target", () => {
    const root = tmp();
    const zipPath = path.join(root, "DryTarget.zip");
    writeRawZip(zipPath, [{ name: "a.md", content: "# a\n" }]);
    const extractDir = extractDirFor(zipPath);
    fs.mkdirSync(extractDir, { recursive: true });
    fs.writeFileSync(path.join(extractDir, "USER_DATA"), "irreplaceable\n");
    const before = treeSnapshot(root);

    const result = expandArchivesUnderRoot(root, { dryRun: true, verbose: false });

    expect(result.archives[0].heldReason).toMatch(/user data/);
    expect(treeSnapshot(root)).toEqual(before);
  });

  test("an empty unmarked sibling directory is never replaced", () => {
    // Emptiness is not ownership: a user directory that happens to be empty and
    // named like an extraction target is still user data.
    const root = tmp();
    const zipPath = path.join(root, "Empty.zip");
    writeRawZip(zipPath, [{ name: "a.md", content: "# a\n" }]);
    const extractDir = extractDirFor(zipPath);
    fs.mkdirSync(extractDir, { recursive: true });

    const result = expandArchivesUnderRoot(root, { dryRun: false, verbose: false });
    expect(result.archives[0].heldReason).toMatch(/empty.*user data/);
    expect(fs.existsSync(extractDir)).toBe(true);
    expect(() => extractZip(zipPath, extractDir)).toThrow(/never replaced/);
  });

  test("a legacy v1 marker without the v2 schema is refused for refresh", () => {
    const root = tmp();
    const zipPath = path.join(root, "Legacy.zip");
    writeRawZip(zipPath, [{ name: "a.md", content: "# a\n" }]);
    const extractDir = extractDirFor(zipPath);
    expect(extractZip(zipPath, extractDir)).toBe(1);

    // Simulate a directory produced by an older release: owner only, no schema.
    fs.writeFileSync(
      path.join(extractDir, ".l9extracted-owner.json"),
      JSON.stringify({ owner: "l9-meta-injector.local-files", archive: "Legacy.zip" }, null, 2),
      "utf8",
    );
    const before = treeSnapshot(root);

    expect(() => extractZip(zipPath, extractDir)).toThrow(/legacy ownership marker/);
    expect(treeSnapshot(root)).toEqual(before);
  });

  test("the marker written is the v2 schema bound to the exact archive bytes", () => {
    const root = tmp();
    const zipPath = path.join(root, "V2.zip");
    writeRawZip(zipPath, [{ name: "a.md", content: "# a\n" }]);
    const extractDir = extractDirFor(zipPath);
    expect(extractZip(zipPath, extractDir)).toBe(1);

    const marker = JSON.parse(
      fs.readFileSync(path.join(extractDir, ".l9extracted-owner.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(marker.schema).toBe("l9-meta-injector.local-files-extraction/v2");
    expect(marker.owner).toBe("l9-meta-injector.local-files");
    expect(marker.archive).toBe("V2.zip");
    expect(marker.archive_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(typeof marker.created_at).toBe("string");
  });

  test("a spoofed owner prefix never grants destructive authority", () => {
    // The old predicate accepted any owner starting with `l9-meta-injector.`, so
    // `l9-meta-injector.evil` was tool-owned authority. Exact match only.
    const root = tmp();
    const zipPath = path.join(root, "Spoof.zip");
    writeRawZip(zipPath, [{ name: "a.md", content: "# a\n" }]);
    const extractDir = extractDirFor(zipPath);
    fs.mkdirSync(extractDir, { recursive: true });
    fs.writeFileSync(path.join(extractDir, "IMPORTANT_USER_DATA"), "irreplaceable\n");
    fs.writeFileSync(
      path.join(extractDir, ".l9extracted-owner.json"),
      JSON.stringify({ owner: "l9-meta-injector.evil", archive: "Spoof.zip" }, null, 2),
      "utf8",
    );
    const before = treeSnapshot(root);

    expect(() => extractZip(zipPath, extractDir)).toThrow(/never removed/);
    expect(treeSnapshot(root)).toEqual(before);
    expect(fs.readFileSync(path.join(extractDir, "IMPORTANT_USER_DATA"), "utf8")).toBe("irreplaceable\n");
  });

  test("listZipMembers rejects Zip-Slip paths", () => {
    const root = tmp();
    const evil = path.join(root, "evil.zip");
    execFileSync("python3", ["-c", `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1], 'w')
z.writestr('../escape.txt', 'nope')
z.close()
`, evil]);
    expect(() => listZipMembers(evil)).toThrow(/unsafe zip member/);
  });

  test("pipeline localFiles injects extracted members and sidecars the zip", async () => {
    const root = tmp();
    const out = tmp();
    const zipPath = path.join(root, "bundle.zip");
    // Use path/keyword signals that classify as injectable (skill / source)
    makeZip(zipPath, path.join(root, "_stage"), {
      "skills/do-thing.md": [
        "# Do Thing",
        "",
        "This skill capability function action operation handles routing.",
        "",
      ].join("\n"),
      "code/helper.py": "def run():\n    return 1\n",
    });
    fs.writeFileSync(
      path.join(root, "top.md"),
      "# Top doctrine governance policy principle standard\n\nOutside the zip.\n",
    );

    const without = await runPipelineAsync(cfg(root, out, false));
    expect(without.coverage.archivesExpanded).toBe(0);
    expect(without.archives).toHaveLength(0);
    // Without localFiles, zip members are invisible
    expect(without.injected.every((r) => !r.sourcePath.includes(".l9extracted"))).toBe(true);

    const out2 = tmp();
    const withLocal = await runPipelineAsync(cfg(root, out2, true));
    expect(withLocal.coverage.archivesExpanded).toBe(1);
    expect(withLocal.archives).toHaveLength(1);
    expect(fs.existsSync(sidecarPathFor(zipPath))).toBe(true);
    expect(fs.existsSync(path.join(out2, "archives-expanded.json"))).toBe(true);

    const extractedMd = path.join(extractDirFor(zipPath), "skills", "do-thing.md");
    const extractedPy = path.join(extractDirFor(zipPath), "code", "helper.py");
    expect(fs.existsSync(extractedMd)).toBe(true);
    expect(fs.readFileSync(extractedMd, "utf8")).toMatch(/^---/);
    expect(fs.readFileSync(extractedPy, "utf8")).toMatch(/l9:meta/);
    expect(withLocal.injected.some((r) => r.sourcePath === extractedMd)).toBe(true);
    expect(withLocal.injected.some((r) => r.sourcePath === extractedPy)).toBe(true);
  });

  test("nested zip is expanded within maxDepth", () => {
    const root = tmp();
    const innerStage = path.join(root, "_inner");
    const outerStage = path.join(root, "_outer");
    fs.mkdirSync(outerStage, { recursive: true });
    const innerZip = path.join(outerStage, "inner.zip");
    makeZip(innerZip, innerStage, {
      "nested.md": "# Nested skill capability function action\n",
    });
    fs.writeFileSync(path.join(outerStage, "outer.md"), "# Outer skill capability function action\n");
    const outerZip = path.join(root, "outer.zip");
    execFileSync("zip", ["-q", "-r", outerZip, "inner.zip", "outer.md"], { cwd: outerStage });

    const result = expandArchivesUnderRoot(root, { dryRun: false, verbose: false, maxDepth: 3 });
    expect(result.archives.length).toBeGreaterThanOrEqual(2);
    const outerExtract = extractDirFor(outerZip);
    const nestedMd = path.join(outerExtract, "inner.l9extracted", "nested.md");
    expect(fs.existsSync(path.join(outerExtract, "outer.md"))).toBe(true);
    expect(fs.existsSync(nestedMd)).toBe(true);
  });

  test("omit skips protected SKILL.md members and omitted archives", async () => {
    const { buildOmitMatcher } = await import("../src/omit");
    const root = tmp();
    const zipPath = path.join(root, "pack.zip");
    makeZip(zipPath, path.join(root, "_stage"), {
      "SKILL.md": "---\nname: secret\ndescription: Do not touch.\n---\n\n# Skill\n",
      "notes.md": "# Notes skill capability function action\n",
      "noise.log": "log line\n",
    });
    const omittedZip = path.join(root, "secret-pack.zip");
    makeZip(omittedZip, path.join(root, "_stage2"), {
      "hidden.md": "# Hidden skill capability function action\n",
    });

    const omit = buildOmitMatcher({
      root,
      patterns: ["**/secret-pack.zip"],
      protectSkillMd: true,
    });
    const result = expandArchivesUnderRoot(root, { dryRun: false, verbose: false, omit });
    expect(result.omittedArchives.some((p) => p.endsWith("secret-pack.zip"))).toBe(true);
    expect(result.archives.every((a) => !a.zipPath.endsWith("secret-pack.zip"))).toBe(true);

    const extractDir = extractDirFor(zipPath);
    expect(fs.existsSync(path.join(extractDir, "notes.md"))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, "SKILL.md"))).toBe(false);
    expect(fs.existsSync(path.join(extractDir, "noise.log"))).toBe(false);
    expect(fs.existsSync(extractDirFor(omittedZip))).toBe(false);

    const out = tmp();
    const pipe = await runPipelineAsync({ ...cfg(root, out, true) });
    expect(pipe.injected.every((r) => !r.sourcePath.toLowerCase().endsWith("skill.md"))).toBe(true);
    expect(pipe.injected.some((r) => r.sourcePath.endsWith("notes.md"))).toBe(true);
  });
});

describe("writeArchiveSidecar", () => {
  test("writes fenced yaml next to the zip", () => {
    const root = tmp();
    const zipPath = path.join(root, "x.zip");
    makeZip(zipPath, path.join(root, "_s"), { "a.txt": "hi\n" });
    const extractDir = extractDirFor(zipPath);
    fs.mkdirSync(extractDir, { recursive: true });
    const sc = writeArchiveSidecar(zipPath, extractDir, 1);
    expect(sc).toBe(sidecarPathFor(zipPath));
    expect(fs.readFileSync(sc, "utf8")).toMatch(/^---\n/);
  });

  // T-05 / F-006: localFiles is a mutating surface, so "held" has to mean held
  // *before* anything is written or removed. These assert the archive is refused
  // and the source tree is byte-identical afterwards -- a refusal reported in a
  // return value after the extraction directory was already destroyed would not
  // be a refusal.
  describe("hostile archives are held before any source-tree materialization", () => {
    function refuses(name: string, members: Parameters<typeof writeRawZip>[1], pattern: RegExp): void {
      const root = tmp();
      const zipPath = path.join(root, name);
      writeRawZip(zipPath, members);
      const before = treeSnapshot(root);

      expect(() => extractZip(zipPath, extractDirFor(zipPath))).toThrow(pattern);
      expect(fs.existsSync(extractDirFor(zipPath))).toBe(false);
      expect(treeSnapshot(root)).toEqual(before);
    }

    test("a traversal member is refused", () => {
      refuses("traverse.zip", [{ name: "../escape.txt", content: "no" }], /unsafe zip member|path_traversal/);
    });

    test("a symlink member is refused", () => {
      refuses(
        "link.zip",
        [{ name: "link", content: "/etc/passwd", unixMode: UNIX_SYMLINK, stored: true }],
        /refusing to extract|entry_type/,
      );
    });

    test("a case-only collision is refused", () => {
      refuses(
        "collide.zip",
        [{ name: "A.md", content: "one" }, { name: "a.md", content: "two" }],
        /refusing to extract|collision/,
      );
    });

    test("an existing tool-owned extraction survives a refused archive", () => {
      // The ordering claim, made falsifiable: a held archive must not cost the
      // operator the extraction they already had.
      const root = tmp();
      const zipPath = path.join(root, "Held.zip");
      writeRawZip(zipPath, [{ name: "ok.md", content: "# fine\n" }]);
      const extractDir = extractDirFor(zipPath);
      extractZip(zipPath, extractDir);
      expect(fs.existsSync(path.join(extractDir, "ok.md"))).toBe(true);
      const before = treeSnapshot(root);

      // Same archive path, now hostile.
      writeRawZip(zipPath, [{ name: "link", content: "/etc/passwd", unixMode: UNIX_SYMLINK, stored: true }]);
      const afterRewrite = treeSnapshot(root);
      expect(() => extractZip(zipPath, extractDir)).toThrow(/refusing to extract/);
      // The archive's own bytes changed; everything this tool had written did not.
      expect(treeSnapshot(root)).toEqual(afterRewrite);
      expect(fs.existsSync(path.join(extractDir, "ok.md"))).toBe(true);
      expect(Object.keys(before).length).toBeGreaterThan(0);
    });

    test("an accepted archive still materializes members with verified bytes", () => {
      // The negative cases above must not be passing because everything is refused.
      const root = tmp();
      const zipPath = path.join(root, "Good.zip");
      writeRawZip(zipPath, [
        { name: "a.md", content: "# alpha\n" },
        { name: "nested/b.txt", content: "beta" },
      ]);
      const extractDir = extractDirFor(zipPath);
      expect(extractZip(zipPath, extractDir)).toBe(2);
      expect(fs.readFileSync(path.join(extractDir, "a.md"), "utf8")).toBe("# alpha\n");
      expect(fs.readFileSync(path.join(extractDir, "nested/b.txt"), "utf8")).toBe("beta");
    });
  });
});
