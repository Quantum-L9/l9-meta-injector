// local_source_qualification.test.ts — end-to-end proof on a realistic non-Git tree.
//
// The fixture is deliberately awkward rather than tidy: no `.git`, mixed text and
// binary, a nested directory, a symlink pointing outside the root, a credential
// file, a nested archive, and a user directory whose name collides with the
// superseded extraction convention. Every one of those was a way the previous
// behavior could damage or misreport a real drive.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { withLocalSourceModel } from "../src/local_source_model";
import { emitRepositoryModelBundle, validateRepositoryModelPacket } from "../src/repository_model";
import type { RepositoryModelPacket } from "../src/repository_model";
import { treeSnapshot, writeRawZip } from "./helpers/zip_fixtures";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-qualification-"));
}

const PRODUCER_VERSION = "4.0.0";

const PACKED_README = [
  "# Packed Service",
  "",
  "> **Status:** deprecated",
  "",
  "Replaced by Quantum-L9/successor-service",
  "",
].join("\n");

const PACKAGE_JSON = JSON.stringify(
  { name: "drive-fixture", version: "2.1.0", dependencies: { left_pad: "^1.0.0" } },
  null,
  2,
) + "\n";

/**
 * A drive-shaped tree: not a repository, not tidy, and containing every entry
 * class the acquisition layer has to survive.
 */
function buildDrive(outsideTarget: string): string {
  const root = tmp();
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "nested"), { recursive: true });

  fs.writeFileSync(path.join(root, "docs", "notes.md"), "# Field Notes\n\nordinary prose\n");
  fs.writeFileSync(path.join(root, "src", "nested", "util.py"), "def run():\n    return 1\n");
  fs.writeFileSync(path.join(root, "package.json"), PACKAGE_JSON);
  // Deterministic "binary": fixed bytes, so the fixture hashes identically twice.
  fs.writeFileSync(path.join(root, "docs", "photo.bin"), Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
  fs.writeFileSync(path.join(root, ".env"), "API_KEY=sk-live-abcdefghij0123456789\n");
  fs.symlinkSync(outsideTarget, path.join(root, "docs", "link-outside"));

  const staging = tmp();
  writeRawZip(path.join(staging, "inner.zip"), [{ name: "guide.md", content: "# Guide\n" }]);
  writeRawZip(path.join(root, "Bundle.zip"), [
    { name: "README.md", content: PACKED_README },
    { name: "inner.zip", content: fs.readFileSync(path.join(staging, "inner.zip")), stored: true },
  ]);

  // A user directory that merely happens to be named like an extraction target.
  fs.mkdirSync(path.join(root, "Bundle.l9extracted"), { recursive: true });
  fs.writeFileSync(path.join(root, "Bundle.l9extracted", "IMPORTANT_USER_DATA"), "irreplaceable\n");
  return root;
}

function observe(root: string): RepositoryModelPacket {
  return withLocalSourceModel(
    { path: root, name: "FieldDrive", producerVersion: PRODUCER_VERSION },
    (result) => result.packet,
  );
}

