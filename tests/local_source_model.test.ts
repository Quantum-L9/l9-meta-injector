// local_source_model.test.ts — provenance, determinism, encoding and secret safety
// of the Repository Model Packet produced from a local source.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { acquireLocalSource } from "../src/local_source";
import {
  buildLocalSourceManifest,
  observeLocalSourceModel,
  withLocalSourceModel,
  writeLocalSourceManifest,
} from "../src/local_source_model";
import { validateRepositoryModelPacket } from "../src/repository_model";
import type { RepositoryModelPacket } from "../src/repository_model";
import { treeSnapshot, writeRawZip } from "./helpers/zip_fixtures";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-local-model-"));
}

const PRODUCER_VERSION = "4.0.0";

function nestedFixture(root: string): void {
  const staging = tmp();
  writeRawZip(path.join(staging, "inner.zip"), [{ name: "src/b.py", content: "print('b')\n" }]);
  writeRawZip(path.join(root, "outer.zip"), [
    { name: "docs/a.md", content: "# A\n" },
    { name: "inner.zip", content: fs.readFileSync(path.join(staging, "inner.zip")), stored: true },
  ]);
}

function packetFor(root: string, name = "fixture"): RepositoryModelPacket {
  return withLocalSourceModel(
    { path: root, name, producerVersion: PRODUCER_VERSION },
    (result) => result.packet,
  );
}

