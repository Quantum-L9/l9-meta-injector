// artifact_scoped_assertions.test.ts — which subject a claim attaches to.
//
// Before this seam existed, every assertion in a packet was rewritten to the
// repository subject on the way out. That is fine for "this repository declares
// itself deprecated" and destroys "this plan declares itself WIP": a thousand
// documents reporting their status against one subject is not a work map, it is
// a contradiction. These tests hold both halves — the new artifact scope, and the
// repository scope that every pre-existing extractor keeps.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inventoryTree } from "../src/inventory";
import { defaultExtractors } from "../src/extractors";
import {
  interpretRepository,
  type Extractor,
  type InterpretationResult,
} from "../src/interpretation";
import {
  buildRepositoryModelPacket,
  observeRepositoryModel,
  repositoryModelArtifactId,
  validateRepositoryModelPacket,
  type RepositoryModelPacket,
} from "../src/repository_model";
import { withLocalSourceModel } from "../src/local_source_model";
import { writeRawZip } from "./helpers/zip_fixtures";

const REPO = path.resolve(__dirname, "..");
const SUBJECT = "repo:fixture";
const PRODUCER_VERSION = "4.0.0";

const scratchDirs: string[] = [];
function tmp(prefix = "l9-artifact-scope-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function materialize(files: Record<string, string>, root = tmp()): string {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  return root;
}

function interpret(root: string, subjectId = SUBJECT, extractors?: Extractor[]): InterpretationResult {
  const inventory = inventoryTree({
    root,
    outDir: path.join(tmp("l9-artifact-scope-out-"), "inventory"),
    dryRun: true,
    injectHeaders: false,
    folderSidecars: false,
    writeSidecars: false,
  });
  return interpretRepository({
    root,
    subjectId,
    inventory,
    extractors: extractors ?? defaultExtractors(),
  });
}

function subjectsFor(result: InterpretationResult, extractorId: string): string[] {
  return [
    ...new Set(
      result.assertions
        .filter((assertion) => assertion.extractor_id === extractorId)
        .map((assertion) => assertion.subject_id),
    ),
  ];
}

describe("existing extractors keep the repository scope they had", () => {
  it("keeps repository-status assertions on the repository", () => {
    const root = materialize({
      "README.md": "# Fixture\n\n> **Status:** deprecated\n\nbody\n",
    });
    const result = interpret(root);
    expect(subjectsFor(result, "repository-status/v1")).toEqual([SUBJECT]);
  });

  it("keeps manifest assertions on the repository", () => {
    const root = materialize({
      "package.json": JSON.stringify({ name: "fixture", version: "1.2.3" }, null, 2),
    });
    const result = interpret(root);
    const manifest = result.assertions.filter((a) => a.extractor_id === "manifest/v1");
    expect(manifest.length).toBeGreaterThan(0);
    expect(subjectsFor(result, "manifest/v1")).toEqual([SUBJECT]);
  });

  it("treats an extractor that declares no scope as repository-scoped", () => {
    const legacy: Extractor = {
      id: "legacy/v1",
      version: "1.0.0",
      matches: (sourcePath) => sourcePath === "anything.md",
      extract: () => [{
        predicate: "legacy.claim",
        object: "value",
        sourceRange: { start_line: 1, end_line: 1 },
        evidenceExcerpt: "line",
        evidenceClass: "declared",
        authority: "source",
        confidence: "high",
      }],
    };
    const root = materialize({ "anything.md": "line\n" });
    const result = interpret(root, SUBJECT, [legacy]);
    expect(subjectsFor(result, "legacy/v1")).toEqual([SUBJECT]);
  });
});

