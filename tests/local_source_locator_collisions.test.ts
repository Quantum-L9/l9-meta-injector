// local_source_locator_collisions.test.ts — WU-034 (ADR-063): a virtual member
// locator `<archive>!/<member>` names exactly one thing.
//
// The separator `!/` is legal in filesystem names and in ZIP member names, so a
// physical directory `a.zip!/` beside `a.zip`, or a member literally named
// `in.zip!/y.txt` beside a nested `in.zip`, used to mint a second record at an
// existing locator: duplicate artifact ids and a packet the producer's own
// validator refused. The format is kept; an archive whose expansion would mint an
// ambiguous locator is held with `archive.locator_ambiguous`, and archive ancestry
// is derived from the observation's parent chain instead of from splitting names.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { runCorpusScan } from "../src/corpus_scan";
import { acquireLocalSource, memberArchiveAncestry } from "../src/local_source";
import { buildLocalSourceCorpus, withLocalSourceModel } from "../src/local_source_model";
import { emitRepositoryModelBundle, validateRepositoryModelPacket } from "../src/repository_model";
import { treeSnapshot, writeRawZip } from "./helpers/zip_fixtures";

/** What the two projections were handed: semantic archive ancestry and readiness archive ids. */
const semanticAncestry = new Map<string, string[]>();
const readinessArchiveIds = new Map<string, string | null | undefined>();

vi.mock("../src/corpus_semantic_run", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/corpus_semantic_run")>();
  return {
    ...actual,
    runSemanticAnalysis: (input: Parameters<typeof actual.runSemanticAnalysis>[0]) => {
      for (const artifact of input.artifacts) {
        semanticAncestry.set(artifact.root_relative_path, [...(artifact.archive_ancestry ?? [])]);
      }
      return actual.runSemanticAnalysis(input);
    },
  };
});

vi.mock("../src/corpus_readiness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/corpus_readiness")>();
  return {
    ...actual,
    buildReadinessEvidence: (input: Parameters<typeof actual.buildReadinessEvidence>[0]) => {
      for (const artifact of input.artifacts) readinessArchiveIds.set(artifact.root_relative_path, artifact.archive_id);
      return actual.buildReadinessEvidence(input);
    },
  };
});

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-locator-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

const PRODUCER_VERSION = "4.0.0";

function zipBytes(members: Parameters<typeof writeRawZip>[1]): Buffer {
  const file = path.join(tmp(), "inner.zip");
  writeRawZip(file, members);
  return fs.readFileSync(file);
}

/** Every relative_path in the observation's inventory, in order. */
function relativePaths(root: string): string[] {
  const observation = acquireLocalSource({ path: root, scratchParent: tmp() });
  try {
    return observation.inventory.records.map((record) => record.relative_path);
  } finally {
    observation.dispose();
  }
}

function expectUnique(paths: string[]): void {
  expect(new Set(paths).size).toBe(paths.length);
}