describe("archive provenance in the packet", () => {
  test("a nested archive keeps its whole ancestry chain", () => {
    const root = tmp();
    nestedFixture(root);
    const before = treeSnapshot(root);

    const packet = packetFor(root);

    expect(treeSnapshot(root)).toEqual(before);
    const paths = packet.payload.artifacts.map((artifact) => artifact.source_path);
    expect(paths).toEqual([
      "outer.zip",
      "outer.zip!/docs/a.md",
      "outer.zip!/inner.zip",
      "outer.zip!/inner.zip!/src/b.py",
    ]);

    const byId = new Map(packet.payload.artifacts.map((artifact) => [artifact.artifact_id, artifact]));
    // Relationships are ordered by edge id (a digest), so the assertion sorts by
    // the member path it is actually about.
    const derived = packet.payload.relationships
      .filter((edge) => edge.edge_type === "DERIVED_FROM")
      .map((edge) => [
        byId.get(edge.source_id)?.source_path as string,
        byId.get(edge.target_id)?.source_path as string,
        edge.properties.nested_depth,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(derived).toEqual([
      ["outer.zip!/docs/a.md", "outer.zip", 0],
      ["outer.zip!/inner.zip", "outer.zip", 0],
      ["outer.zip!/inner.zip!/src/b.py", "outer.zip!/inner.zip", 1],
    ]);
  });

  test("every member artifact carries an exact content hash", () => {
    const root = tmp();
    nestedFixture(root);
    const packet = packetFor(root);
    for (const artifact of packet.payload.artifacts) {
      expect(artifact.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  test("member identity binds the archive digest, member path and member bytes", () => {
    const root = tmp();
    nestedFixture(root);
    const packet = packetFor(root);
    const edge = packet.payload.relationships.find((relationship) =>
      relationship.edge_type === "DERIVED_FROM"
      && relationship.properties.member_path === "src/b.py");
    expect(edge).toBeDefined();
    expect(edge?.properties.archive_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(edge?.properties.member_id).toMatch(/^member:[a-f0-9]{64}$/);

    const evidence = packet.payload.evidence.find((record) =>
      record.evidence_id === edge?.evidence_refs[0]);
    expect(evidence?.field).toBe("derived_from");
    expect(evidence?.source_ref.source_path).toBe("outer.zip!/inner.zip!/src/b.py");
    expect(evidence?.source_ref.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("no scratch path or absolute path reaches the packet", () => {
    const root = tmp();
    nestedFixture(root);
    const observation = acquireLocalSource({ path: root });
    const scratchRoot = observation.scratchRoot;
    observation.dispose();

    const packet = packetFor(root);
    const serialized = JSON.stringify(packet);
    expect(serialized).not.toContain(scratchRoot);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("l9-local-source-");
    expect(serialized).not.toContain(os.tmpdir());
  });

  test("the packet passes producer-side validation", () => {
    const root = tmp();
    nestedFixture(root);
    fs.writeFileSync(path.join(root, "README.md"), "# Fixture\n");
    const result = validateRepositoryModelPacket(packetFor(root));
    const failures = result.checks.filter((check) => check.status !== "passed");
    expect(failures.map((check) => `${check.check_id}: ${check.message}`)).toEqual([]);
    expect(result.status).toBe("passed");
  });

  test("a held archive is reported and no member is claimed", () => {
    const root = tmp();
    writeRawZip(path.join(root, "Evil.zip"), [{ name: "../escape.txt", content: "no" }]);
    const packet = packetFor(root);
    expect(packet.payload.artifacts.map((artifact) => artifact.source_path)).toEqual(["Evil.zip"]);
    expect(packet.payload.diagnostics.some((diagnostic) => diagnostic.code === "archive-held")).toBe(true);
    expect(packet.payload.relationships.some((edge) => edge.edge_type === "DERIVED_FROM")).toBe(false);
  });
});

describe("local-source packet identity", () => {
  test("the packet declares a local-source profile and never claims a Git repository", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    const packet = packetFor(root);
    expect(packet.profile.id).toBe("meta-injector-local-source-observation");
    expect(packet.source_snapshot.revision).toMatch(/^fs:sha256:/);
    expect(packet.payload.repositories[0].primary_role).toBe("unknown");
    const declared = packet.payload.diagnostics.find((d) => d.code === "local-source-observation");
    expect(declared?.details?.source_kind).toBe("directory");
    expect(declared?.message).toContain("no Git repository is claimed");
  });

  test("a single file is supported and revised by its own bytes", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "design.md"), "# Design\n");
    const packet = withLocalSourceModel(
      { path: path.join(root, "design.md"), name: "design", producerVersion: PRODUCER_VERSION },
      (result) => result.packet,
    );
    expect(packet.source_snapshot.revision).toMatch(/^file:sha256:[a-f0-9]{64}$/);
    expect(packet.payload.artifacts.map((artifact) => artifact.source_path)).toEqual(["design.md"]);
  });

  test("a standalone archive is revised by its archive bytes", () => {
    const root = tmp();
    writeRawZip(path.join(root, "Bundle.zip"), [{ name: "a.md", content: "# A\n" }]);
    const packet = withLocalSourceModel(
      { path: path.join(root, "Bundle.zip"), name: "Bundle", producerVersion: PRODUCER_VERSION },
      (result) => result.packet,
    );
    expect(packet.source_snapshot.revision).toMatch(/^archive:sha256:[a-f0-9]{64}$/);
    expect(packet.payload.artifacts.map((artifact) => artifact.source_path))
      .toEqual(["Bundle.zip", "Bundle.zip!/a.md"]);
  });

  test("identical bytes at a different absolute path yield an identical packet", () => {
    const build = (): RepositoryModelPacket => {
      const root = tmp();
      nestedFixture(root);
      fs.mkdirSync(path.join(root, "docs"), { recursive: true });
      fs.writeFileSync(path.join(root, "docs", "guide.md"), "# Guide\n");
      return packetFor(root, "fixture");
    };
    const first = build();
    const second = build();
    expect(second.source_snapshot.revision).toBe(first.source_snapshot.revision);
    expect(second.semantic_hash).toBe(first.semantic_hash);
    expect(second.packet_id).toBe(first.packet_id);
  });

  test("repeating an observation of the same tree is byte-stable", () => {
    const root = tmp();
    nestedFixture(root);
    const first = packetFor(root);
    const second = packetFor(root);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("repacking an archive changes the physical revision", () => {
    const root = tmp();
    writeRawZip(path.join(root, "Bundle.zip"), [{ name: "a.md", content: "# A\n" }]);
    const first = packetFor(root);
    // Same member semantics, different archive bytes.
    writeRawZip(path.join(root, "Bundle.zip"), [
      { name: "a.md", content: "# A\n", stored: true },
    ]);
    const second = packetFor(root);
    expect(second.source_snapshot.revision).not.toBe(first.source_snapshot.revision);
    const memberHash = (packet: RepositoryModelPacket): string | undefined =>
      packet.payload.artifacts.find((a) => a.source_path === "Bundle.zip!/a.md")?.content_hash;
    // The member's own bytes did not change, so its content identity did not either.
    expect(memberHash(second)).toBe(memberHash(first));
  });

  test("an unstable observation refuses to produce a packet", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    expect(() => observeLocalSourceModel({
      path: root,
      producerVersion: PRODUCER_VERSION,
      omit: {
        patterns: [],
        shouldOmit(relative: string): boolean {
          if (relative === "a.md" && !fs.existsSync(path.join(root, "late.md"))) {
            fs.writeFileSync(path.join(root, "late.md"), "# Late\n");
          }
          return false;
        },
      },
    })).toThrow(/SOURCE_CHANGED_DURING_OBSERVATION/);
  });

  test("a missing required content hash blocks the canonical packet", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "big.md"), "x".repeat(4096));
    expect(() => observeLocalSourceModel({
      path: root,
      producerVersion: PRODUCER_VERSION,
      hashMaxBytes: 64,
    })).toThrow(/required content hash is missing/);
  });
});

describe("encoding safety", () => {
  function encodingFixture(root: string): void {
    fs.writeFileSync(path.join(root, "utf8.md"), "# Café\n\nplain UTF-8\n");
    fs.writeFileSync(path.join(root, "bom.md"), Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# BOM\n\nwith byte-order mark\n", "utf8"),
    ]));
    // A Windows-1252 file whose first bytes are ASCII: a prefix probe would pass
    // it. Named README.md so an extractor claims it and the refusal is observable
    // in the interpretation diagnostics rather than only in acquisition.
    fs.writeFileSync(path.join(root, "README.md"), Buffer.concat([
      Buffer.from("# Heading\n\nStatus: active\n\n".repeat(10), "utf8"),
      Buffer.from([0x93, 0x63, 0x75, 0x72, 0x6c, 0x79, 0x94, 0x0a]),
    ]));
    fs.writeFileSync(path.join(root, "invalid.py"), Buffer.from([
      0x70, 0x72, 0x69, 0x6e, 0x74, 0x28, 0x27, 0xff, 0xfe, 0x27, 0x29, 0x0a,
    ]));
    fs.writeFileSync(path.join(root, "binary.txt"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
  }

  test("an invalid encoding is hashed, diagnosed, never rewritten and never interpreted", () => {
    const root = tmp();
    encodingFixture(root);
    const before = treeSnapshot(root);

    const result = withLocalSourceModel(
      { path: root, name: "encodings", producerVersion: PRODUCER_VERSION },
      (built) => ({
        packet: built.packet,
        interpretation: built.interpretation,
        diagnostics: built.observation.diagnostics,
      }),
    );

    expect(treeSnapshot(root)).toEqual(before);

    const byPath = new Map(result.packet.payload.artifacts.map((a) => [a.source_path, a]));
    for (const name of ["utf8.md", "bom.md", "README.md", "invalid.py", "binary.txt"]) {
      expect(byPath.get(name)?.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    }

    const unsupported = result.diagnostics
      .filter((d) => d.code === "local-source.unsupported_encoding")
      .map((d) => d.sourcePath)
      .sort();
    expect(unsupported).toEqual(["README.md", "invalid.py"]);

    // A known-text extension does not buy an interpretation pass. README.md, the
    // .py and the .txt are all claimed by extractors, and all three are refused
    // on their bytes rather than on their names.
    const interpretedPaths = new Set(result.interpretation?.assertions.map((a) => a.source_path) ?? []);
    expect(interpretedPaths.has("README.md")).toBe(false);
    expect(interpretedPaths.has("invalid.py")).toBe(false);
    expect(interpretedPaths.has("binary.txt")).toBe(false);
    const refused = (result.interpretation?.diagnostics ?? [])
      .filter((d) => d.code === "interpretation.unsupported_encoding")
      .map((d) => d.source_path)
      .sort();
    expect(refused).toEqual(["README.md", "binary.txt", "invalid.py"]);
  });

  test("a UTF-8 BOM file is valid and stays observable", () => {
    const root = tmp();
    encodingFixture(root);
    const observation = acquireLocalSource({ path: root });
    try {
      const bom = observation.inventory.records.find((r) => r.relative_path === "bom.md");
      expect(bom?.content_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(bom?.unknowns).not.toContain("unsupported_encoding");
    } finally {
      observation.dispose();
    }
  });
});

describe("secret safety", () => {
  test("secret archive members are hashed but never interpreted or excerpted", () => {
    const root = tmp();
    writeRawZip(path.join(root, "Secrets.zip"), [
      { name: ".env", content: "API_KEY=sk-live-0123456789abcdefghij\n" },
      { name: "secrets.pem", content: "-----BEGIN RSA PRIVATE KEY-----\nMIIEabcdefgh\n-----END RSA PRIVATE KEY-----\n" },
      { name: "app.json", content: '{"name":"app","version":"1.0.0"}\n' },
    ]);

    const result = withLocalSourceModel(
      { path: root, name: "secrets", producerVersion: PRODUCER_VERSION },
      (built) => ({ packet: built.packet, observation: built.observation }),
    );

    const byPath = new Map(result.packet.payload.artifacts.map((a) => [a.source_path, a]));
    // Observation is allowed: path, size and hash. Content is not.
    expect(byPath.get("Secrets.zip!/.env")?.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(byPath.get("Secrets.zip!/secrets.pem")?.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const serialized = JSON.stringify(result.packet);
    expect(serialized).not.toContain("sk-live-0123456789abcdefghij");
    expect(serialized).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(serialized).not.toContain("MIIEabcdefgh");

    const excerpts = result.packet.payload.assertions.map((assertion) => assertion.evidence_excerpt);
    expect(excerpts.some((excerpt) => excerpt.includes("sk-live"))).toBe(false);
    for (const assertion of result.packet.payload.assertions) {
      expect(assertion.source_path).not.toContain(".env");
      expect(assertion.source_path).not.toContain(".pem");
    }
  });

  test("the acquisition manifest carries paths and digests, never content", () => {
    const root = tmp();
    writeRawZip(path.join(root, "Secrets.zip"), [
      { name: ".env", content: "API_KEY=sk-live-0123456789abcdefghij\n" },
    ]);
    const observation = acquireLocalSource({ path: root });
    try {
      const manifest = buildLocalSourceManifest(observation, { observedAt: "2026-01-01T00:00:00.000Z" });
      const serialized = JSON.stringify(manifest);
      expect(serialized).not.toContain("sk-live-0123456789abcdefghij");
      expect(manifest.source_mutated).toBe(false);
      expect(manifest.members[0].virtual_source_path).toBe("Secrets.zip!/.env");
      expect(manifest.members[0].member_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(manifest.archive_policy.version).toBe("1");
    } finally {
      observation.dispose();
    }
  });
});

describe("acquisition manifest placement", () => {
  test("writing the manifest inside the observed tree is refused", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    const observation = acquireLocalSource({ path: root });
    try {
      const manifest = buildLocalSourceManifest(observation, { observedAt: "2026-01-01T00:00:00.000Z" });
      expect(() => writeLocalSourceManifest(manifest, path.join(root, "manifest.json"), root))
        .toThrow(/refusing to write the acquisition manifest inside the observed source tree/);
      expect(() => writeLocalSourceManifest(manifest, path.join(root, "deep", "manifest.json"), root))
        .toThrow(/refusing to write/);

      const out = tmp();
      const written = writeLocalSourceManifest(manifest, path.join(out, "local-source-manifest.json"), root);
      expect(fs.existsSync(written)).toBe(true);
      expect(fs.readdirSync(root)).toEqual(["a.md"]);
    } finally {
      observation.dispose();
    }
  });

  test("the observation timestamp never participates in packet identity", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    const first = withLocalSourceModel(
      { path: root, name: "fixture", producerVersion: PRODUCER_VERSION, generatedAt: "2020-01-01T00:00:00.000Z" },
      (result) => result.packet,
    );
    const second = withLocalSourceModel(
      { path: root, name: "fixture", producerVersion: PRODUCER_VERSION, generatedAt: "2031-06-06T12:00:00.000Z" },
      (result) => result.packet,
    );
    expect(second.semantic_hash).toBe(first.semantic_hash);
    expect(second.packet_id).toBe(first.packet_id);
  });
});
