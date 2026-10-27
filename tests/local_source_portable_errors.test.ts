// local_source_portable_errors.test.ts — failures recorded by local-source
// acquisition are machine-independent, and host failures while staging an archive
// are never reported as a property of the archive (RC-032 / F-042, RC-049 / F-116).
//
// The suite runs as root, so no permission bit can make an entry unreadable and no
// quota can fill the scratch disk; each failure is injected at the `node:fs`
// module seam, keyed on an entry name so that two copies of one tree at different
// absolute paths fail identically. Every other filesystem call is real.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { acquireLocalSource, type LocalSourceObservation } from "../src/local_source";
import { canonicalBlockReason, toRepositoryModelLocalSource, withLocalSourceModel } from "../src/local_source_model";
import { buildRepositoryModelPacket, type RepositoryModelPacket } from "../src/repository_model";
import { treeSnapshot, writeRawZip } from "./helpers/zip_fixtures";

const seam = vi.hoisted(() => ({
  /** Directory basename whose `readdirSync` fails with EACCES. */
  lockedDir: "",
  /** File basename whose `openSync` fails with EACCES. */
  lockedFile: "",
  /** Restrict `lockedFile` to opens made while staging an archive. */
  lockedOnlyWhileStaging: false,
  /** Fail opening the archive staging target for writing with ENOSPC. */
  scratchFull: false,
  /** Descriptors opened through the seam and not yet closed. */
  openDescriptors: new Set<number>(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const failure = (code: string, syscall: string, target: string): NodeJS.ErrnoException => {
    const error = new Error(`${code}: simulated failure, ${syscall} '${target}'`) as NodeJS.ErrnoException;
    error.code = code;
    return error;
  };
  const readdirSync = ((target: fs.PathLike, ...rest: unknown[]) => {
    if (seam.lockedDir && path.basename(String(target)) === seam.lockedDir) {
      throw failure("EACCES", "scandir", path.resolve(String(target)));
    }
    return (actual.readdirSync as (...args: unknown[]) => unknown)(target, ...rest);
  }) as typeof fs.readdirSync;
  const openSync = ((target: fs.PathLike, flags?: fs.OpenMode, ...rest: unknown[]) => {
    const resolved = path.resolve(String(target));
    if (seam.lockedFile && path.basename(resolved) === seam.lockedFile) {
      const staging = (new Error().stack ?? "").includes("stageArchive");
      if (!seam.lockedOnlyWhileStaging || staging) throw failure("EACCES", "open", resolved);
    }
    if (seam.scratchFull && flags === "w" && /[\\/]archives[\\/]pending-\d+\.zip$/.test(resolved)) {
      throw failure("ENOSPC", "open", resolved);
    }
    const fd = (actual.openSync as (...args: unknown[]) => number)(target, flags, ...rest);
    seam.openDescriptors.add(fd);
    return fd;
  }) as typeof fs.openSync;
  const closeSync = ((fd: number) => {
    seam.openDescriptors.delete(fd);
    return actual.closeSync(fd);
  }) as typeof fs.closeSync;
  const patched = { readdirSync, openSync, closeSync };
  return { ...actual, ...patched, default: { ...actual, ...patched } };
});

const PRODUCER_VERSION = "4.0.0";
const roots: string[] = [];

function tmp(prefix = "l9-portable-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  seam.lockedDir = "";
  seam.lockedFile = "";
  seam.lockedOnlyWhileStaging = false;
  seam.scratchFull = false;
  seam.openDescriptors.clear();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeTree(root: string): void {
  fs.writeFileSync(path.join(root, "README.md"), "# Fixture\n");
  fs.mkdirSync(path.join(root, "locked"));
  fs.writeFileSync(path.join(root, "locked", "inner.md"), "# inner\n");
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "docs", "secret-ish.md"), "# secret-ish\n");
  writeRawZip(path.join(root, "Bundle.zip"), [{ name: "a.md", content: "# A\n" }]);
}

function twoCheckouts(): { first: string; second: string } {
  const first = path.join(tmp(), "machine-a-mount", "project");
  const second = path.join(tmp(), "machine-b-mount", "project");
  for (const root of [first, second]) {
    fs.mkdirSync(root, { recursive: true });
    writeTree(root);
  }
  return { first, second };
}

/** Acquire, build the packet the corpus path builds, and release the scratch. */
function acquireAndBuild(root: string, scratchParent: string): {
  observation: LocalSourceObservation;
  packet: RepositoryModelPacket;
  scratchRoot: string;
} {
  const observation = acquireLocalSource({ path: root, name: "fixture", scratchParent });
  try {
    const packet = buildRepositoryModelPacket({
      inventory: observation.inventory,
      repositoryName: observation.sourceName,
      sourceRevision: observation.sourceRevision,
      producerVersion: PRODUCER_VERSION,
      localSource: toRepositoryModelLocalSource(observation),
    });
    return { observation, packet, scratchRoot: observation.scratchRoot };
  } finally {
    observation.dispose();
  }
}

/** Every string an observation reports, minus the documented host-only fields. */
function semanticText(observation: LocalSourceObservation): string {
  return JSON.stringify({
    diagnostics: observation.diagnostics,
    archives: observation.archives,
    skippedDirs: observation.inventory.skippedDirs,
    unknowns: observation.inventory.records.map((record) => record.unknowns),
  });
}

describe("local-source failures are recorded without host paths (RC-032)", () => {
  test("REG-WU-028-RC-032-B06-a: an unreadable file yields the same identity at two absolute paths", () => {
    const { first, second } = twoCheckouts();
    seam.lockedFile = "secret-ish.md";
    const a = acquireAndBuild(first, tmp("l9-portable-scratch-"));
    const b = acquireAndBuild(second, tmp("l9-portable-scratch-"));

    expect(b.packet.source_snapshot.semantic_hash).toBe(a.packet.source_snapshot.semantic_hash);
    expect(b.packet.semantic_hash).toBe(a.packet.semantic_hash);
    const record = a.observation.inventory.records.find((r) => r.relative_path === "docs/secret-ish.md");
    expect(record?.unknowns).toContain("content_hash_unavailable:EACCES");
    for (const { observation } of [a, b]) {
      const text = semanticText(observation);
      expect(text).not.toContain(first);
      expect(text).not.toContain(second);
    }
    for (const { packet } of [a, b]) {
      const serialized = JSON.stringify(packet);
      expect(serialized).not.toContain(first);
      expect(serialized).not.toContain(second);
    }
  });

  test("REG-WU-028-RC-032-B06-b: an unreadable directory is recorded as `<relative>: <CODE>`", () => {
    const { first, second } = twoCheckouts();
    seam.lockedDir = "locked";
    const a = acquireAndBuild(first, tmp("l9-portable-scratch-"));
    const b = acquireAndBuild(second, tmp("l9-portable-scratch-"));

    expect(a.observation.inventory.skippedDirs).toEqual(["locked: EACCES"]);
    expect(b.packet.source_snapshot.semantic_hash).toBe(a.packet.source_snapshot.semantic_hash);
    expect(b.packet.semantic_hash).toBe(a.packet.semantic_hash);
    const unreadable = a.packet.payload.diagnostics.filter((d) => d.code === "directory-unreadable");
    expect(unreadable.map((d) => d.details)).toEqual([{ directory: "locked", reason: "EACCES" }]);
    for (const { observation, packet } of [a, b]) {
      for (const text of [semanticText(observation), JSON.stringify(packet)]) {
        expect(text).not.toContain(first);
        expect(text).not.toContain(second);
      }
    }
  });

  test("REG-WU-028-RC-032-B06-c: an unreadable ZIP leaves no host or scratch path in a hold or diagnostic", () => {
    const root = path.join(tmp(), "project");
    fs.mkdirSync(root);
    writeTree(root);
    seam.lockedFile = "Bundle.zip";
    const { observation, scratchRoot } = acquireAndBuild(root, tmp("l9-portable-scratch-"));
    const text = semanticText(observation);
    expect(text).not.toContain(root);
    expect(text).not.toContain(scratchRoot);
    expect(text).not.toContain(os.tmpdir());
  });

  test("REG-WU-028-RC-032-B06-d: readable trees at different paths still yield an identical packet", () => {
    const build = (): RepositoryModelPacket => {
      const root = path.join(tmp(), "project");
      fs.mkdirSync(root);
      writeTree(root);
      return withLocalSourceModel(
        { path: root, name: "fixture", producerVersion: PRODUCER_VERSION, interpret: false },
        (result) => result.packet,
      );
    };
    const first = build();
    const second = build();
    expect(second.source_snapshot.revision).toBe(first.source_snapshot.revision);
    expect(second.semantic_hash).toBe(first.semantic_hash);
    expect(second.packet_id).toBe(first.packet_id);
  });
});

describe("host failures while staging an archive are not archive verdicts (RC-049)", () => {
  test("REG-WU-028-RC-049-a: a full scratch disk is thrown, the scratch removed and no descriptor leaked", () => {
    const root = tmp();
    const scratchParent = tmp("l9-portable-scratch-");
    writeRawZip(path.join(root, "Case.zip"), [{ name: "docs/a.md", content: "# A\n" }]);
    const before = treeSnapshot(root);
    seam.scratchFull = true;

    let thrown: unknown;
    try {
      acquireLocalSource({ path: root, scratchParent });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as NodeJS.ErrnoException | undefined)?.code).toBe("ENOSPC");
    expect(fs.readdirSync(scratchParent)).toEqual([]);
    expect(treeSnapshot(root)).toEqual(before);
    expect([...seam.openDescriptors]).toEqual([]);
  });

  test("REG-WU-028-RC-049-b: an archive the snapshot could not read is not held as format_unreadable", () => {
    const root = tmp();
    writeRawZip(path.join(root, "Case.zip"), [{ name: "docs/a.md", content: "# A\n" }]);
    seam.lockedFile = "Case.zip";
    const observation = acquireLocalSource({ path: root, scratchParent: tmp("l9-portable-scratch-") });
    try {
      expect(observation.archives.filter((a) => a.holds.some((h) => h.code === "archive.format_unreadable")))
        .toEqual([]);
      const record = observation.inventory.records.find((r) => r.relative_path === "Case.zip");
      expect(record?.content_hash).toBeNull();
      expect(record?.unknowns).toContain("content_hash_unavailable:EACCES");
      // With RC-046 (WU-035) the unread archive bytes block the canonical packet.
      expect(canonicalBlockReason(observation)).not.toBeNull();
    } finally {
      observation.dispose();
    }
  });

  test("REG-WU-028-RC-049-c: a source that becomes unreadable between hashing and staging makes the observation unstable", () => {
    const root = tmp();
    writeRawZip(path.join(root, "Case.zip"), [{ name: "docs/a.md", content: "# A\n" }]);
    seam.lockedFile = "Case.zip";
    seam.lockedOnlyWhileStaging = true;
    const observation = acquireLocalSource({ path: root, scratchParent: tmp("l9-portable-scratch-") });
    try {
      expect(observation.inventory.records.find((r) => r.relative_path === "Case.zip")?.content_hash).not.toBeNull();
      expect(observation.stable).toBe(false);
      expect(observation.archives.filter((a) => a.holds.some((h) => h.code === "archive.format_unreadable")))
        .toEqual([]);
      expect(observation.diagnostics.map((d) => d.code)).toContain("local-source.source_changed_during_observation");
      expect(semanticText(observation)).not.toContain(root);
    } finally {
      observation.dispose();
    }
  });

  test("REG-WU-028-RC-049-d: a truncated archive is still held as archive.format_unreadable", () => {
    const root = tmp();
    const zip = path.join(root, "Broken.zip");
    writeRawZip(zip, [{ name: "a.md", content: "# A\n" }]);
    const bytes = fs.readFileSync(zip);
    fs.writeFileSync(zip, bytes.subarray(0, Math.floor(bytes.length / 2)));
    const observation = acquireLocalSource({ path: root, scratchParent: tmp("l9-portable-scratch-") });
    try {
      const archive = observation.archives.find((a) => a.sourcePath === "Broken.zip");
      expect(archive?.holds.map((h) => h.code)).toContain("archive.format_unreadable");
      expect(archive?.memberCount ?? 0).toBe(0);
    } finally {
      observation.dispose();
    }
  });

  test("REG-WU-028-RC-049-e: an exception thrown mid-extraction still propagates and leaves no scratch behind", () => {
    const root = tmp();
    const scratchParent = tmp("l9-portable-scratch-");
    writeRawZip(path.join(root, "Case.zip"), [{ name: "docs/a.md", content: "# A\n" }]);
    const before = treeSnapshot(root);
    const failing = {
      patterns: [],
      shouldOmit: (relativePath: string) => {
        if (relativePath.includes("!/")) throw new Error("simulated host failure while staging a member");
        return false;
      },
    };
    expect(() => acquireLocalSource({ path: root, scratchParent, omit: failing })).toThrow(/simulated host failure/);
    expect(fs.readdirSync(scratchParent)).toEqual([]);
    expect(treeSnapshot(root)).toEqual(before);
    expect([...seam.openDescriptors]).toEqual([]);
  });
});