describe("RC-045 — a locator names exactly one record", () => {
  test("REG-WU-034-RC-045-a: a physical 'a.zip!/' directory beside a.zip holds a.zip; the physical file is observed once", () => {
    const root = tmp();
    writeRawZip(path.join(root, "a.zip"), [{ name: "m.txt", content: "member\n" }]);
    fs.mkdirSync(path.join(root, "a.zip!"));
    fs.writeFileSync(path.join(root, "a.zip!", "m.txt"), "physical\n");
    const before = treeSnapshot(root);

    const observation = acquireLocalSource({ path: root, scratchParent: tmp() });
    try {
      const paths = observation.inventory.records.map((record) => record.relative_path);
      expectUnique(paths);
      expect(paths.filter((p) => p === "a.zip!/m.txt")).toHaveLength(1);
      expect(observation.archives).toHaveLength(1);
      expect(observation.archives[0].expanded).toBe(false);
      expect(observation.archives[0].contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(observation.archives[0].holds.map((hold) => hold.code)).toEqual(["archive.locator_ambiguous"]);
      expect(observation.virtualArtifacts).toEqual([]);
      const record = observation.inventory.records.find((r) => r.relative_path === "a.zip!/m.txt");
      expect(record?.absolute_path).toBe(path.join(root, "a.zip!", "m.txt"));
    } finally {
      observation.dispose();
    }

    // REG-WU-034-RC-045-f: the packet built from it validates.
    const packet = withLocalSourceModel({ path: root, name: "a", producerVersion: PRODUCER_VERSION }, (r) => r.packet);
    expectUnique(packet.payload.artifacts.map((artifact) => artifact.artifact_id));
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");
    expect(treeSnapshot(root)).toEqual(before);
  });

  test("REG-WU-034-RC-045-b: a member named 'in.zip!/y.txt' beside a nested in.zip holds the outer archive", () => {
    const root = tmp();
    writeRawZip(path.join(root, "outer.zip"), [
      { name: "in.zip", content: zipBytes([{ name: "y.txt", content: "nested\n" }]), stored: true },
      { name: "in.zip!/y.txt", content: "forged direct member\n" },
    ]);

    const observation = acquireLocalSource({ path: root, scratchParent: tmp() });
    try {
      expect(observation.archives.map((archive) => archive.sourcePath)).toEqual(["outer.zip"]);
      expect(observation.archives[0].expanded).toBe(false);
      expect(observation.archives[0].holds.map((hold) => [hold.code, hold.memberPath]))
        .toEqual([["archive.locator_ambiguous", "in.zip!/y.txt"]]);
      expect(observation.virtualArtifacts).toEqual([]);
      expectUnique(observation.inventory.records.map((record) => record.relative_path));
    } finally {
      observation.dispose();
    }

    // REG-WU-034-RC-045-f
    const packet = withLocalSourceModel({ path: root, name: "outer", producerVersion: PRODUCER_VERSION }, (r) => r.packet);
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");
  });

  test("REG-WU-034-RC-045-c: a physical 'notes!/x.md' has no archive ancestry and no archive id", async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "notes!"));
    fs.writeFileSync(path.join(root, "notes!", "x.md"), "# Notes\nNot inside any archive.\n");

    expectUnique(relativePaths(root));
    semanticAncestry.clear();
    withLocalSourceModel({ path: root, name: "notes", producerVersion: PRODUCER_VERSION }, (result) => {
      expect(memberArchiveAncestry(result.observation).get("notes!/x.md")).toBeUndefined();
      expect(validateRepositoryModelPacket(result.packet).status).toBe("passed");
      buildLocalSourceCorpus(result);
    });
    expect(semanticAncestry.get("notes!/x.md")).toEqual([]);

    semanticAncestry.clear();
    readinessArchiveIds.clear();
    const scan = await runCorpusScan({ roots: [{ path: root, name: "disk" }], producerVersion: "test" });
    const document = scan.documentIndex.documents.find((doc) => doc.root_relative_path === "notes!/x.md");
    expect(document?.archive_ancestry).toEqual([]);
    expect(document?.is_archive_member).toBe(false);
    expect(readinessArchiveIds.get("notes!/x.md")).toBeNull();
    expect(semanticAncestry.get("notes!/x.md")).toEqual([]);
  });

  test("REG-WU-034-RC-045-d: an archive under a physical 'Wow!/' directory expands with structural ancestry", async () => {
    const root = tmp();
    writeRawZip(path.join(root, "Wow!", "b.zip"), [{ name: "m.txt", content: "member of b\n" }]);

    const observation = acquireLocalSource({ path: root, scratchParent: tmp() });
    try {
      expect(observation.archives[0].expanded).toBe(true);
      expect(observation.virtualArtifacts.map((member) => member.virtualSourcePath)).toEqual(["Wow!/b.zip!/m.txt"]);
      const ancestry = memberArchiveAncestry(observation);
      expect(ancestry.get("Wow!/b.zip!/m.txt")).toEqual(["Wow!/b.zip"]);
      expect(ancestry.get("Wow!/b.zip")).toBeUndefined();
    } finally {
      observation.dispose();
    }

    semanticAncestry.clear();
    withLocalSourceModel({ path: root, name: "wow", producerVersion: PRODUCER_VERSION }, (result) => {
      // REG-WU-034-RC-045-f
      expect(validateRepositoryModelPacket(result.packet).status).toBe("passed");
      buildLocalSourceCorpus(result);
    });
    expect(semanticAncestry.get("Wow!/b.zip!/m.txt")).toEqual(["Wow!/b.zip"]);
    expect(semanticAncestry.get("Wow!/b.zip")).toEqual([]);

    readinessArchiveIds.clear();
    const scan = await runCorpusScan({ roots: [{ path: root, name: "disk" }], producerVersion: "test" });
    const member = scan.documentIndex.documents.find((doc) => doc.root_relative_path === "Wow!/b.zip!/m.txt");
    expect(member?.archive_ancestry).toEqual(["Wow!/b.zip"]);
    expect(scan.snapshot.archives).toHaveLength(1);
    expect(scan.snapshot.archives[0].corpus_path.endsWith("Wow!/b.zip")).toBe(true);
    expect(readinessArchiveIds.get("Wow!/b.zip!/m.txt")).toBe(scan.snapshot.archives[0].archive_id);
    expect(readinessArchiveIds.get("Wow!/b.zip")).toBeNull();
  });

  test("REG-WU-034-RC-045-d: nested ancestry is the parent chain, outermost first", () => {
    const root = tmp();
    writeRawZip(path.join(root, "outer.zip"), [
      { name: "in.zip", content: zipBytes([{ name: "deep/y.txt", content: "nested\n" }]), stored: true },
    ]);
    const observation = acquireLocalSource({ path: root, scratchParent: tmp() });
    try {
      const ancestry = memberArchiveAncestry(observation);
      expect(ancestry.get("outer.zip!/in.zip")).toEqual(["outer.zip"]);
      expect(ancestry.get("outer.zip!/in.zip!/deep/y.txt")).toEqual(["outer.zip", "outer.zip!/in.zip"]);
    } finally {
      observation.dispose();
    }
  });

  test("REG-WU-034-RC-045-e: the golden local-source bundle regenerates byte-for-byte", () => {
    const repo = path.resolve(__dirname, "..");
    const sample = path.join(repo, "fixtures", "local-source", "sample-source");
    const golden = path.join(repo, "fixtures", "local-source", "expected-bundle");
    const packet = withLocalSourceModel(
      { path: sample, name: "sample-local-source", producerVersion: PRODUCER_VERSION },
      (result) => result.packet,
    );
    const emitted = path.join(tmp(), "bundle");
    emitRepositoryModelBundle(packet, { outDir: emitted });
    expect(fs.readFileSync(path.join(emitted, "packet.json"), "utf8"))
      .toBe(fs.readFileSync(path.join(golden, "packet.json"), "utf8"));
  });
});
