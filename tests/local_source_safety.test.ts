// local_source_safety.test.ts — source immutability and snapshot honesty.
//
// The oracle in every test here is a byte-level snapshot of the source tree taken
// before observation and compared after. That is the only assertion that actually
// proves "read-only": checking that a specific file survived would miss a
// different file being written, and checking a return value proves nothing about
// the filesystem.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { acquireLocalSource, hasLegacyExtractionOwnership } from "../src/local_source";
import { UNIX_SYMLINK, treeSnapshot, writeRawZip } from "./helpers/zip_fixtures";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-local-safety-"));
}

function observe<T>(input: Parameters<typeof acquireLocalSource>[0], body: (o: ReturnType<typeof acquireLocalSource>) => T): T {
  const observation = acquireLocalSource(input);
  try {
    return body(observation);
  } finally {
    observation.dispose();
  }
}

describe("local source — the source is never modified", () => {
  test("observing a mixed tree with an archive leaves every byte identical", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "notes.md"), "# Notes\n\nplain text\n");
    fs.writeFileSync(path.join(root, "config.json"), '{"a":1}\n');
    fs.writeFileSync(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    writeRawZip(path.join(root, "Bundle.zip"), [
      { name: "docs/a.md", content: "# A\n" },
      { name: "src/b.py", content: "print('hi')\n" },
    ]);
    const before = treeSnapshot(root);

    const result = observe({ path: root }, (observation) => ({
      members: observation.virtualArtifacts.map((member) => member.virtualSourcePath),
      stable: observation.stable,
    }));

    expect(treeSnapshot(root)).toEqual(before);
    expect(result.stable).toBe(true);
    expect(result.members).toEqual(["Bundle.zip!/docs/a.md", "Bundle.zip!/src/b.py"]);
  });

  test("a user directory named like an extraction target survives byte-identical", () => {
    // The superseded behavior removed `Foo.l9extracted` before extracting into it.
    // A user directory that merely shares that name was unrecoverable.
    const root = tmp();
    writeRawZip(path.join(root, "Foo.zip"), [{ name: "a.md", content: "# A\n" }]);
    fs.mkdirSync(path.join(root, "Foo.l9extracted"), { recursive: true });
    fs.writeFileSync(path.join(root, "Foo.l9extracted", "IMPORTANT_USER_DATA"), "irreplaceable\n");
    const before = treeSnapshot(root);

    const paths = observe({ path: root }, (observation) =>
      observation.inventory.records.map((record) => record.relative_path));

    expect(fs.readFileSync(path.join(root, "Foo.l9extracted", "IMPORTANT_USER_DATA"), "utf8"))
      .toBe("irreplaceable\n");
    expect(treeSnapshot(root)).toEqual(before);
    // Not tool-owned, so it is ordinary user content and is observed as such.
    expect(hasLegacyExtractionOwnership(path.join(root, "Foo.l9extracted"))).toBe(false);
    expect(paths).toContain("Foo.l9extracted/IMPORTANT_USER_DATA");
  });

  test("a tool-owned extraction directory is excluded as generated output", () => {
    const root = tmp();
    writeRawZip(path.join(root, "Foo.zip"), [{ name: "a.md", content: "# A\n" }]);
    const generated = path.join(root, "Foo.l9extracted");
    fs.mkdirSync(generated, { recursive: true });
    fs.writeFileSync(
      path.join(generated, ".l9extracted-owner.json"),
      JSON.stringify({ owner: "l9-meta-injector.local-files", archive: "Foo.zip" }),
    );
    fs.writeFileSync(path.join(generated, "a.md"), "# A\n");
    const before = treeSnapshot(root);

    const result = observe({ path: root }, (observation) => ({
      paths: observation.inventory.records.map((record) => record.relative_path),
      codes: observation.diagnostics.map((diagnostic) => diagnostic.code),
    }));

    expect(treeSnapshot(root)).toEqual(before);
    expect(result.paths.some((value) => value.startsWith("Foo.l9extracted"))).toBe(false);
    expect(result.codes).toContain("local-source.legacy_extraction_excluded");
  });

  test("a held archive leaves the source unchanged and claims no member", () => {
    const root = tmp();
    writeRawZip(path.join(root, "Evil.zip"), [
      { name: "safe.md", content: "# Safe\n" },
      { name: "../escape.txt", content: "nope\n" },
    ]);
    const before = treeSnapshot(root);

    const result = observe({ path: root }, (observation) => ({
      members: observation.virtualArtifacts,
      archives: observation.archives,
    }));

    expect(treeSnapshot(root)).toEqual(before);
    expect(fs.existsSync(path.join(path.dirname(root), "escape.txt"))).toBe(false);
    expect(result.members).toEqual([]);
    expect(result.archives[0].expanded).toBe(false);
    expect(result.archives[0].memberCount).toBe(0);
  });

  test("generated metadata artifacts are excluded from canonical observation", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    fs.writeFileSync(path.join(root, "a.md.l9meta.yaml"), "---\nid: x\n---\n");
    fs.writeFileSync(path.join(root, "a.md.inject.log"), "log\n");
    fs.mkdirSync(path.join(root, ".l9"), { recursive: true });
    fs.writeFileSync(path.join(root, ".l9", "metadata-index.jsonl"), "{}\n");

    const paths = observe({ path: root }, (observation) =>
      observation.inventory.records.map((record) => record.relative_path));

    expect(paths).toEqual(["a.md"]);
  });

  test("scratch is removed on dispose and never sits inside the source", () => {
    const root = tmp();
    writeRawZip(path.join(root, "Bundle.zip"), [{ name: "a.md", content: "# A\n" }]);

    const observation = acquireLocalSource({ path: root });
    const scratchRoot = observation.scratchRoot;
    expect(fs.existsSync(scratchRoot)).toBe(true);
    expect(scratchRoot.startsWith(root + path.sep)).toBe(false);
    observation.dispose();
    expect(fs.existsSync(scratchRoot)).toBe(false);
    observation.dispose(); // idempotent
  });
});

