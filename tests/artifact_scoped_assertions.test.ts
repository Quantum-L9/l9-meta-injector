// artifact_scoped_assertions.test.ts — who an assertion is about.
//
// The risk this guards is quiet: an extractor written to describe a repository
// keeps working after the interpreter learns artifact scope, and an artifact's
// claim never gets promoted to the repository. Both directions are asserted, as
// is the identity rule that keeps interpretation and packet building agreeing
// about what an artifact is called.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  artifactIdFor,
  buildRepositoryModelPacket,
  observeRepositoryModel,
  repositoryIdFor,
  validateRepositoryModelPacket,
  type RepositoryModelPacket,
} from "../src/repository_model";
import { inventoryTree } from "../src/inventory";
import { interpretRepository, type Extractor } from "../src/interpretation";
import { defaultExtractors } from "../src/extractors";

const PRODUCER_VERSION = "4.0.0";
const REVISION = "git:0000000000000000000000000000000000000000";

const roots: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-subject-"));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

/** A tree that triggers both a repository-scoped and an artifact-scoped rule. */
function fixture(): string {
  const root = tmp();
  fs.writeFileSync(path.join(root, "README.md"), [
    "# Sample",
    "",
    "> **Deprecated**",
    "",
    "This repository is an example.",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "sample", version: "1.0.0",
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(root, "plan.md"), [
    "---",
    "title: Migration Plan",
    "kind: plan",
    "status: wip",
    "---",
    "",
    "# Migration Plan",
    "",
    "- [ ] first step",
    "",
  ].join("\n"));
  return root;
}

function observe(root: string, name = "sample"): RepositoryModelPacket {
  return observeRepositoryModel({
    root, repositoryName: name, sourceRevision: REVISION, producerVersion: PRODUCER_VERSION,
  });
}

describe("subject scope", () => {
  it("keeps an existing repository-status assertion attached to the repository", () => {
    const packet = observe(fixture());
    const repositoryId = repositoryIdFor("sample");
    const status = packet.payload.assertions.filter((a) => a.predicate === "repository.status");
    expect(status.length).toBeGreaterThan(0);
    for (const assertion of status) expect(assertion.subject_id).toBe(repositoryId);
  });

  it("keeps an existing manifest assertion attached to the repository", () => {
    const packet = observe(fixture());
    const repositoryId = repositoryIdFor("sample");
    const manifest = packet.payload.assertions.filter((a) => a.source_path === "package.json");
    expect(manifest.length).toBeGreaterThan(0);
    for (const assertion of manifest) expect(assertion.subject_id).toBe(repositoryId);
  });

  it("attaches an artifact-scoped assertion to that exact artifact", () => {
    const packet = observe(fixture());
    const expected = artifactIdFor(repositoryIdFor("sample"), "plan.md");
    const status = packet.payload.assertions.find((a) =>
      a.predicate === "work.status" && a.source_path === "plan.md");
    expect(status?.subject_id).toBe(expected);
    expect(packet.payload.artifacts.some((a) => a.artifact_id === expected)).toBe(true);
  });

  it("defaults an extractor that declares no scope to the repository", () => {
    const root = fixture();
    const silent: Extractor = {
      id: "test-unscoped/v1",
      version: "1.0.0",
      matches: (sourcePath) => sourcePath === "plan.md",
      extract: () => [{
        predicate: "test.claim",
        object: "value",
        sourceRange: { start_line: 1, end_line: 1 },
        evidenceExcerpt: "---",
        evidenceClass: "declared",
        authority: "source",
        confidence: "high",
      }],
    };
    const inventory = inventoryTree({ root, outDir: path.join(tmp(), "out"), dryRun: true });
    const result = interpretRepository({
      root, subjectId: repositoryIdFor("sample"), inventory, extractors: [silent],
    });
    expect(result.assertions[0]?.subject_id).toBe(repositoryIdFor("sample"));
  });

  it("changes the assertion id when only the subject changes", () => {
    const root = fixture();
    const inventory = inventoryTree({ root, outDir: path.join(tmp(), "out"), dryRun: true });
    const base = {
      predicate: "test.claim",
      object: "value",
      sourceRange: { start_line: 1, end_line: 1 },
      evidenceExcerpt: "---",
      evidenceClass: "declared" as const,
      authority: "source" as const,
      confidence: "high" as const,
    };
    const make = (scope: "repository" | "artifact"): Extractor => ({
      id: "test-scoped/v1",
      version: "1.0.0",
      subjectScope: scope,
      matches: (sourcePath) => sourcePath === "plan.md",
      extract: () => [base],
    });
    const run = (scope: "repository" | "artifact"): string =>
      interpretRepository({
        root, subjectId: repositoryIdFor("sample"), inventory, extractors: [make(scope)],
      }).assertions[0].assertion_id;

    // Same predicate, object, path and span: only the subject differs, and the
    // identity must move with it or two different claims would collide.
    expect(run("artifact")).not.toBe(run("repository"));
  });

  it("changes the interpretation profile hash when an extractor changes scope", () => {
    const root = fixture();
    const inventory = inventoryTree({ root, outDir: path.join(tmp(), "out"), dryRun: true });
    const make = (scope: "repository" | "artifact"): Extractor => ({
      id: "test-scoped/v1",
      version: "1.0.0",
      subjectScope: scope,
      matches: () => false,
      extract: () => [],
    });
    const hashFor = (scope: "repository" | "artifact"): string =>
      interpretRepository({
        root, subjectId: repositoryIdFor("sample"), inventory, extractors: [make(scope)],
      }).profile.profile_hash;
    expect(hashFor("artifact")).not.toBe(hashFor("repository"));
  });
});

describe("subject validation", () => {
  it("accepts a packet whose assertions mix repository and artifact subjects", () => {
    const packet = observe(fixture());
    const subjects = new Set(packet.payload.assertions.map((a) => a.subject_id));
    expect([...subjects].some((s) => s.startsWith("repo:"))).toBe(true);
    expect([...subjects].some((s) => s.startsWith("artifact:"))).toBe(true);
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");
  });

  it("fails validation when an assertion names a subject the packet does not carry", () => {
    const packet = observe(fixture());
    const orphaned: RepositoryModelPacket = {
      ...packet,
      payload: {
        ...packet.payload,
        assertions: packet.payload.assertions.map((assertion, index) =>
          index === 0 ? { ...assertion, subject_id: "artifact:deadbeef" } : assertion),
      },
    };
    const receipt = validateRepositoryModelPacket(orphaned);
    expect(receipt.status).toBe("failed");
    const check = receipt.checks.find((c) => c.check_id === "assertion-subject");
    expect(check?.status).toBe("failed");
    expect(check?.details.orphan_count).toBe(1);
  });
});

describe("identity is portable", () => {
  it("gives the same subject id for the same content under a different absolute root", () => {
    const first = fixture();
    const second = tmp();
    for (const name of fs.readdirSync(first)) {
      fs.copyFileSync(path.join(first, name), path.join(second, name));
    }
    const subjectsOf = (root: string): string[] =>
      observe(root).payload.assertions.map((a) => a.subject_id);
    expect(subjectsOf(second)).toEqual(subjectsOf(first));
  });

  it("derives artifact subjects with the same function the packet builder uses", () => {
    const root = fixture();
    const inventory = inventoryTree({ root, outDir: path.join(tmp(), "out"), dryRun: true });
    const repositoryId = repositoryIdFor("sample");
    const interpretation = interpretRepository({
      root, subjectId: repositoryId, inventory, extractors: defaultExtractors(),
    });
    const packet = buildRepositoryModelPacket({
      repositoryName: "sample",
      sourceRevision: REVISION,
      producerVersion: PRODUCER_VERSION,
      inventory,
      interpretation,
    });
    // Nothing in the packet should carry a subject the builder cannot name.
    const known = new Set([
      ...packet.payload.repositories.map((r) => r.repository_id),
      ...packet.payload.artifacts.map((a) => a.artifact_id),
    ]);
    for (const assertion of packet.payload.assertions) {
      expect(known.has(assertion.subject_id)).toBe(true);
    }
    expect(artifactIdFor(repositoryId, "plan.md"))
      .toBe(packet.payload.artifacts.find((a) => a.source_path === "plan.md")?.artifact_id);
  });
});
