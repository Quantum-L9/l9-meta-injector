// P2.2 governed semantic mapping (ADR-084): the ten mapping and authority tests,
// plus the guards that keep the table an exact transcription of the bound ledger.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { defaultExtractors } from "../src/extractors";
import { nativeMetadataExtractor } from "../src/extractors/native_metadata";
import { interpretationProfileHash } from "../src/interpretation";
import { observeRepositoryModel, type RepositoryModelPacket } from "../src/repository_model";
import {
  ARTIFACT_HEADER_LEDGER,
  HEADER_DECLARATION_POLICY,
  NATIVE_HEADER_FIELDS,
  compareMappingToLedger,
  governedHeaderPredicates,
  governedMeaningOf,
  headerFieldMapping,
  semanticMappingIdentity,
} from "../src/semantic_mapping";

const REPO = path.resolve(__dirname, "..");
const REVISION = "git:0000000000000000000000000000000000000000";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-p2-"));
  scratch.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function observe(root: string): RepositoryModelPacket {
  return observeRepositoryModel({ root, repositoryName: "p2-semantics", sourceRevision: REVISION, producerVersion: "4.0.0" });
}

const header = (body: string): string => `<!-- L9_META\n${body}\n/L9_META -->\n\n# Doc\n\nBody text.\n`;

/** Every relationship type a header could be mistaken for. None may appear. */
const FORBIDDEN_EDGES = ["OWNED_BY", "GOVERNED_BY", "DEPENDS_ON", "IMPLEMENTS", "PROVIDES"];

describe("P2.2 the mapping is the bound ledger, transcribed", () => {
  test("cites exactly the ledger digest this repository binds", () => {
    const authority = fs.readFileSync(path.join(REPO, ".l9", "meta-authority.yaml"), "utf8");
    const line = authority.split(/\r?\n/).find((l) => l.trim().startsWith(`${ARTIFACT_HEADER_LEDGER.artifact_id}:`));
    expect(line?.trim()).toBe(`${ARTIFACT_HEADER_LEDGER.artifact_id}: ${ARTIFACT_HEADER_LEDGER.digest}`);
    // A literal line comparison: building a pattern from the release string
    // would need complete escaping, and an exact line is the stronger check.
    const releaseLine = authority.split(/\r?\n/).find((l) => l.trim().startsWith("release:"));
    expect(releaseLine?.trim()).toBe(`release: ${ARTIFACT_HEADER_LEDGER.release}`);
  });

  test("defines thirty fields, every one declared, artifact-scoped and never projected", () => {
    expect(NATIVE_HEADER_FIELDS).toHaveLength(30);
    expect(HEADER_DECLARATION_POLICY).toMatchObject({
      subject_scope: "artifact", evidence_class: "declared", authority: "source", projection: "none",
    });
    for (const mapping of NATIVE_HEADER_FIELDS) {
      expect(mapping.ledger_ref).toBe(`l9.artifact-header-model/global@1#fields.${mapping.field}`);
      expect(mapping.cardinality).toBe(/_list$/.test(mapping.value_kind) ? "set" : "single");
    }
  });

  test("the extractor's vocabulary is the mapping's, field for field", () => {
    const body = ["l9_schema: 1", ...NATIVE_HEADER_FIELDS.map((m) => `${m.field}: ${m.value_kind.endsWith("_list") ? "[x]" : "x"}`)].join("\n");
    const drafts = nativeMetadataExtractor.extract({
      subjectId: "artifact:x", sourcePath: "all.md", content: header(body), contentHash: "sha256:0", pathExists: () => false,
    });
    const emitted = new Set(drafts.map((d) => d.predicate).filter((p) => governedMeaningOf(p) !== undefined));
    expect([...emitted].sort()).toEqual(governedHeaderPredicates().filter((g) => g.declared_schema === "l9_schema:1").map((g) => g.predicate));
  });

  test("a drift between mapping and ledger is reported, not tolerated", () => {
    const synthetic = (rows: string[]): string => `schema: x\nfields:\n${rows.join("\n")}\nprojection_boundary:\n  canonical_relations: none\n`;
    const faithful = NATIVE_HEADER_FIELDS.map((m) => {
      const values = m.declared_values ? `\n    declared_values:\n${m.declared_values.map((v) => `      ${v}: meaning`).join("\n")}` : "";
      return `  ${m.field}:\n    category: ${m.category}\n    value_kind: ${m.value_kind}\n    definition: d${values}`;
    });
    expect(compareMappingToLedger(synthetic(faithful))).toEqual([]);
    const recategorized = faithful.map((row) => row.replace(/^ {2}owner:\n {4}category: governance/, "  owner:\n    category: identity"));
    expect(compareMappingToLedger(synthetic(recategorized))).toEqual(["field owner: mapping category governance, ledger identity"]);
    const extra = [...faithful, "  role:\n    category: identity\n    value_kind: label"];
    expect(compareMappingToLedger(synthetic(extra))).toEqual(["ledger field role has no mapping entry"]);
    const missing = faithful.filter((row) => !row.startsWith("  amplifies:"));
    expect(compareMappingToLedger(synthetic(missing))).toEqual(["mapping field amplifies is not defined by the ledger"]);
    // The mapping's `projection: none` is transcribed from the boundary, so a
    // ledger that widened or dropped it must not verify, fields unchanged.
    const widened = synthetic(faithful).replace("canonical_relations: none", "canonical_relations: owned_by");
    expect(compareMappingToLedger(widened)).toEqual([
      "ledger projection_boundary.canonical_relations is owned_by, mapping projection is none",
    ]);
    const dropped = synthetic(faithful).replace(/projection_boundary:\n {2}canonical_relations: none\n/, "");
    expect(compareMappingToLedger(dropped)).toEqual(["ledger has no projection_boundary.canonical_relations"]);
  });
});

