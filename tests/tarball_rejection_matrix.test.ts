// tarball_rejection_matrix.test.ts — TAR and compressed tarballs are never opened.
//
// There is no TAR reader in this package, and that is a decision (ADR-036), not
// an omission. The obligation that follows is that every tarball — benign,
// hostile, truncated, disguised — receives one explicit, identical disposition:
// classified as an archive, hashed, reported as not expanded, no member claimed,
// nothing extracted, nothing written under or beside the source. This file is
// that obligation as executable evidence, across every spelling of the format.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { acquireLocalSource } from "../src/local_source";
import { expandArchivesUnderRoot } from "../src/archives";
import { discoverFiles } from "../src/retrieval";
import { inventoryTree } from "../src/inventory";
import { sniffArchiveSignature, KNOWN_UNEXPANDABLE_ARCHIVE_EXTENSIONS } from "../src/archive_formats";
import { treeSnapshot, writeRawZip } from "./helpers/zip_fixtures";
import { benignTar, gzipTar, hostileTarCorpus, signedBody, tarBytes } from "./helpers/tar_fixtures";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-tarball-"));
}

/** Observe a root and dispose the scratch, returning what was claimed. */
function observe(root: string) {
  const scratchParent = tmp();
  const observation = acquireLocalSource({ path: root, scratchParent });
  const out = {
    records: observation.inventory.records.filter((r) => r.artifact_type !== "folder"),
    archives: observation.archives,
    members: observation.virtualArtifacts,
    diagnostics: observation.diagnostics,
    stable: observation.stable,
  };
  observation.dispose();
  expect(fs.readdirSync(scratchParent), "scratch must be gone after dispose").toEqual([]);
  return out;
}

const SPELLINGS: Array<{ name: string; body: () => Buffer }> = [
  { name: "bundle.tar", body: benignTar },
  { name: "bundle.tar.gz", body: () => gzipTar(benignTar()) },
  { name: "bundle.tgz", body: () => gzipTar(benignTar()) },
  { name: "bundle.tar.bz2", body: () => signedBody("bzip2", benignTar()) },
  { name: "bundle.tbz", body: () => signedBody("bzip2", benignTar()) },
  { name: "bundle.tbz2", body: () => signedBody("bzip2", benignTar()) },
  { name: "bundle.tar.xz", body: () => signedBody("xz", benignTar()) },
  { name: "bundle.txz", body: () => signedBody("xz", benignTar()) },
  { name: "bundle.tar.zst", body: () => signedBody("zstd", benignTar()) },
  { name: "bundle.tzst", body: () => signedBody("zstd", benignTar()) },
];

