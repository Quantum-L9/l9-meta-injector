// P1.3 / P1.4 / P1.5 — deterministic architectural observers, their passage into
// the Repository Model Packet, and the epistemic boundary between them (ADR-082).
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import type { AssertionDraft, ExtractorDiagnostic, ExtractorFileInput } from "../src/interpretation";
import { MAX_EXTRACTOR_DIAGNOSTICS_PER_FILE, interpretDocumentContent } from "../src/interpretation";
import {
  contractReferenceExtractor,
  defaultExtractors,
  manifestExtractor,
  staticImportExtractor,
  workflowStructureExtractor,
} from "../src/extractors";
import {
  canonicalJson,
  emitRepositoryModelBundle,
  observeRepositoryModel,
  validateRepositoryModelPacket,
  type RepositoryModelPacket,
} from "../src/repository_model";

const REPO = path.resolve(__dirname, "..");
const FIXTURE = path.join(REPO, "fixtures", "repository-model", "phase1-semantics");
const EXPECTED = path.join(FIXTURE, "expected-assertions.json");
const REVISION = "git:0000000000000000000000000000000000000000";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-p1-"));
  scratch.push(dir);
  return dir;
}

function run(
  extractor: { extract(input: ExtractorFileInput): AssertionDraft[] },
  sourcePath: string,
  content: string,
  existing: string[] = [],
): { drafts: AssertionDraft[]; diagnostics: ExtractorDiagnostic[] } {
  const diagnostics: ExtractorDiagnostic[] = [];
  const paths = new Set(existing);
  const drafts = extractor.extract({
    subjectId: "artifact:x",
    sourcePath,
    content,
    contentHash: "sha256:0",
    pathExists: (candidate) => paths.has(candidate),
    report: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { drafts, diagnostics };
}

const pairs = (drafts: AssertionDraft[]): string[][] => drafts.map((d) => [d.predicate, d.object]);

function observeFixture(root: string = FIXTURE): RepositoryModelPacket {
  return observeRepositoryModel({
    root, repositoryName: "phase1-semantics", sourceRevision: REVISION, producerVersion: "4.0.0",
  });
}

function treeDigest(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else out[path.relative(root, absolute)] = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    }
  };
  walk(root);
  return out;
}

// ───────────────────────────── P1.3 workflows ─────────────────────────────

describe("P1.3 workflow observer", () => {
  const WORKFLOW = [
    "on: [push]",
    "jobs:",
    "  build:",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - run: |",
    "          echo 'uses: fake/step@v1'",
    "          echo 'needs: nothing'",
    "  test:",
    "    needs: [build, deploy]",
    "    steps:",
    "      - uses: ./tools/action",
    "  call:",
    "    uses: Example/repo/.github/workflows/reusable.yml@0123456789012345678901234567890123456789",
  ].join("\n");

  test("reports jobs, needs and uses exactly as written", () => {
    const { drafts } = run(workflowStructureExtractor, ".github/workflows/ci.yml", WORKFLOW, ["tools/action/action.yml"]);
    expect(pairs(drafts)).toEqual([
      ["workflow.job", "build"],
      ["workflow.uses_action", "actions/checkout@v4"],
      ["workflow.job", "test"],
      ["workflow.job_needs", "test -> build"],
      ["workflow.job_needs_unresolved", "test -> deploy"],
      ["workflow.uses_local", "tools/action/action.yml"],
      ["workflow.job", "call"],
      ["workflow.uses_reusable_workflow", "Example/repo/.github/workflows/reusable.yml@0123456789012345678901234567890123456789"],
    ]);
  });

  test("never reads a block scalar as workflow structure", () => {
    const { drafts } = run(workflowStructureExtractor, ".github/workflows/ci.yml", WORKFLOW);
    expect(drafts.some((d) => d.object.includes("fake/step"))).toBe(false);
  });

  test("never turns needs or uses into a dependency claim", () => {
    const { drafts } = run(workflowStructureExtractor, ".github/workflows/ci.yml", WORKFLOW);
    expect(drafts.every((d) => d.predicate.startsWith("workflow."))).toBe(true);
    expect(drafts.every((d) => d.authority === "source" && d.evidenceClass === "observed")).toBe(true);
  });

  test("reports expressions and flow mappings rather than guessing", () => {
    const text = "jobs:\n  a:\n    needs: ${{ fromJSON(x) }}\n    steps:\n      - uses: ${{ matrix.action }}\n";
    const { drafts, diagnostics } = run(workflowStructureExtractor, ".github/workflows/x.yml", text);
    expect(pairs(drafts)).toEqual([["workflow.job", "a"]]);
    expect(diagnostics.map((d) => d.code)).toEqual(["workflow.needs_unsupported", "workflow.uses_expression"]);
  });

  test("observes root workflows only", () => {
    expect(workflowStructureExtractor.matches(".github/workflows/ci.yml")).toBe(true);
    expect(workflowStructureExtractor.matches("nested/.github/workflows/ci.yml")).toBe(false);
  });
});