describe("work assertions attach to the artifact that made them", () => {
  it("points each claim at the exact file that declares it", () => {
    const root = materialize({
      "plan.md": "---\nstatus: wip\n---\n\n# Plan\n",
      "notes/other.md": "---\nstatus: blocked\n---\n\n# Other\n",
    });
    const result = interpret(root);
    const statuses = result.assertions.filter((a) => a.predicate === "work.status");
    expect(statuses.map((a) => [a.source_path, a.object, a.subject_id])).toEqual([
      ["notes/other.md", "blocked", repositoryModelArtifactId(SUBJECT, "notes/other.md")],
      ["plan.md", "wip", repositoryModelArtifactId(SUBJECT, "plan.md")],
    ]);
    // Distinct files never share a subject.
    expect(new Set(statuses.map((a) => a.subject_id)).size).toBe(2);
  });

  it("gives an assertion a different identity when its subject changes", () => {
    const root = materialize({ "plan.md": "---\nstatus: wip\n---\n\n# Plan\n" });
    const artifactScoped = interpret(root).assertions.find((a) => a.predicate === "work.status");
    const repositoryScoped = interpret(root, SUBJECT, [{
      ...(defaultExtractors().find((e) => e.id === "work-intelligence/v1") as Extractor),
      subjectScope: "repository",
    }]).assertions.find((a) => a.predicate === "work.status");

    expect(artifactScoped?.subject_id).not.toBe(repositoryScoped?.subject_id);
    // Identity binds the subject, so the same claim about two different subjects
    // cannot collide on one assertion id.
    expect(artifactScoped?.assertion_id).not.toBe(repositoryScoped?.assertion_id);
  });

  it("keeps the subject identical when the same content sits at a different absolute root", () => {
    const files = { "plan.md": "---\nstatus: wip\n---\n\n# Plan\n" };
    const first = interpret(materialize(files, tmp("l9-scope-a-")));
    const second = interpret(materialize(files, tmp("l9-scope-b-")));
    expect(first.assertions.map((a) => [a.subject_id, a.assertion_id]))
      .toEqual(second.assertions.map((a) => [a.subject_id, a.assertion_id]));
  });
});

describe("archive members are their own subjects", () => {
  it("attaches a member's claims to the virtual member artifact", () => {
    const parent = tmp("l9-scope-archive-");
    const inner = path.join(parent, "build", "inner.zip");
    fs.mkdirSync(path.dirname(inner), { recursive: true });
    writeRawZip(inner, [{
      name: "world-model.md",
      content: "---\nstatus: draft\n---\n\n# World Model\n",
      stored: true,
    }]);
    const source = path.join(parent, "source");
    fs.mkdirSync(source, { recursive: true });
    writeRawZip(path.join(source, "old-projects.zip"), [
      { name: "plans/inner.zip", content: fs.readFileSync(inner), stored: true },
    ]);

    withLocalSourceModel(
      { path: source, name: "corpus", producerVersion: PRODUCER_VERSION },
      ({ packet, interpretation }) => {
        const memberPath = "old-projects.zip!/plans/inner.zip!/world-model.md";
        const status = interpretation?.assertions.find((a) => a.predicate === "work.status");
        expect(status?.source_path).toBe(memberPath);
        expect(status?.object).toBe("draft");

        const expected = repositoryModelArtifactId("repo:corpus", memberPath);
        expect(status?.subject_id).toBe(expected);
        // Not the outer archive, not the inner archive, not the repository.
        expect(status?.subject_id).not.toBe(repositoryModelArtifactId("repo:corpus", "old-projects.zip"));
        expect(status?.subject_id)
          .not.toBe(repositoryModelArtifactId("repo:corpus", "old-projects.zip!/plans/inner.zip"));
        expect(status?.subject_id).not.toBe("repo:corpus");

        // And the subject really is an emitted artifact of this packet.
        const artifact = packet.payload.artifacts.find((a) => a.artifact_id === expected);
        expect(artifact?.source_path).toBe(memberPath);
        // No staging location leaked into the subject or the evidence.
        expect(JSON.stringify(packet.payload.assertions)).not.toContain(os.tmpdir());
      },
    );
  });
});