describe("P2.2 mapping and authority tests (pack §4.5)", () => {
  // 1
  test("the same field under different schemas carries different meanings", () => {
    const drafts = (body: string) => nativeMetadataExtractor.extract({
      subjectId: "artifact:x", sourcePath: "x.md", content: header(body), contentHash: "sha256:0", pathExists: () => false,
    }).map((d) => d.predicate);
    expect(governedMeaningOf("meta.l9v1.governance.owner")?.mapping.ledger_ref).toBe("l9.artifact-header-model/global@1#fields.owner");
    expect(drafts("l9_schema: 1\nowner: platform")).toContain("meta.l9v1.governance.owner");
    // An unrecognized schema keeps the key and assigns no meaning.
    const unknownSchema = drafts("l9_schema: 9\nowner: platform");
    expect(unknownSchema).toContain("meta.unversioned.field");
    expect(unknownSchema.some((p) => governedMeaningOf(p) !== undefined)).toBe(false);
    // The managed header is this package's own; the ledger does not govern it.
    expect(governedMeaningOf("meta.managed.governance.owner")).toBeUndefined();
    // A known field under the wrong category is not that field.
    expect(governedMeaningOf("meta.l9v1.identity.owner")).toBeUndefined();
  });

  // 2
  test("several classification tags coexist as one set-valued declaration", () => {
    const packet = observe(repo({ "a.md": header("l9_schema: 1\ntags: [graph, ci, docs]") }));
    const tags = packet.payload.assertions.filter((a) => a.predicate === "meta.l9v1.classification.tags").map((a) => a.object);
    expect(tags.sort()).toEqual(["ci", "docs", "graph"]);
    expect(headerFieldMapping("tags")?.cardinality).toBe("set");
    expect(packet.payload.diagnostics.some((d) => d.code === "native_metadata.competing_declarations")).toBe(false);
  });

  // 3
  test("two conflicting single-valued declarations stay two claims and are flagged", () => {
    // Two declarations at the head of one file (frontmatter, then a native block)
    // that disagree about a single-valued field.
    const body = `---\nl9_schema: 1\nstatus: active\n---\n${header("l9_schema: 1\nstatus: deprecated")}`;
    const packet = observe(repo({ "a.md": body }));
    const statuses = packet.payload.assertions.filter((a) => a.predicate === "meta.l9v1.classification.status");
    expect(statuses.map((a) => a.object).sort()).toEqual(["active", "deprecated"]);
    expect(headerFieldMapping("status")?.cardinality).toBe("single");
    expect(packet.payload.diagnostics.some((d) => d.code === "native_metadata.competing_declarations")).toBe(true);
  });

  // 4
  test("a declared owner never becomes canonical ownership", () => {
    const packet = observe(repo({ "a.md": header("l9_schema: 1\nowner: platform-team") }));
    const owner = packet.payload.assertions.find((a) => a.predicate === "meta.l9v1.governance.owner");
    expect(owner).toMatchObject({ object: "platform-team", evidence_class: "declared", authority: "source" });
    expect(owner?.subject_id.startsWith("artifact:") ?? false).toBe(true);
    expect(packet.payload.repositories[0].owner_ids).toEqual([]);
    expect(packet.payload.relationships.some((r) => FORBIDDEN_EDGES.includes(r.edge_type))).toBe(false);
  });

  // 5
  test("the pinned binding's owner resolves only at repository scope", () => {
    const authority = fs.readFileSync(path.join(REPO, ".l9", "meta-authority.yaml"), "utf8")
      .replace(/owner: Quantum-L9\/l9-meta-injector/, "owner: Quantum-L9/p2-semantics");
    const packet = observe(repo({ ".l9/meta-authority.yaml": authority, "a.md": header("l9_schema: 1\nowner: platform") }));
    const binding = packet.payload.evidence.find((e) => e.field === "semantic_binding");
    if (binding === undefined) throw new Error("semantic_binding evidence missing");
    expect(binding.subject_id).toBe(packet.payload.repositories[0].repository_id);
    expect((binding.value as { product: { owner: string } }).product.owner).toBe("Quantum-L9/p2-semantics");
    const headerOwner = packet.payload.assertions.find((a) => a.predicate === "meta.l9v1.governance.owner");
    expect(headerOwner?.object).toBe("platform");
    expect(headerOwner?.subject_id).not.toBe(packet.payload.repositories[0].repository_id);
    expect(packet.payload.repositories[0].owner_ids).toEqual([]);
  });

  // 6, 7, 8
  test("ssot_for, load_when and references survive as claims with no promotion or edge", () => {
    const packet = observe(repo({
      "docs/REPO_MAP.md": header("l9_schema: 1\nssot_for: [module-boundaries]\nload_when: [code_review]\nreferences: [AGENTS.md, INVARIANTS.md]"),
      "AGENTS.md": "# Agents\n",
    }));
    const preds = new Set(packet.payload.assertions.map((a) => a.predicate));
    for (const p of ["meta.l9v1.governance.ssot_for", "meta.l9v1.retrieval.load_when", "meta.l9v1.retrieval.references"]) {
      expect(preds.has(p)).toBe(true);
      expect(governedMeaningOf(p)?.mapping).toBeDefined();
    }
    const scoped = packet.payload.assertions.filter((a) => a.predicate === "meta.l9v1.governance.ssot_for");
    expect(scoped.every((a) => a.source_path === "docs/REPO_MAP.md" && a.subject_id.startsWith("artifact:"))).toBe(true);
    expect(new Set(packet.payload.relationships.map((r) => r.edge_type))).toEqual(new Set(["CONTAINS"]));
    expect(packet.payload.capabilities).toEqual([]);
  });

  // 9
  test("unknown and unresolved fields stay visible without a meaning", () => {
    const packet = observe(repo({ "a.md": header("l9_schema: 1\nrole: gateway\nrequires: Unknown") }));
    const byPredicate = (p: string) => packet.payload.assertions.filter((a) => a.predicate === p).map((a) => a.object);
    expect(byPredicate("meta.l9v1.unsupported_field")).toContain("role");
    expect(byPredicate("meta.l9v1.unresolved_field")).toContain("requires");
    expect(headerFieldMapping("role")).toBeUndefined();
    expect(governedMeaningOf("meta.l9v1.unsupported_field")).toBeUndefined();
  });

  // 10
  test("changing the mapping changes the interpretation profile identity", async () => {
    const before = interpretationProfileHash(defaultExtractors());
    vi.resetModules();
    vi.doMock("../src/semantic_mapping", async () => {
      const real = await vi.importActual<typeof import("../src/semantic_mapping")>("../src/semantic_mapping");
      return { ...real, semanticMappingIdentity: () => ({ ...real.semanticMappingIdentity(), version: "9.9.9" }) };
    });
    const interpretation = await import("../src/interpretation");
    const extractors = await import("../src/extractors");
    const after = interpretation.interpretationProfileHash(extractors.defaultExtractors());
    vi.doUnmock("../src/semantic_mapping");
    vi.resetModules();
    expect(after).not.toBe(before);
    expect(semanticMappingIdentity()).toMatchObject({ id: "meta-injector-native-header-semantics", version: "1.0.0" });
  });
});