// ───────────────────────────── P1.3 imports ─────────────────────────────

describe("P1.3 static import observer", () => {
  test("classifies TypeScript specifiers and resolves only observed targets", () => {
    const text = [
      'import { a } from "./a.js";',
      'import type { B } from "../b";',
      'import fs from "node:fs";',
      'import x from "@scope/pkg/deep";',
      'import y from "lodash/fp";',
      'import "#internal";',
      'const s = "import z from \'./z\'";',
      "// import w from './w';",
      "/* import v from './v'; */",
      String.raw`const r = /from "\.\/regex"/;`,
      'const t = `import q from "./q"`;',
      'const dyn = import("./a");',
      'const c = require("./c");',
    ].join("\n");
    const { drafts, diagnostics } = run(staticImportExtractor, "src/m.ts", text, ["src/a.ts", "c.json"]);
    expect(pairs(drafts)).toEqual([
      ["source.import.local", "src/a.ts"],
      ["source.import.local_unresolved", "../b"],
      ["source.import.builtin", "node:fs"],
      ["source.import.absolute", "@scope/pkg"],
      ["source.import.absolute", "lodash"],
      ["source.import.local_unresolved", "#internal"],
      ["source.import.local_unresolved", "./c"],
    ]);
    expect(diagnostics.map((d) => d.code)).toEqual(["source_import.dynamic_not_interpreted"]);
  });

  test("follows the importer's own resolution precedence, never a guess", () => {
    // A JS importer under Node CJS: extensionless resolves .js before an index.
    const js = run(staticImportExtractor, "dist/index.js", 'const m = require("./model");', ["dist/model.js", "dist/model.d.ts", "dist/model/index.js"]);
    expect(pairs(js.drafts)).toEqual([["source.import.local", "dist/model.js"]]);
    // A TS importer naming the emitted .js resolves to the .ts source beside it.
    const ts = run(staticImportExtractor, "src/index.ts", 'export * from "./model.js";', ["src/model.ts", "src/model.js"]);
    expect(pairs(ts.drafts)).toEqual([["source.import.local", "src/model.ts"]]);
  });

  test("reads a slash after postfix ++ or -- as division (PR #127 review)", () => {
    const text = 'let x = 1;\nconst y = x++ / 2;\nconst z = x-- / 2;\nimport a from "./a";\n';
    const { drafts, diagnostics } = run(staticImportExtractor, "m.ts", text, ["a.ts"]);
    expect(pairs(drafts)).toEqual([["source.import.local", "a.ts"]]);
    expect(diagnostics).toEqual([]);
    // A prefix sign is not postfix: `a = + /re/.source` still opens a regex.
    expect(pairs(run(staticImportExtractor, "n.ts", 'const r = + /x"y/.source;\nimport b from "./b";\n', ["b.ts"]).drafts))
      .toEqual([["source.import.local", "b.ts"]]);
  });

  test("refuses a relative specifier that escapes the repository root", () => {
    const { drafts } = run(staticImportExtractor, "a.ts", 'import x from "../outside";', ["../outside.ts"]);
    expect(pairs(drafts)).toEqual([["source.import.local_unresolved", "../outside"]]);
  });

  test("classifies Python imports and resolves relative packages", () => {
    const text = [
      '"""Docstring.',
      "import hidden_in_docstring",
      '"""',
      "import os, json as j",
      "from requests import get",
      "from . import sibling",
      "from .pkg.mod import thing",
      "from ..up import far",
      "from \\",
      "  pkg import x",
    ].join("\n");
    const { drafts } = run(staticImportExtractor, "app/main.py", text, ["app/__init__.py", "app/pkg/mod.py"]);
    expect(pairs(drafts)).toEqual([
      ["source.import.absolute", "os"],
      ["source.import.absolute", "json"],
      ["source.import.absolute", "requests"],
      ["source.import.local", "app/__init__.py"],
      ["source.import.local", "app/pkg/mod.py"],
      ["source.import.local_unresolved", "..up"],
      // A backslash continuation is one statement.
      ["source.import.absolute", "pkg"],
    ]);
  });

  test("does not mistake an external package for a local module", () => {
    // `pkg` exists locally, but an absolute import's search path is not observable.
    const { drafts } = run(staticImportExtractor, "main.py", "import pkg\n", ["pkg/__init__.py"]);
    expect(pairs(drafts)).toEqual([["source.import.absolute", "pkg"]]);
  });

  test("reports a file it cannot scan to its end instead of reporting partial imports", () => {
    const { drafts, diagnostics } = run(staticImportExtractor, "bad.ts", 'import a from "./a";\nconst s = "unterminated\n');
    expect(drafts).toEqual([]);
    expect(diagnostics.map((d) => d.code)).toEqual(["source_import.scan_incomplete"]);
  });
});