describe("packet-side subject handling", () => {
  function packetFor(root: string): RepositoryModelPacket {
    return observeRepositoryModel({
      root,
      repositoryName: "fixture",
      sourceRevision: "git:0000000000000000000000000000000000000000",
      producerVersion: PRODUCER_VERSION,
    });
  }

  it("preserves the subject each assertion arrived with", () => {
    const root = materialize({
      "README.md": "# Fixture\n\n> **Status:** deprecated\n",
      "plan.md": "---\nstatus: wip\n---\n\n# Plan\n",
    });
    const packet = packetFor(root);
    const byExtractor = (id: string): string[] => [
      ...new Set(packet.payload.assertions.filter((a) => a.extractor_id === id).map((a) => a.subject_id)),
    ];
    expect(byExtractor("repository-status/v1")).toEqual(["repo:fixture"]);
    expect(byExtractor("work-intelligence/v1"))
      .toContain(repositoryModelArtifactId("repo:fixture", "plan.md"));
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");
  });

  it("orders assertions deterministically even when subjects differ", () => {
    const root = materialize({
      "b.md": "---\nstatus: wip\n---\n\n# B\n",
      "a.md": "---\nstatus: blocked\n---\n\n# A\n",
    });
    const first = packetFor(root);
    const second = packetFor(root);
    expect(first.payload.assertions).toEqual(second.payload.assertions);
    expect(first.semantic_hash).toBe(second.semantic_hash);
  });

  it("fails validation when an assertion names a subject the packet does not emit", () => {
    const root = materialize({ "plan.md": "---\nstatus: wip\n---\n\n# Plan\n" });
    const inventory = inventoryTree({
      root,
      outDir: path.join(tmp("l9-orphan-out-"), "inventory"),
      dryRun: true,
      injectHeaders: false,
      folderSidecars: false,
      writeSidecars: false,
    });
    const interpretation = interpret(root, "repo:fixture");
    const orphaned: InterpretationResult = {
      ...interpretation,
      assertions: interpretation.assertions.map((assertion) => ({
        ...assertion,
        subject_id: repositoryModelArtifactId("repo:fixture", "never-observed.md"),
      })),
    };
    const packet = buildRepositoryModelPacket({
      inventory,
      interpretation: orphaned,
      repositoryName: "fixture",
      sourceRevision: "git:0000000000000000000000000000000000000000",
      producerVersion: PRODUCER_VERSION,
    });
    const result = validateRepositoryModelPacket(packet);
    expect(result.status).toBe("failed");
    const check = result.checks.find((c) => c.check_id === "assertion-subject");
    expect(check?.status).toBe("failed");
    expect(check?.details.orphan_count).toBe(orphaned.assertions.length);
  });
});

describe("the bound topology consumer", () => {
  const evidence = JSON.parse(
    fs.readFileSync(path.join(REPO, "docs", "topology-conformance.json"), "utf8"),
  ) as { subjects: { id: string; bundle: string }[]; result: { translation_shim_required: boolean } };

  it("accepted a packet carrying artifact-scoped assertion subjects", () => {
    const localSource = evidence.subjects.find((subject) => subject.id === "local-source");
    expect(localSource).toBeDefined();
    const packet = JSON.parse(
      fs.readFileSync(path.join(REPO, (localSource as { bundle: string }).bundle, "packet.json"), "utf8"),
    ) as RepositoryModelPacket;

    const repositoryIds = new Set(packet.payload.repositories.map((r) => r.repository_id));
    const artifactIds = new Set(packet.payload.artifacts.map((a) => a.artifact_id));
    const artifactScoped = packet.payload.assertions.filter((a) => artifactIds.has(a.subject_id));
    const repositoryScoped = packet.payload.assertions.filter((a) => repositoryIds.has(a.subject_id));

    // The proven bundle must actually exercise both scopes, or the conformance
    // record would only be evidence about the scope that happened to be present.
    expect(artifactScoped.length).toBeGreaterThan(0);
    expect(repositoryScoped.length).toBeGreaterThan(0);
    expect(artifactScoped.length + repositoryScoped.length).toBe(packet.payload.assertions.length);
    // Including a member of a nested archive, which is the subject most likely to
    // be flattened by a careless producer.
    expect(artifactScoped.some((a) => a.source_path.includes("!/"))).toBe(true);
    expect(evidence.result.translation_shim_required).toBe(false);
  });
});
