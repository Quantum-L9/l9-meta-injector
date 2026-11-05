import type { TrackedGitEntry, TrackedGitSnapshot } from "../src/discovery_contracts";
import { resolveTrackedCarrierDecisions } from "../src/mutation_policy";
import {
  compileTrackedMetadataIndex, assertTrackedDecisionCoverage, assertTrackedIndexCoverage,
  parseTrackedCoverage, parseMetadataIndexV2, serializeMetadataIndexV2,
} from "../src/metadata_index";

function leaf(path: string | Buffer, mode: TrackedGitEntry["mode"] = "100644", oid = "a".repeat(40)): TrackedGitEntry {
  const bytes = Buffer.from(path);
  let spelling: string | null;
  try { spelling = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { spelling = null; }
  return { path: spelling, path_bytes_base64: bytes.toString("base64"), mode, object_type: mode === "160000" ? "commit" : "blob", object_oid: oid };
}
const snapshot = (entries: readonly TrackedGitEntry[]): TrackedGitSnapshot => ({ repository_id: "Owner/Repo", revision: "b".repeat(40), tree_oid: "c".repeat(40), object_format: "sha1", entries });
const compile = (entries: readonly TrackedGitEntry[]) => compileTrackedMetadataIndex({ snapshot: snapshot(entries), producerVersion: "4.3.0" });

describe("universal v2 exact-set index-first coverage", () => {
  test("G01-G02 all arbitrary hidden and generated subjects are indexed without inline selection", () => {
    const paths = [".hidden", ".claude/secret-looking-but-not-secret.json", ".cursor/rules/rule", ".github/workflows/a.yml", ".l9/ci.json", ".l9/meta-authority.yaml", "nested/.dot/x", "dist/generated", "node_modules/x/package.json", "unknown", "blob.bin", "archive.zip", "package-lock.json", "src/a.ts", "prompts/p.md"];
    const result = compile(paths.map((path, index) => leaf(path, index % 2 ? "100755" : "100644")));
    expect(result.records).toHaveLength(paths.length);
    expect(result.coverage.totals).toEqual({ tree_leaves: paths.length, indexed: paths.length, protected: 0, unsupported: 0 });
    expect(result.records.every((record) => record.content_hash === null && record.content_hash_scope === "not_inspected" && record.content_kind === "Unknown" && record.artifact_type === "unknown")).toBe(true);
    expect(result.records.some((record) => (record.carrier as string) === "inline_managed")).toBe(false);
    expect(result.coverage.subject_content_reads).toBe(false);
    expect(result.coverage.authority_inspection).toBe("not_performed");
    expect(result.coverage.host_materializability).toBe("not_assessed");
    expect(result.bytes).not.toContain('"revision"');
    expect(result.bytes).not.toContain('"tree_oid"');
  });
  test("G05-G06 links and gitlinks preserve object provenance, no targets or payload hashes", () => {
    const result = compile([leaf("link", "120000"), leaf("submodule", "160000", "d".repeat(40)), leaf("opaque")]);
    expect(result.records.map((record) => record.git.mode)).toEqual(["120000", "100644", "160000"]);
    expect(result.carrierDecisions.map((item) => item.reason)).toEqual(["link_as_link", "index_only", "gitlink_as_reference"]);
    expect(result.bytes).not.toContain("target");
    expect(result.records.every((record) => record.content_hash === null)).toBe(true);
  });
  test("G07 self-cycle and root manifest are exact protected external receipts", () => {
    const entries = [leaf(".l9/metadata-index.jsonl"), leaf("GIT_TREE_MANIFEST.json"), leaf("nested/GIT_TREE_MANIFEST.json")];
    const result = compile(entries);
    expect(result.records.map((record) => record.path)).toEqual(["nested/GIT_TREE_MANIFEST.json"]);
    expect(result.coverage.entries.filter((entry) => entry.disposition === "protected").map((entry) => [entry.path, entry.reason, entry.object_oid])).toEqual([
      [".l9/metadata-index.jsonl", "protected_self", "a".repeat(40)], ["GIT_TREE_MANIFEST.json", "protected_manifest", "a".repeat(40)],
    ]);
    const changed = compile([leaf(".l9/metadata-index.jsonl", "100644", "e".repeat(40)), ...entries.slice(1)]);
    expect(changed.bytes).toBe(result.bytes);
    expect(changed.coverageBytes).not.toBe(result.coverageBytes);
  });
  test("G03-G04 canonical identities remain distinct while legacy ambiguity is visible", () => {
    const result = compile(["a-b.md", "a_b.md", "a/b.md", "A.md", "a.md", "é.md", "e\u0301.md"].map((path) => leaf(path)));
    expect(new Set(result.records.map((record) => record.metadata.id)).size).toBe(7);
    expect(result.coverage.alias_ambiguities.length).toBeGreaterThanOrEqual(3);
    expect(result.coverage.alias_ambiguities.every((group) => group.schema === "l9.namespace-alias/v1" && group.ids.length > 1)).toBe(true);
  });
  test("BOM is a real filename code point, not a removable transport marker", () => {
    const result = compile([leaf("\uFEFFname"), leaf("name")]);
    expect(result.records.map((record) => record.path)).toContain("\uFEFFname");
    expect(new Set(result.records.map((record) => record.metadata.id)).size).toBe(2);
    expect(() => compile([{ ...leaf("\uFEFFname"), path: "name" }])).toThrow(/spelling/);
  });
  test("G08-G09 unsupported portable paths and secrets never disappear", () => {
    const entries = [leaf("tab\tname"), leaf("line\nname"), leaf("back\\slash"), leaf(Buffer.from([0xff, 0xfe])), leaf("../escape"), leaf("a//b"), leaf(""), leaf(".env"), leaf(".env.production"), leaf("secrets/token"), leaf(".ssh/id_ed25519"), leaf(".git/config"), leaf(".env.example")];
    const result = compile(entries);
    expect(result.coverage.totals).toEqual({ tree_leaves: 13, indexed: 1, protected: 5, unsupported: 7 });
    expect(result.records[0].path).toBe(".env.example");
    expect(result.coverage.entries.find((entry) => entry.path === null)?.path_bytes_base64).toBe(Buffer.from([0xff, 0xfe]).toString("base64"));
    expect(result.coverage.entries.every((entry) => entry.content_hash === null && entry.id.startsWith("l9.path/v2:"))).toBe(true);
  });
  test("unsupported mode/type combinations are accounted, not materialized", () => {
    const entry = { ...leaf("bad-mode"), mode: "160000" as const, object_type: "blob" as const };
    const result = compile([entry]);
    expect(result.coverage.entries[0].reason).toBe("unsupported_git_entry");
    expect(result.records).toEqual([]);
  });
  test("G10 rejects duplicate census and path/evidence spelling corruption", () => {
    expect(() => compile([leaf("a"), leaf("a")])).toThrow(/duplicate/);
    expect(() => compile([{ ...leaf("a"), path: "b" }])).toThrow(/spelling/);
    expect(() => compile([{ ...leaf("a"), object_oid: "f".repeat(64) }])).toThrow(/object format/);
  });
  test("G10 rejects missing/extra/duplicate/swapped decisions even with equal totals", () => {
    const tree = snapshot([leaf("a"), leaf("b", "100755", "d".repeat(40))]);
    const decisions = resolveTrackedCarrierDecisions(tree.entries);
    expect(() => assertTrackedDecisionCoverage(tree, decisions.slice(1))).toThrow(/missing/);
    expect(() => assertTrackedDecisionCoverage(tree, [...decisions, decisions[0]])).toThrow(/duplicate/);
    expect(() => assertTrackedDecisionCoverage(tree, [decisions[0], { ...decisions[1], ...leaf("c", "100755") }])).toThrow(/extra/);
    expect(() => assertTrackedDecisionCoverage(tree, [decisions[0], { ...decisions[1], object_oid: decisions[0].object_oid }])).toThrow(/evidence/);
    expect(() => assertTrackedDecisionCoverage(tree, [decisions[0], { ...decisions[1], mode: "100644" }])).toThrow(/evidence/);
    expect(() => assertTrackedDecisionCoverage(tree, [{ ...decisions[0], carrier: "hard_skip", disposition: "protected", reason: "protected_self" }, decisions[1]])).toThrow(/unjustified/);
  });
  test("G10 index materialization rejects equal-count evidence swaps and extra/missing records", () => {
    const entries = [leaf("a"), leaf("b", "100755", "d".repeat(40))];
    const result = compile(entries);
    expect(() => assertTrackedIndexCoverage(snapshot(entries), result.carrierDecisions, result.records.slice(1))).toThrow(/missing/);
    expect(() => assertTrackedIndexCoverage(snapshot(entries), result.carrierDecisions, [...result.records, result.records[0]])).toThrow(/duplicate/);
    const swapped = result.records.map((record) => ({ ...record, git: { ...record.git, object_oid: record.git.object_oid === "a".repeat(40) ? "d".repeat(40) : "a".repeat(40) } }));
    expect(() => assertTrackedIndexCoverage(snapshot(entries), result.carrierDecisions, swapped)).toThrow(/evidence/);
  });
  test("G11 deterministic replay and receipt parser bind the exact external census", () => {
    const entries = [leaf("Z"), leaf("é"), leaf("a"), leaf("e\u0301"), leaf(".l9/metadata-index.jsonl")];
    const result = compile(entries);
    expect(compile([...entries].reverse()).bytes).toBe(result.bytes);
    expect(compile([...entries].reverse()).coverageBytes).toBe(result.coverageBytes);
    expect(parseMetadataIndexV2(result.bytes)).toEqual(result.records);
    expect(serializeMetadataIndexV2(result.records, result.header)).toBe(result.bytes);
    expect(parseTrackedCoverage(result.coverageBytes, snapshot(entries), result.records)).toEqual(result.coverage);
    const altered = JSON.parse(result.coverageBytes);
    altered.entries[0].object_oid = "f".repeat(40);
    expect(() => parseTrackedCoverage(`${JSON.stringify(altered)}\n`, snapshot(entries), result.records)).toThrow(/closure/);
    expect(() => parseTrackedCoverage(result.coverageBytes, { ...snapshot(entries), revision: "f".repeat(40) }, result.records)).toThrow(/closure/);
    expect(() => parseMetadataIndexV2(result.bytes.trimEnd())).toThrow(/newline/);
    expect(() => parseMetadataIndexV2(`${JSON.stringify(result.header)}\n${result.records.map((record) => JSON.stringify(record)).reverse().join("\n")}\n`)).toThrow(/canonical/);
  });
  test("G12 empty index retains explicit v2 header and no current revision fields", () => {
    const result = compile([]);
    expect(result.bytes.split("\n")).toHaveLength(2);
    expect(parseMetadataIndexV2(result.bytes)).toEqual([]);
    expect(JSON.parse(result.bytes)).toEqual(result.header);
    expect(result.header).not.toHaveProperty("revision");
    expect(result.header).not.toHaveProperty("tree_oid");
    expect(() => parseMetadataIndexV2("")).toThrow(/header/);
  });
  test("v2 never admits fabricated hashes, inline carriers, volatile fields, or header revisions", () => {
    const result = compile([leaf("a")]);
    expect(() => serializeMetadataIndexV2([{ ...result.records[0], content_hash: "a".repeat(64) } as never], result.header)).toThrow(/evidence/);
    expect(() => serializeMetadataIndexV2([{ ...result.records[0], carrier: "inline_managed" } as never], result.header)).toThrow(/carrier/);
    expect(() => serializeMetadataIndexV2([{ ...result.records[0], metadata: { ...result.records[0].metadata, generated_at: "today" } } as never], result.header)).toThrow(/exactly/);
    expect(() => serializeMetadataIndexV2(result.records, { ...result.header, revision: "a".repeat(40) } as never)).toThrow(/exactly/);
    const extra = compile([leaf("c")]).records[0];
    expect(() => assertTrackedIndexCoverage(snapshot([leaf("a")]), result.carrierDecisions, [extra])).toThrow(/extra/);
  });
});