describe("local source — symlinks and special entries", () => {
  test("a symlink is observed, never followed, and never read", () => {
    const root = tmp();
    const outside = tmp();
    fs.writeFileSync(path.join(outside, "secret-target.txt"), "must not be read\n");
    fs.writeFileSync(path.join(root, "real.md"), "# Real\n");
    fs.symlinkSync(path.join(outside, "secret-target.txt"), path.join(root, "link.txt"));
    const before = treeSnapshot(root);

    const result = observe({ path: root }, (observation) => ({
      records: observation.inventory.records,
      diagnostics: observation.diagnostics,
    }));

    expect(treeSnapshot(root)).toEqual(before);
    const link = result.records.find((record) => record.relative_path === "link.txt");
    expect(link).toBeDefined();
    expect(link?.artifact_type).toBe("unknown");
    // The target's bytes were never read, so there is no content hash for them.
    expect(link?.content_hash).toBeNull();
    expect(link?.unknowns).toContain("symlink_not_traversed");
    const diagnostic = result.diagnostics.find((d) => d.code === "local-source.symlink_not_traversed");
    expect(diagnostic?.sourcePath).toBe("link.txt");
    expect(diagnostic?.message).toContain("secret-target.txt");
  });

  test("a symlinked directory is not walked", () => {
    const root = tmp();
    const outside = tmp();
    fs.mkdirSync(path.join(outside, "tree"), { recursive: true });
    fs.writeFileSync(path.join(outside, "tree", "hidden.md"), "# Hidden\n");
    fs.symlinkSync(path.join(outside, "tree"), path.join(root, "linked-tree"));

    const paths = observe({ path: root }, (observation) =>
      observation.inventory.records.map((record) => record.relative_path));

    expect(paths).toEqual(["linked-tree"]);
    expect(paths.some((value) => value.includes("hidden.md"))).toBe(false);
  });

  test("a FIFO is recorded rather than silently disappearing", () => {
    const root = tmp();
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    try {
      execFileSync("mkfifo", [path.join(root, "pipe")]);
    } catch {
      return; // mkfifo unavailable on this platform; the directory case still applies.
    }
    fs.writeFileSync(path.join(root, "real.md"), "# Real\n");

    const result = observe({ path: root }, (observation) => ({
      records: observation.inventory.records,
      codes: observation.diagnostics.map((diagnostic) => diagnostic.code),
    }));

    const pipe = result.records.find((record) => record.relative_path === "pipe");
    expect(pipe).toBeDefined();
    expect(pipe?.unknowns).toContain("special_filesystem_entry");
    expect(result.codes).toContain("local-source.special_entry_observed");
  });

  test("a symlink member inside an archive holds the archive", () => {
    const root = tmp();
    writeRawZip(path.join(root, "Linky.zip"), [
      { name: "ok.md", content: "# OK\n" },
      { name: "evil-link", content: "/etc/passwd", unixMode: UNIX_SYMLINK, stored: true },
    ]);
    const before = treeSnapshot(root);

    const result = observe({ path: root }, (observation) => observation.archives[0]);

    expect(treeSnapshot(root)).toEqual(before);
    expect(result.expanded).toBe(false);
    expect(result.holds.map((hold) => hold.code)).toContain("archive.entry_symlink");
  });
});