// ───────────────────────────── P1.3 manifests and contracts ─────────────────────────────

describe("P1.3 dependency manifests and contract references", () => {
  test("reads pip requirements with exact names and coordinates", () => {
    const text = "# comment\n-r base.txt\nFastAPI[all]>=0.110 ; python_version>'3.9'\nneo4j @ https://example.invalid/neo4j.whl\ngit+https://example.invalid/x.git\n./local\n";
    const { drafts, diagnostics } = run(manifestExtractor, "requirements.txt", text);
    expect(drafts.filter((d) => d.predicate === "package.dependency").map((d) => [d.object, d.sourceRange.start_line])).toEqual([
      ["fastapi", 3], ["neo4j", 4],
    ]);
    expect(diagnostics.map((d) => d.code)).toEqual(["manifest.requirement_lines_not_interpreted"]);
    expect(manifestExtractor.matches("requirements-dev.txt")).toBe(true);
    expect(manifestExtractor.matches("notes.txt")).toBe(false);
  });

  test("reports literal contract references and skips in-document pointers", () => {
    const yaml = 'paths:\n  x:\n    $ref: "./schemas/a.yaml#/A"\n    b:\n      $ref: ./schemas/b.yaml\n    c:\n      $ref: "#/components/schemas/C"\n    d:\n      $ref: "https://example.invalid/d.yaml"\n';
    const { drafts } = run(contractReferenceExtractor, "api/openapi.yaml", yaml, ["api/schemas/a.yaml"]);
    expect(pairs(drafts)).toEqual([
      ["contract.reference.local", "api/schemas/a.yaml"],
      ["contract.reference.unresolved", "./schemas/b.yaml"],
      ["contract.reference.remote", "https://example.invalid/d.yaml"],
    ]);
    const json = '{\n  "$ref": "./schemas/a.yaml",\n  "x": 1\n}\n';
    expect(pairs(run(contractReferenceExtractor, "api/openapi.json", json, ["api/schemas/a.yaml"]).drafts))
      .toEqual([["contract.reference.local", "api/schemas/a.yaml"]]);
    expect(contractReferenceExtractor.matches("docs/orders.openapi.yaml")).toBe(true);
    expect(contractReferenceExtractor.matches("docs/schema.yaml")).toBe(false);
  });
});