describe("tarball rejection matrix — every spelling has the same explicit disposition", () => {
  for (const spelling of SPELLINGS) {
    test(`${spelling.name} is classified, hashed, reported, and never opened`, () => {
      const root = tmp();
      const outside = tmp();
      fs.writeFileSync(path.join(root, spelling.name), spelling.body());
      const before = treeSnapshot(root);
      const outcome = observe(root);
      expect(treeSnapshot(root)).toEqual(before);
      expect(fs.readdirSync(outside)).toEqual([]);
      expect(outcome.records.map((r) => [r.relative_path, r.artifact_type])).toEqual([[spelling.name, "archive"]]);
      expect(outcome.records[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(outcome.archives).toEqual([]);
      expect(outcome.members).toEqual([]);
      expect(outcome.diagnostics.map((d) => d.code)).toContain("archive.format_not_expanded");
      expect(outcome.stable).toBe(true);
    });
  }

  test("the extensions the matrix covers are the ones the format owner declares unexpandable", () => {
    for (const spelling of SPELLINGS) {
      expect(KNOWN_UNEXPANDABLE_ARCHIVE_EXTENSIONS.has(path.extname(spelling.name))).toBe(true);
    }
  });
});

describe("tarball rejection matrix — hostile shapes", () => {
  const corpus = hostileTarCorpus();
  for (const [name, body] of Object.entries(corpus)) {
    test(`${name} is held closed: nothing extracted, nothing escapes`, () => {
      const parent = tmp();
      const root = path.join(parent, "src");
      fs.mkdirSync(root);
      fs.writeFileSync(path.join(root, name), body);
      const before = treeSnapshot(parent);
      const outcome = observe(root);
      expect(treeSnapshot(parent)).toEqual(before);
      expect(fs.existsSync(path.join(parent, "outside"))).toBe(false);
      expect(fs.existsSync(path.join(parent, "escape.txt"))).toBe(false);
      expect(outcome.archives).toEqual([]);
      expect(outcome.members).toEqual([]);
      expect(outcome.records).toHaveLength(1);
      expect(outcome.records[0].artifact_type).toBe("archive");
      expect(outcome.diagnostics.map((d) => d.code)).toContain("archive.format_not_expanded");
    });
  }
});

describe("tarball rejection matrix — disguises", () => {
  test("a tar named .zip is held as an unreadable ZIP, not opened as a tar", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "bundle.zip"), benignTar());
    const before = treeSnapshot(root);
    const outcome = observe(root);
    expect(treeSnapshot(root)).toEqual(before);
    expect(outcome.archives).toHaveLength(1);
    expect(outcome.archives[0].expanded).toBe(false);
    expect(outcome.archives[0].holds.map((h) => h.code)).toEqual(["archive.format_unreadable"]);
    expect(outcome.members).toEqual([]);
  });

  test("an extensionless tarball and a tar named .txt are diagnosed by signature, not silently passed", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "bundle"), benignTar());
    fs.writeFileSync(path.join(root, "notes.txt"), gzipTar(benignTar()));
    const outcome = observe(root);
    const byPath = new Map(outcome.records.map((r) => [r.relative_path, r]));
    expect(byPath.get("bundle")?.unknowns).toContain("archive_signature:tar");
    expect(byPath.get("notes.txt")?.unknowns).toContain("archive_signature:gzip");
    const signatures = outcome.diagnostics.filter((d) => d.code === "local-source.archive_signature_detected");
    expect(signatures.map((d) => d.sourcePath).sort()).toEqual(["bundle", "notes.txt"]);
    expect(outcome.archives).toEqual([]);
    expect(outcome.members).toEqual([]);
  });

  test("a ZIP container that is a document by format is not reported as a disguised archive", () => {
    const root = tmp();
    writeRawZip(path.join(root, "report.docx"), [{ name: "word/document.xml", content: "<w:document/>" }]);
    const outcome = observe(root);
    expect(outcome.diagnostics.map((d) => d.code)).not.toContain("local-source.archive_signature_detected");
  });

  test("a tarball nested inside a ZIP is a virtual archive member that is not opened", () => {
    const root = tmp();
    writeRawZip(path.join(root, "outer.zip"), [
      { name: "inner.tar", content: benignTar(), stored: true },
      { name: "inner.tgz", content: gzipTar(benignTar()), stored: true },
      { name: "disguised.bin", content: benignTar(), stored: true },
    ]);
    const outcome = observe(root);
    expect(outcome.archives).toHaveLength(1);
    expect(outcome.archives[0].expanded).toBe(true);
    const members = new Map(outcome.records.filter((r) => r.relative_path.includes("!/")).map((r) => [r.relative_path, r]));
    expect(members.get("outer.zip!/inner.tar")?.artifact_type).toBe("archive");
    expect(members.get("outer.zip!/inner.tgz")?.artifact_type).toBe("archive");
    expect(members.get("outer.zip!/disguised.bin")?.unknowns).toContain("archive_signature:tar");
    const notExpanded = outcome.diagnostics.filter((d) => d.code === "archive.format_not_expanded").map((d) => d.sourcePath).sort();
    expect(notExpanded).toEqual(["outer.zip!/inner.tar", "outer.zip!/inner.tgz"]);
    // The nested tarballs are exactly one level deep: nothing beneath them exists.
    expect(outcome.records.some((r) => r.relative_path.includes("inner.tar!/"))).toBe(false);
  });

  test("the signature probe recognizes each container and nothing else", () => {
    expect(sniffArchiveSignature(benignTar())).toBe("tar");
    expect(sniffArchiveSignature(gzipTar(benignTar()))).toBe("gzip");
    expect(sniffArchiveSignature(signedBody("bzip2", benignTar()))).toBe("bzip2");
    expect(sniffArchiveSignature(signedBody("xz", benignTar()))).toBe("xz");
    expect(sniffArchiveSignature(signedBody("zstd", benignTar()))).toBe("zstd");
    expect(sniffArchiveSignature(Buffer.from("# just markdown\n"))).toBeNull();
    expect(sniffArchiveSignature(Buffer.alloc(0))).toBeNull();
    // A v7 tar without the ustar magic is a documented non-detection.
    const v7 = tarBytes([{ name: "a", content: "x" }]);
    v7.fill(0, 257, 263);
    expect(sniffArchiveSignature(v7)).toBeNull();
  });
});

describe("tarball rejection matrix — the other ingestion surfaces agree", () => {
  test("local-files materialization never selects a tarball", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "bundle.tar"), benignTar());
    fs.writeFileSync(path.join(root, "bundle.tgz"), gzipTar(benignTar()));
    const before = treeSnapshot(root);
    const result = expandArchivesUnderRoot(root, { dryRun: false, verbose: false });
    expect(result.archives).toEqual([]);
    expect(treeSnapshot(root)).toEqual(before);
  });

  test("pipeline discovery records every tarball spelling as a known binary", () => {
    const root = tmp();
    for (const spelling of SPELLINGS) fs.writeFileSync(path.join(root, spelling.name), spelling.body());
    const discovery = discoverFiles(root, "**/*");
    expect(discovery.files).toEqual([]);
    const dispositions = discovery.summary.entries.filter((e) => e.kind === "file").map((e) => e.disposition);
    expect(new Set(dispositions)).toEqual(new Set(["known_binary"]));
  });

  test("inventory classifies every tarball spelling as an archive and hashes it", () => {
    const root = tmp();
    for (const spelling of SPELLINGS) fs.writeFileSync(path.join(root, spelling.name), spelling.body());
    const result = inventoryTree({ root, outDir: path.join(tmp(), "out"), dryRun: true });
    for (const record of result.records) {
      expect(record.artifact_type).toBe("archive");
      expect(record.content_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