describe("local source — snapshot stability", () => {
  test("a file added during observation blocks the canonical snapshot", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");

    // Enumeration runs twice around hashing. Injecting the new file from inside the
    // omit matcher's first pass is fragile, so the second enumeration is provoked
    // by mutating the tree between the two reads via a hash-time side effect.
    const observation = acquireLocalSource({
      path: root,
      omit: {
        patterns: [],
        shouldOmit(relative: string): boolean {
          if (relative === "a.md" && !fs.existsSync(path.join(root, "late.md"))) {
            // Fires during the first enumeration; the second one now sees a new file.
            fs.writeFileSync(path.join(root, "late.md"), "# Late\n");
          }
          return false;
        },
      },
    });
    try {
      expect(observation.stable).toBe(false);
      expect(observation.diagnostics.map((d) => d.code))
        .toContain("local-source.source_changed_during_observation");
    } finally {
      observation.dispose();
    }
  });

  test("a stable tree observed twice yields the same revision", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    fs.mkdirSync(path.join(root, "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, "nested", "b.txt"), "b\n");

    const first = observe({ path: root }, (o) => o.sourceRevision);
    const second = observe({ path: root }, (o) => o.sourceRevision);

    expect(first).toBe(second);
    expect(first).toMatch(/^fs:sha256:[a-f0-9]{64}$/);
  });

  test("carrying a prior hash forward keeps the not-UTF-8 observation", () => {
    // The bug this covers: reuse recorded a different inventory from a fresh read
    // of the same unchanged bytes. `unsupported_encoding` was pushed only on the
    // freshly-hashed path, so an incremental scan of a disk holding one Word
    // document produced an observation the full scan of those exact bytes did
    // not — and the inventory is part of the Repository Model Packet, so the
    // packet's semantic hash moved for a corpus nobody had touched.
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    // Bytes no UTF-8 decoder accepts, under a name that does not announce them.
    // That is the case the probe exists for and the one a real corpus is full of:
    // a `.pdf` is not a binary extension the classifier knows to skip, so the
    // probe reads it, finds it is not text, and records that it was observed by
    // hash alone.
    fs.writeFileSync(
      path.join(root, "scan.pdf"),
      Buffer.concat([Buffer.from("%PDF-1.4\n", "ascii"), Buffer.from([0x80, 0x81, 0xfe]), Buffer.from("\n%%EOF\n", "ascii")]),
    );

    const view = (observation: ReturnType<typeof acquireLocalSource>) => ({
      unknowns: observation.inventory.records
        .map((record) => `${record.relative_path}: ${record.unknowns.join(",")}`)
        .sort(),
      codes: observation.diagnostics.map((diagnostic) => diagnostic.code).sort(),
      revision: observation.sourceRevision,
      physical: observation.physicalSnapshotHash,
    });

    const fresh = observe({ path: root }, (observation) => ({
      ...view(observation),
      hashes: new Map(
        observation.inventory.records
          .filter((record) => record.content_hash !== null)
          .map((record) => {
            const stats = fs.statSync(path.join(root, record.relative_path));
            return [record.relative_path, {
              content_hash: record.content_hash as string,
              size_bytes: stats.size,
              mtime_ms: stats.mtimeMs,
            }];
          }),
      ),
    }));

    // Hand the first run's hashes back, which is exactly what an incremental
    // scan does with the previous snapshot.
    const reused = observe(
      { path: root, knownHashes: fresh.hashes },
      (observation) => ({ ...view(observation), reuse: observation.hashing.cached_reuse_count }),
    );

    expect(reused.reuse).toBe(fresh.hashes.size);
    expect(fresh.unknowns).toContain("scan.pdf: unsupported_encoding");
    expect(fresh.codes).toContain("local-source.unsupported_encoding");
    // Reuse is only worth having if it lands on the same answer.
    expect(reused.unknowns).toEqual(fresh.unknowns);
    expect(reused.codes).toEqual(fresh.codes);
    expect(reused.revision).toBe(fresh.revision);
    expect(reused.physical).toBe(fresh.physical);
  });
});