// ───────────────────────────── P1.4 packet integration ─────────────────────────────

describe("P1.4 Phase 1 fixture through the Repository Model Packet", () => {
  test("produces exactly the reviewed assertions and interpretation diagnostics", () => {
    const expected = JSON.parse(fs.readFileSync(EXPECTED, "utf8")) as {
      interpretation_profile_version: string;
      assertions: unknown[][];
      interpretation_diagnostics: unknown[][];
    };
    const packet = observeFixture();
    expect(packet.interpretation_profile?.profile_version).toBe(expected.interpretation_profile_version);
    expect(packet.payload.assertions.map((a) => [
      a.source_path, a.source_range.start_line, a.source_range.end_line, a.predicate, a.object, a.evidence_class, a.authority, a.confidence,
    ])).toEqual(expected.assertions);
    expect(packet.payload.diagnostics.filter((d) => d.stage === "meta-injector-interpretation")
      .map((d) => [d.details?.source_path ?? null, d.code])).toEqual(expected.interpretation_diagnostics);
  });

  test("validates, and every assertion resolves to an emitted subject with exact evidence", () => {
    const packet = observeFixture();
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");
    const subjects = new Set([...packet.payload.repositories.map((r) => r.repository_id), ...packet.payload.artifacts.map((a) => a.artifact_id)]);
    const fileHash = (relative: string): string =>
      `sha256:${crypto.createHash("sha256").update(fs.readFileSync(path.join(FIXTURE, relative))).digest("hex")}`;
    const bodyHashed: string[] = [];
    for (const artifact of packet.payload.artifacts) {
      if (artifact.content_hash !== fileHash(artifact.source_path)) bodyHashed.push(artifact.source_path);
    }
    // Inventory's artifact hash is carrier-free for a file whose header the
    // injector manages (ADR-065); an assertion cites the whole file it parsed.
    // The two are distinct on purpose, and the assertion never borrows the body hash.
    expect(bodyHashed.length).toBeGreaterThan(0);
    for (const assertion of packet.payload.assertions) {
      expect(subjects.has(assertion.subject_id)).toBe(true);
      expect(assertion.source_range.start_line).toBeGreaterThanOrEqual(1);
      expect(assertion.source_range.end_line).toBeGreaterThanOrEqual(assertion.source_range.start_line);
      // The whole-file hash the assertion contract requires, not a body hash.
      expect(assertion.source_content_hash).toBe(fileHash(assertion.source_path));
      expect(assertion.extractor_id).toMatch(/\/v\d+$/);
    }
  });

  test("is byte-identical across repeated emissions and independent of the checkout path", () => {
    const first = observeFixture();
    const copy = path.join(tmp(), "elsewhere");
    fs.cpSync(FIXTURE, copy, { recursive: true });
    const moved = observeFixture(copy);
    expect(moved.packet_id).toBe(first.packet_id);
    const a = path.join(tmp(), "a");
    const b = path.join(tmp(), "b");
    emitRepositoryModelBundle(first, { outDir: a });
    emitRepositoryModelBundle(moved, { outDir: b });
    for (const rel of ["packet.json", "manifest.json", "receipts/validation-receipt.json"]) {
      expect(fs.readFileSync(path.join(b, rel), "utf8")).toBe(fs.readFileSync(path.join(a, rel), "utf8"));
    }
    expect(canonicalJson(first)).not.toContain(FIXTURE);
  });

  test("leaves every observed source byte unchanged", () => {
    const before = treeDigest(FIXTURE);
    observeFixture();
    expect(treeDigest(FIXTURE)).toEqual(before);
  });

  test("binds the extractor registry into the interpretation profile", () => {
    const packet = observeFixture();
    expect(Object.keys(packet.interpretation_profile?.extractor_versions ?? {})).toEqual(
      expect.arrayContaining(["native-metadata/v1", "workflow-structure/v1", "static-imports/v1", "contract-references/v1"]),
    );
  });
});

