// repository_fact_scope.test.ts — WU-029 (ADR-062): repository-level facts and
// repository-subject claims come from the repository root, and a shared manifest
// filename is not package-manager evidence.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  observeRepositoryModel,
  repositoryModelArtifactId,
  validateRepositoryModelPacket,
  type RepositoryModelPacket,
} from "../src/repository_model";
import { withLocalSourceModel } from "../src/local_source_model";
import { writeRawZip } from "./helpers/zip_fixtures";

const REPO = path.resolve(__dirname, "..");
const REVISION = "git:0000000000000000000000000000000000000000";
const PRODUCER_VERSION = "4.0.0";

const scratchDirs: string[] = [];
function materialize(files: Record<string, string>): string {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "l9-fact-scope-")), "repo");
  scratchDirs.push(path.dirname(root));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  return root;
}
afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function observe(root: string, name = "fixture"): RepositoryModelPacket {
  return observeRepositoryModel({
    root,
    repositoryName: name,
    sourceRevision: REVISION,
    producerVersion: PRODUCER_VERSION,
  });
}

function hasUnsupported(packet: RepositoryModelPacket, field: string, sourcePath?: string): boolean {
  return packet.payload.diagnostics.some(
    (d) => d.code === "unsupported-by-evidence"
      && d.details?.field === field
      && (sourcePath === undefined || d.details?.source_path === sourcePath),
  );
}

function evidencePathsFor(packet: RepositoryModelPacket, field: string): unknown[] {
  return packet.payload.evidence
    .filter((e) => e.field === field)
    .map((e) => e.source_ref.source_path);
}

describe("WU-029 RC-033: repository-level facts are root-anchored", () => {
  it("REG-WU-029-RC-033-a: a nested manifest and lockfile are not repository facts", () => {
    const root = materialize({
      "uv.lock": "version = 1\n",
      "tests/fixtures/js-app/package.json":
        '{\n  "name": "js-app",\n  "dependencies": {\n    "left-pad": "^1.0.0"\n  }\n}\n',
      "tests/fixtures/js-app/yarn.lock": "# yarn lockfile v1\n",
    });
    const packet = observe(root, "py");
    const repository = packet.payload.repositories[0];
    expect(repository.package_managers).toEqual(["uv"]);

    const dependencies = packet.payload.assertions.filter((a) => a.predicate === "package.dependency");
    expect(dependencies.filter((a) => a.subject_id === repository.repository_id)).toEqual([]);
    const fixtureArtifact = repositoryModelArtifactId(
      repository.repository_id, "tests/fixtures/js-app/package.json",
    );
    for (const claim of dependencies) expect(claim.subject_id).toBe(fixtureArtifact);
    // The nested claim is emitted, filed against its own file.
    expect(dependencies.map((a) => a.object)).toEqual(["left-pad"]);
    // A nested manifest never satisfies the repository's dependency field.
    expect(hasUnsupported(packet, "dependencies")).toBe(true);
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");
  });

  it("REG-WU-029-RC-033-b: a root manifest still declares the repository's dependencies", () => {
    const root = materialize({
      "package.json": '{\n  "name": "deps-repo",\n  "dependencies": {\n    "express": "^4.0.0"\n  }\n}\n',
    });
    const packet = observe(root, "deps-repo");
    const claim = packet.payload.assertions.find((a) => a.predicate === "package.dependency");
    expect(claim?.object).toBe("express");
    expect(claim?.subject_id).toBe("repo:deps-repo");
    expect(hasUnsupported(packet, "dependencies")).toBe(false);
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");
  });

  it("REG-WU-029-RC-033-c: nested CODEOWNERS and ADR files are not repository governance or ADR refs", () => {
    const root = materialize({
      "fixtures/x/CODEOWNERS": "* @someone\n",
      "fixtures/x/docs/decisions/adr-001.md": "# ADR-001\n",
      "fixtures/x/adr-002-nested.md": "# ADR-002\n",
      "notes.txt": "x\n",
    });
    const repository = observe(root).payload.repositories[0];
    expect(repository.governance_refs).toEqual([]);
    expect(repository.adr_refs).toEqual([]);
  });

  it("REG-WU-029-RC-033-d: GitHub community-health locations remain governance refs", () => {
    const root = materialize({
      ".github/CODEOWNERS": "* @a\n",
      "docs/CODEOWNERS": "* @b\n",
      "CODE_OF_CONDUCT.md": "be kind\n",
      "docs/decisions/adr-001.md": "# ADR-001\n",
      "adr-002-root.md": "# ADR-002\n",
    });
    const repository = observe(root).payload.repositories[0];
    expect(repository.governance_refs).toEqual([".github/CODEOWNERS", "CODE_OF_CONDUCT.md", "docs/CODEOWNERS"]);
    expect(repository.adr_refs).toEqual(["adr-002-root.md", "docs/decisions/adr-001.md"]);
  });

  it("REG-WU-029-RC-033-e: this repository's own packet carries no fixture-derived repository facts", () => {
    const packet = observe(REPO, "l9-meta-injector");
    const repository = packet.payload.repositories[0];
    const names = packet.payload.assertions.filter(
      (a) => a.predicate === "package.name" && a.subject_id === repository.repository_id,
    );
    expect(names.map((a) => a.source_path)).toEqual(["package.json"]);
    expect(names.map((a) => a.object)).toEqual(["l9-meta-injector"]);
    for (const value of [
      ...repository.governance_refs,
      ...repository.adr_refs,
      ...evidencePathsFor(packet, "package_managers"),
    ]) {
      expect(String(value)).not.toMatch(/^fixtures\//);
    }
    expect(repository.governance_refs).not.toContain("fixtures/repository-model/sample-repo/CODEOWNERS");
    expect(repository.adr_refs).not.toContain("fixtures/repository-model/sample-repo/docs/decisions/adr-001-example.md");
    // The root package.json alone does not name npm; package-lock.json does.
    expect(repository.package_managers).toEqual(["npm"]);
    expect(evidencePathsFor(packet, "package_managers")).toEqual(["package-lock.json"]);
  }, 60_000);

  it("REG-WU-029-RC-033-f: a README inside an archive is a claim about the member, not the source", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "l9-fact-scope-ls-")), "src");
    scratchDirs.push(path.dirname(root));
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "README.md"), "# Root\n\n> **Status:** experimental\n");
    writeRawZip(path.join(root, "Bundle.zip"), [
      { name: "README.md", content: "# Packed\n\n> **Status:** deprecated\n" },
    ]);
    const packet = withLocalSourceModel(
      { path: root, name: "fixture", producerVersion: PRODUCER_VERSION },
      (result) => result.packet,
    );
    const statuses = packet.payload.assertions.filter((a) => a.predicate === "repository.status");
    const repositoryId = packet.payload.repositories[0].repository_id;
    const byPath = new Map(statuses.map((a) => [a.source_path, a.subject_id]));
    expect(byPath.get("README.md")).toBe(repositoryId);
    expect(byPath.get("Bundle.zip!/README.md"))
      .toBe(repositoryModelArtifactId(repositoryId, "Bundle.zip!/README.md"));
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");
  });
});