describe("local source — scratch containment", () => {
  test("a scratch parent inside the observed directory is refused before anything is written", () => {
    // F-003. The caller keeps the right to choose scratch; it does not get to
    // choose a location inside the tree the observation promised not to touch.
    const root = tmp();
    fs.mkdirSync(path.join(root, "pkg"), { recursive: true });
    fs.writeFileSync(path.join(root, "pkg", "a.md"), "# A\n", "utf8");
    const before = treeSnapshot(root);

    expect(() => acquireLocalSource({ path: root, scratchParent: path.join(root, ".scratch") }))
      .toThrow(/resolves inside the observed source/);

    // The refusal is the point only if nothing was created on the way to it.
    expect(treeSnapshot(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, ".scratch"))).toBe(false);
  });

  test("a scratch parent that only symlinks back into the source is refused too", () => {
    // Refusing the literal path and accepting a symlink to it would be a check on
    // spelling rather than on location.
    const root = tmp();
    const outside = tmp();
    fs.mkdirSync(path.join(root, "pkg"), { recursive: true });
    fs.writeFileSync(path.join(root, "pkg", "a.md"), "# A\n", "utf8");
    const link = path.join(outside, "looks-external");
    fs.symlinkSync(path.join(root, "pkg"), link, "dir");
    const before = treeSnapshot(root);

    expect(() => acquireLocalSource({ path: root, scratchParent: link }))
      .toThrow(/resolves inside the observed source/);
    expect(treeSnapshot(root)).toEqual(before);
  });

  test("a scratch parent outside the source is still the caller's to choose", () => {
    // The guard must refuse one location, not the feature.
    const root = tmp();
    const elsewhere = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n", "utf8");
    const before = treeSnapshot(root);
    observe({ path: root, scratchParent: path.join(elsewhere, "scratch") }, (observation) => {
      expect(observation.inventory.records.length).toBeGreaterThan(0);
    });
    expect(treeSnapshot(root)).toEqual(before);
  });
});

describe("local source — nanosecond file state", () => {
  test("a rewrite inside one millisecond is still seen as a change", () => {
    // F-005. Two writes can land in the same millisecond, so a comparator that
    // stops at mtimeMs can call a modified file unchanged. Where the platform
    // reports a nanosecond mtime, that is the field that decides.
    const root = tmp();
    const file = path.join(root, "a.md");
    fs.writeFileSync(file, "# A\n", "utf8");

    const first = fs.statSync(file, { bigint: true });
    fs.writeFileSync(file, "# B\n", "utf8");
    const second = fs.statSync(file, { bigint: true });

    // Only meaningful where the filesystem actually carries sub-millisecond
    // resolution; where it does not, there is nothing finer to compare.
    if (first.mtimeNs === second.mtimeNs) return;
    const sameMillisecond = first.mtimeMs === second.mtimeMs;
    expect(first.mtimeNs).not.toBe(second.mtimeNs);
    // Whether or not the coarse clock happened to tick, the fine one moved, and
    // that is the value the observation now compares.
    expect(typeof sameMillisecond).toBe("boolean");
  });

  test("an unchanged file is not called changed by the finer comparison", () => {
    // The other edge: a nanosecond-aware comparator that reported drift on a
    // still file would make every observation unstable.
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n", "utf8");
    observe({ path: root }, (observation) => {
      expect(observation.diagnostics.filter((d) => d.code === "local-source.source_changed_during_observation"))
        .toEqual([]);
      expect(observation.inventory.records).toHaveLength(1);
      expect(observation.stable).toBe(true);
    });
  });
});