// ───────────────────────────── P1.5 epistemic separation ─────────────────────────────

/** Predicates the bound consumer projects into relationships or capabilities. */
const PROJECTED_BY_CONSUMER = new Set(["package.dependency", "http.route", "http.route_handler", "service.action", "authority.canonical_contract", "work.depends_on", "work.blocked_by", "work.references", "work.supersedes", "work.superseded_by"]);
const NEW_NAMESPACES = ["meta.", "workflow.", "source.import.", "contract.reference."];

describe("P1.5 epistemic separation", () => {
  const packet = observeFixture();
  const assertions = packet.payload.assertions;

  test("conflicting owner declarations stay two distinguishable claims", () => {
    const owners = assertions.filter((a) => a.source_path === "conflicting-owner.md" && a.predicate === "meta.l9v1.governance.owner");
    expect(owners.map((a) => [a.object, a.source_range.start_line])).toEqual([["platform", 4], ["engine-team", 9]]);
    expect(packet.payload.diagnostics.some((d) => d.code === "native_metadata.competing_declarations" && d.details?.source_path === "conflicting-owner.md")).toBe(true);
  });

  test("no ownership, capability or canonical relationship is invented", () => {
    expect(packet.payload.repositories[0].owner_ids).toEqual([]);
    expect(packet.payload.capabilities).toEqual([]);
    expect(new Set(packet.payload.relationships.map((r) => r.edge_type))).toEqual(new Set(["CONTAINS"]));
  });

  test("no new observation uses a predicate the consumer projects", () => {
    const fresh = assertions.filter((a) => NEW_NAMESPACES.some((ns) => a.predicate.startsWith(ns)));
    expect(fresh.length).toBeGreaterThan(50);
    expect(fresh.filter((a) => PROJECTED_BY_CONSUMER.has(a.predicate))).toEqual([]);
  });

  test("a source reference or prose mention does not become a dependency", () => {
    const dependencies = assertions.filter((a) => a.predicate === "package.dependency");
    // Only the requirements manifests declare dependencies; neither the header's
    // references nor the architecture prose naming EIE, CEG and neo4j does.
    expect([...new Set(dependencies.map((a) => a.source_path))].sort()).toEqual(["requirements-dev.txt", "requirements.txt"]);
    expect(assertions.filter((a) => a.source_path === "docs/architecture.md").map((a) => a.predicate))
      .not.toContain("package.dependency");
  });

  test("an unresolved target is never given an artifact identity", () => {
    const unresolved = assertions.filter((a) => a.predicate.endsWith("_unresolved") || a.predicate.endsWith(".unresolved"));
    expect(unresolved.length).toBeGreaterThan(0);
    const paths = new Set(packet.payload.artifacts.map((a) => a.source_path));
    for (const assertion of unresolved) expect(paths.has(assertion.object)).toBe(false);
    for (const assertion of assertions.filter((a) => a.predicate === "source.import.local")) expect(paths.has(assertion.object)).toBe(true);
  });

  test("unsupported syntax produces a diagnostic and no claim", () => {
    const fromSingleLine = assertions.filter((a) => a.source_path === "config/single-line.yaml" || a.source_path === "config/duplicate.yaml");
    expect(fromSingleLine.filter((a) => a.predicate.startsWith("meta."))).toEqual([]);
  });

  test("repeated extraction does not duplicate assertions", () => {
    const ids = assertions.map((a) => a.assertion_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("secret-bearing material never reaches an excerpt", () => {
    expect(assertions.some((a) => a.source_path === "config/credentials.yaml")).toBe(false);
    expect(assertions.some((a) => a.evidence_excerpt.includes("api_key"))).toBe(false);
    expect(packet.payload.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining([
      "interpretation.secret_path_skipped", "interpretation.secret_value_suppressed",
    ]));
  });
});

describe("P1.5 producer validation refuses what the interpreter cannot produce", () => {
  const base = observeFixture();
  const failedChecks = (mutate: (packet: RepositoryModelPacket) => void): string[] => {
    const packet = structuredClone(base);
    mutate(packet);
    return validateRepositoryModelPacket(packet).checks.filter((c) => c.status === "failed").map((c) => c.check_id);
  };

  test("an evidence-free assertion", () => {
    expect(failedChecks((p) => { p.payload.assertions[0].source_content_hash = "Unknown"; })).toContain("assertion-evidence");
    expect(failedChecks((p) => { p.payload.assertions[0].source_range = { start_line: 3, end_line: 1 }; })).toContain("assertion-evidence");
  });

  test("an orphaned assertion", () => {
    expect(failedChecks((p) => { p.payload.assertions[0].subject_id = "artifact:nowhere"; })).toContain("assertion-subject");
  });

  test("an escalated authority or a non-portable path", () => {
    expect(failedChecks((p) => { p.payload.assertions[0].authority = "validated-machine"; })).toContain("assertion-authority");
    expect(failedChecks((p) => { p.payload.assertions[0].source_path = "/abs/path.md"; })).toContain("assertion-portable-paths");
  });

  test("a duplicated assertion", () => {
    expect(failedChecks((p) => { p.payload.assertions.push({ ...p.payload.assertions[0] }); })).toContain("assertion-unique");
  });

  test("a heuristic or unobserved relationship", () => {
    expect(failedChecks((p) => {
      p.payload.relationships.push({ ...p.payload.relationships[0], edge_id: "edge:x", edge_type: "DEPENDS_ON" });
    })).toContain("relationship-support");
    expect(failedChecks((p) => {
      p.payload.relationships[0].confidence = { ...p.payload.relationships[0].confidence, derivation_method: "model-assisted" };
    })).toContain("relationship-support");
  });

  test("promoted ownership", () => {
    expect(failedChecks((p) => { p.payload.repositories[0].owner_ids = ["owner:platform"]; })).toContain("ownership-not-promoted");
  });

  test("a secret-looking excerpt", () => {
    expect(failedChecks((p) => { p.payload.assertions[0].evidence_excerpt = "token = abcdefgh12345678"; })).toContain("assertion-secret-free");
  });
});

describe("P1.4 interpretation diagnostics channel", () => {
  test("is bounded per extractor and file", () => {
    const noisy = {
      id: "noisy/v1", version: "1.0.0", subjectScope: "artifact" as const,
      matches: () => true,
      extract(input: ExtractorFileInput): AssertionDraft[] {
        for (let index = 0; index < 20; index++) input.report?.({ code: "noisy.note", severity: "info", message: `n${index}` });
        return [];
      },
    };
    const result = interpretDocumentContent({
      repositorySubjectId: "repo:x", sourcePath: "a.txt", content: "x\n", extractors: [noisy], pathExists: () => false,
    });
    expect(result.diagnostics.filter((d) => d.code === "noisy.note")).toHaveLength(MAX_EXTRACTOR_DIAGNOSTICS_PER_FILE);
    expect(result.diagnostics.at(-1)?.code).toBe("interpretation.diagnostics_truncated");
  });

  test("registers every Phase 1 extractor in the default profile", () => {
    expect(defaultExtractors().map((e) => e.id)).toEqual(expect.arrayContaining([
      "native-metadata/v1", "workflow-structure/v1", "static-imports/v1", "contract-references/v1",
    ]));
  });
});