describe("WU-029 RC-034: package.json is a shared manifest", () => {
  it("REG-WU-029-RC-034-a: package.json with pnpm-lock.yaml resolves pnpm only", () => {
    const root = materialize({
      "package.json": '{\n  "name": "p",\n  "packageManager": "pnpm@9.0.0"\n}\n',
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    });
    const packet = observe(root);
    expect(packet.payload.repositories[0].package_managers).toEqual(["pnpm"]);
    expect(packet.payload.evidence.some(
      (e) => e.field === "package_managers" && JSON.stringify(e.value).includes("npm") && !JSON.stringify(e.value).includes("pnpm"),
    )).toBe(false);
    expect(evidencePathsFor(packet, "package_managers")).toEqual(["pnpm-lock.yaml"]);
  });

  it("REG-WU-029-RC-034-b: package-lock.json still identifies npm", () => {
    const root = materialize({
      "package.json": '{\n  "name": "p"\n}\n',
      "package-lock.json": "{}\n",
    });
    const packet = observe(root);
    expect(packet.payload.repositories[0].package_managers).toEqual(["npm"]);
    expect(evidencePathsFor(packet, "package_managers")).toEqual(["package-lock.json"]);
  });

  it("REG-WU-029-RC-034-c: package.json alone resolves no manager and reports the gap", () => {
    const root = materialize({ "package.json": '{\n  "name": "p"\n}\n' });
    const packet = observe(root);
    expect(packet.payload.repositories[0].package_managers).toEqual([]);
    expect(hasUnsupported(packet, "package_managers", "package.json")).toBe(true);
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");
  });

  it("REG-WU-029-RC-034-d: pyproject outcomes are unchanged", () => {
    const alone = observe(materialize({ "pyproject.toml": '[project]\nname = "svc"\n' }));
    expect(alone.payload.repositories[0].package_managers).toEqual([]);
    expect(hasUnsupported(alone, "package_managers", "pyproject.toml")).toBe(true);
    const poetry = observe(materialize({ "pyproject.toml": '[tool.poetry]\nname = "svc"\n', "poetry.lock": "#\n" }));
    expect(poetry.payload.repositories[0].package_managers).toEqual(["poetry"]);
    const uv = observe(materialize({ "pyproject.toml": '[project]\nname = "svc"\n', "uv.lock": "version = 1\n" }));
    expect(uv.payload.repositories[0].package_managers).toEqual(["uv"]);
  });
});
