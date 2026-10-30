// local_source_regular_files.test.ts — local-source acquisition opens only files it
// has proved to be regular, and never blocks on what it finds (RC-043, RC-044).
//
// Ownership markers and single-file sources are untrusted source content: a FIFO
// would block a reading open forever, a symlink would be followed outside the
// source, and an endless device would be read without bound. Where a pre-fix run
// could otherwise hang, a short-lived feeder process writes into the FIFO so that
// the defect surfaces as a wrong answer instead of a hung suite.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { extractionRefusalReason } from "../src/archives";
import {
  EXTRACTION_OWNER_ID,
  LEGACY_EXTRACTION_OWNER_FILE,
  LOCAL_FILES_EXTRACTION_SCHEMA,
  acquireLocalSource,
  hasLegacyExtractionOwnership,
  hashFileStreaming,
} from "../src/local_source";
import { treeSnapshot, writeRawZip } from "./helpers/zip_fixtures";

const seam = vi.hoisted(() => ({
  /**
   * Every object a successful open or whole-file read actually reached, by real
   * path, so that following a symlink shows up as the link's target.
   */
  opened: [] as string[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const reached = (target: unknown): void => {
    try {
      seam.opened.push(actual.realpathSync(String(target)));
    } catch {
      // Unresolvable: nothing was reached through it.
    }
  };
  const openSync = ((target: fs.PathLike, ...rest: unknown[]) => {
    const fd = (actual.openSync as (...args: unknown[]) => number)(target, ...rest);
    reached(target);
    return fd;
  }) as typeof fs.openSync;
  const readFileSync = ((target: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    const result = (actual.readFileSync as (...args: unknown[]) => unknown)(target, ...rest);
    if (typeof target !== "number") reached(target);
    return result;
  }) as typeof fs.readFileSync;
  const patched = { openSync, readFileSync };
  return { ...actual, ...patched, default: { ...actual, ...patched } };
});

const roots: string[] = [];
const feeders: ChildProcess[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-regular-files-"));
  roots.push(dir);
  return dir;
}

function mkfifo(target: string): boolean {
  try {
    execFileSync("mkfifo", [target]);
    return true;
  } catch {
    return false;
  }
}

/** Keep writing `content` into a FIFO, so a blocking reader would get bytes rather than hang. */
function feed(fifo: string, content: string): void {
  const child = spawn("sh", ["-c", 'while true; do printf "%s" "$2" > "$1" 2>/dev/null; done', "feeder", fifo, content], {
    stdio: "ignore",
  });
  feeders.push(child);
}

afterEach(() => {
  seam.opened = [];
  for (const child of feeders.splice(0)) child.kill("SIGKILL");
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const posixOnly = process.platform === "win32" ? test.skip : test;

function ownedExtraction(root: string): string {
  writeRawZip(path.join(root, "X.zip"), [{ name: "a.md", content: "# A\n" }]);
  const generated = path.join(root, "X.l9extracted");
  fs.mkdirSync(generated);
  fs.writeFileSync(path.join(generated, "user-data.txt"), "mine\n");
  return generated;
}

function validV2Marker(archive: string): Record<string, string> {
  return {
    schema: LOCAL_FILES_EXTRACTION_SCHEMA,
    owner: EXTRACTION_OWNER_ID,
    archive,
    archive_sha256: `sha256:${"a".repeat(64)}`,
    reader_version: "1",
    policy_fingerprint: `lap1:${"b".repeat(64)}`,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("ownership markers are read only from verified regular files (RC-043)", () => {
  posixOnly("REG-WU-033-RC-043-a: a FIFO marker is not ownership and acquisition does not block", () => {
    const root = tmp();
    const generated = ownedExtraction(root);
    const marker = path.join(generated, LEGACY_EXTRACTION_OWNER_FILE);
    if (!mkfifo(marker)) return;
    feed(marker, JSON.stringify({ owner: EXTRACTION_OWNER_ID, archive: "X.zip" }));

    const started = Date.now();
    const observation = acquireLocalSource({ path: root, scratchParent: tmp() });
    try {
      expect(Date.now() - started).toBeLessThan(10_000);
      const paths = observation.inventory.records.map((record) => record.relative_path);
      expect(paths).toContain("X.l9extracted/user-data.txt");
      expect(paths).toContain(`X.l9extracted/${LEGACY_EXTRACTION_OWNER_FILE}`);
      expect(observation.diagnostics.map((d) => d.code)).not.toContain("local-source.legacy_extraction_excluded");
    } finally {
      observation.dispose();
    }
  });

  posixOnly("REG-WU-033-RC-043-b: a symlinked marker is never followed", () => {
    const root = tmp();
    const outside = path.join(tmp(), "outside-marker.json");
    fs.writeFileSync(outside, JSON.stringify({ owner: EXTRACTION_OWNER_ID, archive: "X.zip" }));
    const generated = ownedExtraction(root);
    fs.symlinkSync(outside, path.join(generated, LEGACY_EXTRACTION_OWNER_FILE));

    const observation = acquireLocalSource({ path: root, scratchParent: tmp() });
    try {
      const paths = observation.inventory.records.map((record) => record.relative_path);
      expect(paths).toContain("X.l9extracted/user-data.txt");
      expect(observation.diagnostics.map((d) => d.code)).not.toContain("local-source.legacy_extraction_excluded");
    } finally {
      observation.dispose();
    }
    // A no-follow open of the link fails on the link itself, so a successful read
    // of the outside file is impossible; a whole-file read of it must never happen.
    expect(seam.opened.filter((opened) => opened === fs.realpathSync(outside))).toEqual([]);
    expect(hasLegacyExtractionOwnership(generated)).toBe(false);
  });

  test("REG-WU-033-RC-043-c: a regular-file marker with the exact owner still excludes the extraction", () => {
    const root = tmp();
    const generated = ownedExtraction(root);
    fs.writeFileSync(
      path.join(generated, LEGACY_EXTRACTION_OWNER_FILE),
      JSON.stringify({ owner: EXTRACTION_OWNER_ID, archive: "X.zip" }),
    );
    const before = treeSnapshot(root);
    const observation = acquireLocalSource({ path: root, scratchParent: tmp() });
    try {
      const paths = observation.inventory.records.map((record) => record.relative_path);
      expect(paths.some((value) => value.startsWith("X.l9extracted"))).toBe(false);
      expect(observation.diagnostics.map((d) => d.code)).toContain("local-source.legacy_extraction_excluded");
    } finally {
      observation.dispose();
    }
    expect(treeSnapshot(root)).toEqual(before);
  });

  test("REG-WU-033-RC-043-d: an oversize marker is not ownership and is not read whole", () => {
    const root = tmp();
    const generated = ownedExtraction(root);
    const marker = path.join(generated, LEGACY_EXTRACTION_OWNER_FILE);
    // Valid JSON naming the exact owner, padded far past any sane marker size.
    fs.writeFileSync(marker, `{"owner":"${EXTRACTION_OWNER_ID}"${" ".repeat(4 * 1024 * 1024)}}`);
    expect(hasLegacyExtractionOwnership(generated)).toBe(false);
    expect(seam.opened.filter((opened) => opened === fs.realpathSync(marker)).length).toBeLessThanOrEqual(1);
  });

  posixOnly("REG-WU-033-RC-043-e: a symlinked v2 marker grants no destructive authority", () => {
    const root = tmp();
    const zip = path.join(root, "X.zip");
    writeRawZip(zip, [{ name: "a.md", content: "# A\n" }]);
    const target = path.join(root, "X");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "user-data.txt"), "mine\n");
    const elsewhere = path.join(tmp(), "valid-v2-marker.json");
    fs.writeFileSync(elsewhere, JSON.stringify(validV2Marker("X.zip")));
    fs.symlinkSync(elsewhere, path.join(target, LEGACY_EXTRACTION_OWNER_FILE));
    const before = treeSnapshot(root);

    const reason = extractionRefusalReason(target, zip);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/never (replaced|removed)/);
    expect(treeSnapshot(root)).toEqual(before);
  });

  test("REG-WU-033-RC-043-f: a regular v2 marker still authorizes the refresh", () => {
    const root = tmp();
    const zip = path.join(root, "X.zip");
    writeRawZip(zip, [{ name: "a.md", content: "# A\n" }]);
    const target = path.join(root, "X");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, LEGACY_EXTRACTION_OWNER_FILE), JSON.stringify(validV2Marker("X.zip")));
    expect(extractionRefusalReason(target, zip)).toBeNull();
  });
});

describe("hashing opens only verified regular files (RC-044)", () => {
  posixOnly("REG-WU-033-RC-044-a: a FIFO source path is refused promptly and writes nothing", () => {
    const root = tmp();
    const scratchParent = tmp();
    const fifo = path.join(root, "notes.md");
    if (!mkfifo(fifo)) return;
    feed(fifo, "# notes\n");
    const started = Date.now();
    expect(() => acquireLocalSource({ path: fifo, scratchParent })).toThrow(/local-source: .*not a regular file/);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(fs.readdirSync(scratchParent)).toEqual([]);
  });

  posixOnly("REG-WU-033-RC-044-b: hashFileStreaming refuses a FIFO promptly", () => {
    const root = tmp();
    const fifo = path.join(root, "pipe");
    if (!mkfifo(fifo)) return;
    feed(fifo, "bytes\n");
    expect(() => hashFileStreaming(fifo)).toThrow(/not a regular file/);
  });

  posixOnly("REG-WU-033-RC-044-b: hashFileStreaming refuses an endless device promptly", () => {
    if (!fs.existsSync("/dev/zero")) return;
    const started = Date.now();
    expect(() => hashFileStreaming("/dev/zero")).toThrow(/not a regular file/);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  posixOnly("REG-WU-033-RC-044-c: a file replaced by a FIFO before hashing makes the observation unstable", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    fs.writeFileSync(path.join(root, "z.md"), "# Z\n");
    if (!mkfifo(path.join(root, "probe"))) return;
    fs.rmSync(path.join(root, "probe"));
    let swapped = false;
    const omit = {
      patterns: [],
      shouldOmit: (relativePath: string) => {
        // `a.md` is already enumerated as a regular file when `z.md` is consulted.
        if (relativePath === "z.md" && !swapped) {
          swapped = true;
          fs.rmSync(path.join(root, "a.md"));
          execFileSync("mkfifo", [path.join(root, "a.md")]);
        }
        return false;
      },
    };
    const started = Date.now();
    const observation = acquireLocalSource({ path: root, scratchParent: tmp(), omit });
    try {
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(observation.stable).toBe(false);
    } finally {
      observation.dispose();
    }
  });

  posixOnly("REG-WU-033-RC-044-d: a FIFO inside a directory source is still recorded as a special entry", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "README.md"), "# Fixture\n");
    if (!mkfifo(path.join(root, "pipe"))) return;
    const observation = acquireLocalSource({ path: root, scratchParent: tmp() });
    try {
      const record = observation.inventory.records.find((r) => r.relative_path === "pipe");
      expect(record?.unknowns).toContain("special_filesystem_entry");
      expect(observation.stable).toBe(true);
    } finally {
      observation.dispose();
    }
  });

  test("REG-WU-033-RC-044-e: regular single-file and archive sources keep their content revisions", () => {
    const root = tmp();
    const file = path.join(root, "only.md");
    fs.writeFileSync(file, "# only\n");
    const zip = path.join(root, "Bundle.zip");
    writeRawZip(zip, [{ name: "a.md", content: "# A\n" }]);
    const digest = (target: string): string =>
      crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");

    const single = acquireLocalSource({ path: file, scratchParent: tmp() });
    try {
      expect(single.sourceRevision).toBe(`file:sha256:${digest(file)}`);
    } finally {
      single.dispose();
    }
    const archive = acquireLocalSource({ path: zip, scratchParent: tmp() });
    try {
      expect(archive.sourceRevision).toBe(`archive:sha256:${digest(zip)}`);
    } finally {
      archive.dispose();
    }
  });
});
