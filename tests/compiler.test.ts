import {
  buildDedupEntries,
  buildDedupReport,
  buildPromptLibraryIndex,
  buildPrimitiveLibraryIndex,
  dedupReportToMarkdown,
} from "../src/compiler";
import { InjectionRecord } from "../src/schema";

// Minimal InjectionRecord factory — only the fields the compiler reads matter.
function rec(sourcePath: string, hash: string, meta: Record<string, unknown>): InjectionRecord {
  return {
    sourcePath,
    originalBodyHash: hash,
    postInjectionBodyHash: hash,
    bodyPreserved: true,
    headerInjected: true,
    meta: meta as unknown as InjectionRecord["meta"],
  };
}

const bodyA = "the quick brown fox jumps over the lazy dog and then keeps running fast";
// bodyB: one word changed vs bodyA → high shingle overlap (near-duplicate, not identical).
const bodyB = "the quick brown fox jumps over the lazy dog and then keeps sprinting fast";
const bodyC = "completely different content about database migrations and rollups entirely unrelated text";

describe("buildDedupReport — exact twins", () => {
  test("groups byte-identical bodies as auditorTwins and reduces uniqueCount", () => {
    const records = [
      rec("a.md", "HASH_SAME", { id: "a", artifact_type: "skill" }),
      rec("b.md", "HASH_SAME", { id: "b", artifact_type: "skill" }),
      rec("c.md", "HASH_OTHER", { id: "c", artifact_type: "skill" }),
    ];
    const report = buildDedupReport(buildDedupEntries(records, 16), 0.9, 16);
    expect(report.auditorTwins).toHaveLength(1);
    expect(report.auditorTwins[0].paths.sort()).toEqual(["a.md", "b.md"]);
    expect(report.totalScanned).toBe(3);
    expect(report.uniqueCount).toBe(2); // 3 entries − 1 duplicate
  });
});

describe("buildDedupReport — near duplicates (ACA-003 regression)", () => {
  test("flags highly-similar non-identical bodies above threshold", () => {
    const records = [
      rec("a.md", "HASH_A", { id: "a", artifact_type: "skill" }),
      rec("b.md", "HASH_B", { id: "b", artifact_type: "skill" }),
    ];
    const bodies = new Map([["a.md", bodyA], ["b.md", bodyB]]);
    const report = buildDedupReport(buildDedupEntries(records, 16, bodies), 0.6, 16);
    expect(report.nearDuplicates).toHaveLength(1);
    expect(report.nearDuplicates[0].paths.sort()).toEqual(["a.md", "b.md"]);
    expect(report.nearDuplicates[0].similarity).toBeGreaterThan(0.6);
    expect(report.nearDuplicates[0].similarity).toBeLessThan(1);
  });

  test("does NOT flag dissimilar bodies", () => {
    const records = [
      rec("a.md", "HASH_A", { id: "a", artifact_type: "skill" }),
      rec("c.md", "HASH_C", { id: "c", artifact_type: "skill" }),
    ];
    const bodies = new Map([["a.md", bodyA], ["c.md", bodyC]]);
    const report = buildDedupReport(buildDedupEntries(records, 16, bodies), 0.9, 16);
    expect(report.nearDuplicates).toHaveLength(0);
  });

  test("threshold is honored — a high threshold excludes a moderately-similar pair", () => {
    const records = [
      rec("a.md", "HASH_A", { id: "a", artifact_type: "skill" }),
      rec("b.md", "HASH_B", { id: "b", artifact_type: "skill" }),
    ];
    const bodies = new Map([["a.md", bodyA], ["b.md", bodyB]]);
    const report = buildDedupReport(buildDedupEntries(records, 16, bodies), 0.99, 16);
    expect(report.nearDuplicates).toHaveLength(0);
  });

  test("exact twins are never double-counted as near-duplicates", () => {
    const records = [
      rec("a.md", "HASH_SAME", { id: "a", artifact_type: "skill" }),
      rec("b.md", "HASH_SAME", { id: "b", artifact_type: "skill" }),
    ];
    const bodies = new Map([["a.md", bodyA], ["b.md", bodyA]]);
    const report = buildDedupReport(buildDedupEntries(records, 16, bodies), 0.5, 16);
    expect(report.auditorTwins).toHaveLength(1);
    expect(report.nearDuplicates).toHaveLength(0);
  });

  test("no bodies supplied → no near-duplicates (honest empty, no false positives)", () => {
    const records = [
      rec("a.md", "HASH_A", { id: "a", artifact_type: "skill" }),
      rec("b.md", "HASH_B", { id: "b", artifact_type: "skill" }),
    ];
    const report = buildDedupReport(buildDedupEntries(records, 16), 0.9, 16);
    expect(report.nearDuplicates).toHaveLength(0);
  });
});

describe("library indexes", () => {
  test("buildPromptLibraryIndex keeps only prompt metas", () => {
    const records = [
      rec("p.md", "H1", { id: "p", artifact_type: "prompt", family: "Legal" }),
      rec("s.md", "H2", { id: "s", artifact_type: "skill", injectable: true }),
    ];
    const idx = buildPromptLibraryIndex(records);
    expect(idx).toHaveLength(1);
    expect(idx[0].id).toBe("p");
  });

  test("buildPrimitiveLibraryIndex keeps only injectable non-prompt metas", () => {
    const records = [
      rec("p.md", "H1", { id: "p", artifact_type: "prompt", family: "Legal" }),
      rec("s.md", "H2", { id: "s", artifact_type: "skill", injectable: true }),
      rec("x.md", "H3", { id: "x", artifact_type: "skill", injectable: false }),
    ];
    const idx = buildPrimitiveLibraryIndex(records);
    expect(idx.map((m) => m.id)).toEqual(["s"]);
  });
});

describe("dedupReportToMarkdown", () => {
  test("renders both exact-twin and near-duplicate sections", () => {
    const records = [
      rec("a.md", "HASH_A", { id: "a", artifact_type: "skill" }),
      rec("b.md", "HASH_B", { id: "b", artifact_type: "skill" }),
    ];
    const bodies = new Map([["a.md", bodyA], ["b.md", bodyB]]);
    const md = dedupReportToMarkdown(buildDedupReport(buildDedupEntries(records, 16, bodies), 0.6, 16));
    expect(md).toContain("Near duplicates: 1");
    expect(md).toContain("## Near Duplicates");
    expect(md).toContain("a.md");
    expect(md).toContain("b.md");
  });
});