describe("qualification — a non-Git local directory", () => {
  test("observation is complete, read-only, and repeatable from a different path", () => {
    const outside = tmp();
    fs.writeFileSync(path.join(outside, "outside.txt"), "must not be read\n");

    const first = buildDrive(path.join(outside, "outside.txt"));
    const before = treeSnapshot(first);
    const firstPacket = observe(first);

    // 1. Nothing under the source changed.
    expect(treeSnapshot(first)).toEqual(before);
    // 2. The user directory named like an extraction target survived intact.
    expect(fs.readFileSync(path.join(first, "Bundle.l9extracted", "IMPORTANT_USER_DATA"), "utf8"))
      .toBe("irreplaceable\n");

    // 3. Every entry class is present, archives included, at machine-independent paths.
    expect(firstPacket.payload.artifacts.map((artifact) => artifact.source_path)).toEqual([
      ".env",
      "Bundle.l9extracted/IMPORTANT_USER_DATA",
      "Bundle.zip",
      "Bundle.zip!/README.md",
      "Bundle.zip!/inner.zip",
      "Bundle.zip!/inner.zip!/guide.md",
      "docs/link-outside",
      "docs/notes.md",
      "docs/photo.bin",
      "package.json",
      "src/nested/util.py",
    ]);

    // 4. The symlink was observed but not followed, so its target has no hash here.
    const link = firstPacket.payload.artifacts.find((a) => a.source_path === "docs/link-outside");
    expect(link?.content_hash).toBe("Unknown");
    expect(JSON.stringify(firstPacket)).not.toContain("must not be read");

    // 5. Producer-side validation passes.
    expect(validateRepositoryModelPacket(firstPacket).status).toBe("passed");

    // 6. The same bytes at a different absolute path produce the same identity.
    const second = buildDrive(path.join(outside, "outside.txt"));
    const secondPacket = observe(second);
    expect(secondPacket.source_snapshot.revision).toBe(firstPacket.source_snapshot.revision);
    expect(secondPacket.semantic_hash).toBe(firstPacket.semantic_hash);
    expect(secondPacket.packet_id).toBe(firstPacket.packet_id);
  });

  test("an assertion from an archive member cites the virtual locator, not a scratch path", () => {
    const outside = tmp();
    fs.writeFileSync(path.join(outside, "outside.txt"), "x\n");
    const root = buildDrive(path.join(outside, "outside.txt"));
    const packet = observe(root);

    const packed = packet.payload.assertions.filter(
      (assertion) => assertion.source_path === "Bundle.zip!/README.md",
    );
    expect(packed.length).toBeGreaterThan(0);
    expect(packed.map((assertion) => `${assertion.predicate}=${assertion.object}`))
      .toContain("repository.status=deprecated");

    for (const assertion of packed) {
      expect(assertion.source_content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(assertion.source_range.start_line).toBeGreaterThanOrEqual(1);
      expect(assertion.evidence_excerpt.length).toBeGreaterThan(0);
      expect(assertion.source_path).not.toContain(os.tmpdir());
    }

    // The full trace the contract requires: assertion -> member artifact ->
    // archive artifact -> the physical source file the archive is.
    const byPath = new Map(packet.payload.artifacts.map((a) => [a.source_path, a]));
    const member = byPath.get("Bundle.zip!/README.md");
    const archive = byPath.get("Bundle.zip");
    expect(member?.content_hash).toBe(packed[0].source_content_hash);
    const edge = packet.payload.relationships.find(
      (relationship) => relationship.source_id === member?.artifact_id
        && relationship.edge_type === "DERIVED_FROM",
    );
    expect(edge?.target_id).toBe(archive?.artifact_id);
    expect(edge?.properties.archive_digest).toBe(archive?.content_hash);

    // A manifest inside the physical tree is still interpreted normally.
    expect(packet.payload.assertions.some((a) => a.source_path === "package.json")).toBe(true);
  });

  test("a credential file is observed by hash and never interpreted", () => {
    const outside = tmp();
    fs.writeFileSync(path.join(outside, "outside.txt"), "x\n");
    const root = buildDrive(path.join(outside, "outside.txt"));
    const packet = observe(root);

    const env = packet.payload.artifacts.find((artifact) => artifact.source_path === ".env");
    expect(env?.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(packet.payload.assertions.some((a) => a.source_path === ".env")).toBe(false);
    expect(JSON.stringify(packet)).not.toContain("sk-live-abcdefghij0123456789");
  });

  test("the emitted bundle is a valid packet bundle", () => {
    const outside = tmp();
    fs.writeFileSync(path.join(outside, "outside.txt"), "x\n");
    const root = buildDrive(path.join(outside, "outside.txt"));
    const packet = observe(root);
    const before = treeSnapshot(root);

    const bundleRoot = path.join(tmp(), "bundle");
    const emitted = emitRepositoryModelBundle(packet, { outDir: bundleRoot });

    expect(treeSnapshot(root)).toEqual(before);
    expect(fs.existsSync(emitted.packetPath)).toBe(true);
    expect(fs.existsSync(emitted.receiptPath)).toBe(true);
    expect(fs.existsSync(emitted.manifestPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(emitted.packetPath, "utf8")) as RepositoryModelPacket;
    expect(written.packet_id).toBe(packet.packet_id);
    expect(validateRepositoryModelPacket(written).status).toBe("passed");
  });
});

describe("qualification — a standalone ZIP on a drive", () => {
  test("observing an archive adds nothing to its parent directory", () => {
    const parent = tmp();
    const staging = tmp();
    writeRawZip(path.join(staging, "inner.zip"), [{ name: "guide.md", content: "# Guide\n" }]);
    writeRawZip(path.join(parent, "Bundle.zip"), [
      { name: "README.md", content: PACKED_README },
      { name: "inner.zip", content: fs.readFileSync(path.join(staging, "inner.zip")), stored: true },
    ]);
    fs.writeFileSync(path.join(parent, "neighbor.txt"), "untouched\n");
    const before = treeSnapshot(parent);

    const packet = withLocalSourceModel(
      { path: path.join(parent, "Bundle.zip"), name: "Bundle", producerVersion: PRODUCER_VERSION },
      (result) => result.packet,
    );

    // No new file, no deleted file, no changed byte in the parent directory.
    expect(treeSnapshot(parent)).toEqual(before);
    expect(fs.readdirSync(parent).sort()).toEqual(["Bundle.zip", "neighbor.txt"]);

    expect(packet.source_snapshot.revision).toMatch(/^archive:sha256:[a-f0-9]{64}$/);
    expect(packet.payload.artifacts.map((artifact) => artifact.source_path)).toEqual([
      "Bundle.zip",
      "Bundle.zip!/README.md",
      "Bundle.zip!/inner.zip",
      "Bundle.zip!/inner.zip!/guide.md",
    ]);
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");

    // Provenance is complete for both nesting levels.
    const byPath = new Map(packet.payload.artifacts.map((a) => [a.source_path, a]));
    const chain = packet.payload.relationships
      .filter((edge) => edge.edge_type === "DERIVED_FROM")
      .map((edge) => [
        [...byPath.values()].find((a) => a.artifact_id === edge.source_id)?.source_path as string,
        [...byPath.values()].find((a) => a.artifact_id === edge.target_id)?.source_path as string,
      ])
      // Code-point order, not locale order: `localeCompare` would place
      // "README.md" after "inner.zip", which is the collation dependence this
      // package refuses everywhere else.
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    expect(chain).toEqual([
      ["Bundle.zip!/README.md", "Bundle.zip"],
      ["Bundle.zip!/inner.zip", "Bundle.zip"],
      ["Bundle.zip!/inner.zip!/guide.md", "Bundle.zip!/inner.zip"],
    ]);
  });

  test("observing the same archive twice is byte-identical", () => {
    const parent = tmp();
    writeRawZip(path.join(parent, "Bundle.zip"), [{ name: "README.md", content: PACKED_README }]);
    const run = (): RepositoryModelPacket => withLocalSourceModel(
      { path: path.join(parent, "Bundle.zip"), name: "Bundle", producerVersion: PRODUCER_VERSION },
      (result) => result.packet,
    );
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

describe("qualification — the committed golden local-source bundle", () => {
  const REPO = path.resolve(__dirname, "..");
  const SAMPLE = path.join(REPO, "fixtures", "local-source", "sample-source");
  const GOLDEN = path.join(REPO, "fixtures", "local-source", "expected-bundle");

  test("regenerates byte-for-byte from the committed sample source", () => {
    const before = treeSnapshot(SAMPLE);

    const packet = withLocalSourceModel(
      { path: SAMPLE, name: "sample-local-source", producerVersion: PRODUCER_VERSION },
      (result) => result.packet,
    );

    // Observing the committed fixture must not modify the repository.
    expect(treeSnapshot(SAMPLE)).toEqual(before);

    const emitted = path.join(tmp(), "bundle");
    emitRepositoryModelBundle(packet, { outDir: emitted });
    for (const relative of ["packet.json", "manifest.json", "receipts/validation-receipt.json"]) {
      expect(fs.readFileSync(path.join(emitted, relative), "utf8"))
        .toBe(fs.readFileSync(path.join(GOLDEN, relative), "utf8"));
    }
  });

  test("the golden bundle carries the archive provenance the consumer was proven against", () => {
    const packet = JSON.parse(fs.readFileSync(path.join(GOLDEN, "packet.json"), "utf8")) as RepositoryModelPacket;
    expect(packet.source_snapshot.revision).toMatch(/^fs:sha256:[a-f0-9]{64}$/);
    expect(packet.profile.id).toBe("meta-injector-local-source-observation");

    const byId = new Map(packet.payload.artifacts.map((artifact) => [artifact.artifact_id, artifact]));
    const chain = packet.payload.relationships
      .filter((edge) => edge.edge_type === "DERIVED_FROM")
      .map((edge) => [
        byId.get(edge.source_id)?.source_path as string,
        byId.get(edge.target_id)?.source_path as string,
      ])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    expect(chain).toEqual([
      ["Bundle.zip!/README.md", "Bundle.zip"],
      ["Bundle.zip!/inner.zip", "Bundle.zip"],
      ["Bundle.zip!/inner.zip!/guide.md", "Bundle.zip!/inner.zip"],
    ]);

    // The user directory named like an extraction target is observed, not excluded.
    expect(packet.payload.artifacts.map((artifact) => artifact.source_path))
      .toContain("Bundle.l9extracted/IMPORTANT_USER_DATA");
    // No scratch or absolute path survived into the committed bundle.
    expect(JSON.stringify(packet)).not.toContain(os.tmpdir());
    expect(JSON.stringify(packet)).not.toContain(REPO);
  });
});
