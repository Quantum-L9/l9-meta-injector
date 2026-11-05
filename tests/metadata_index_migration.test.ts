import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import Ajv from "ajv";
import { vi } from "vitest";
vi.mock("node:fs", async (importOriginal) => ({ ...await importOriginal<typeof import("node:fs")>() }));
import {
  compileMetadataIndexLegacyIdentityClaims, compileMetadataIndexMigrationEvidence,
  compileTrackedMetadataIndex, metadataIndexMigrationAliasProblem, parseMetadataIndex,
  parseTrackedCoverage, readVersionedMetadataIndex, serializeMetadataIndex, serializeMetadataIndexV2,
  METADATA_INDEX_RELATIVE_PATH, type MetadataIndexLegacyIdentityClaimsV2,
  type MetadataIndexRecord, type TrackedMetadataCompilation,
} from "../src/metadata_index";
import { planTrackedOperation, runTrackedApplyAsync, runTrackedCheckAsync, runTrackedCoverage } from "../src/carrier_operation";
import type { TrackedCoverageInput } from "../src/operation_contracts";
import { REQUIRED_SEMANTIC_LEDGERS } from "../src/operation_contracts";
import { readTrackedGitSnapshot } from "../src/git_tree";
import { trackedPathIdentity } from "../src/namespace";
import { fixtureRepository, fixtureTree, fixtureCommit, setFixtureHead, fixtureGit, cleanupGitFixtures } from "./helpers/git_tree_fixtures";

const authority = `schema: l9.meta-authority/v1\nwriter:\n  repository: Quantum-L9/l9-meta-injector\n  ref: ${"a".repeat(40)}\ndefault_carrier: central_manifest\nlegacy_writers: forbidden\ninline_allow: []\n`;
const source = "export const answer = 42;\n";
const hash = (bytes: string): string => createHash("sha256").update(bytes).digest("hex");
const target = (input: TrackedCoverageInput): string => path.join(input.root, METADATA_INDEX_RELATIVE_PATH);
function legacyRecord(sourcePath: string, metadata: Record<string, unknown> = {}): MetadataIndexRecord {
  return { schema: "l9.metadata-index/v1", path: sourcePath, carrier: "central_manifest", artifact_type: "source", content_hash: "d".repeat(64), metadata };
}
function repo(bound = false, extra: Array<{ path: string; contents: string }> = []): TrackedCoverageInput {
  const root = fixtureRepository();
  const authorityDocument = bound ? `${authority.replace("l9.meta-authority/v1", "l9.meta-authority/v2")}semantic_foundation:\n  repository: Quantum-L9/.github\n  revision: ${"a".repeat(40)}\n  release: v1\n  admission: candidate\n  ledgers:\n${REQUIRED_SEMANTIC_LEDGERS.map((id) => `    ${id}: sha256:${"b".repeat(64)}`).join("\n")}\nproduct:\n  id: bound-product\n  owner: Owner/Repo\n  kind: Unknown\n  archetype: Unknown\n` : authority;
  const tree = fixtureTree(root, [{ path: ".l9/meta-authority.yaml", contents: authorityDocument }, { path: "src/a.ts", contents: source }, ...extra]);
  const revision = fixtureCommit(root, tree);
  setFixtureHead(root, revision, true);
  return { root, revision, repositoryId: "Owner/Repo", contract: "l9.tracked-carrier-policy/v2", producerVersion: "4.3.0" };
}
function writeLegacy(input: TrackedCoverageInput, records: MetadataIndexRecord[]): string {
  const bytes = serializeMetadataIndex(records);
  fs.writeFileSync(target(input), bytes);
  return bytes;
}
function migration(records: MetadataIndexRecord[] = [legacyRecord("src/a.ts", { id: "custom:consumed-id" })]) {
  const input = repo();
  const oldBytes = writeLegacy(input, records);
  const base = readVersionedMetadataIndex(oldBytes);
  const snapshot = readTrackedGitSnapshot(input);
  const claims = compileMetadataIndexLegacyIdentityClaims(base, hash(oldBytes), snapshot);
  const compiled = compileTrackedMetadataIndex({ snapshot, producerVersion: input.producerVersion, legacyIdentityClaims: claims });
  return { input, oldBytes, base, snapshot, claims, compiled };
}
afterEach(() => { vi.restoreAllMocks(); cleanupGitFixtures(); });

describe("same-index historical v1 identity migration", () => {
  test.each([
    { name: "ordinary custom", id: "externally-consumed:custom/source-42", bound: false },
    { name: "semantic-bound", id: "bound-product.source.src_a__ts", bound: true },
  ])("$name ID survives consented migration, check and zero-write replay", async ({ id, bound }) => {
    const input = repo(bound);
    const oldBytes = writeLegacy(input, [legacyRecord("src/a.ts", { id })]);
    const snapshot = readTrackedGitSnapshot(input);
    const check = await runTrackedCheckAsync({ ...input, migrateV1: true });
    expect(check.passed).toBe(false);
    expect(check.drift.map((item) => item.kind)).toEqual(["stale"]);
    expect(fs.readFileSync(target(input), "utf8")).toBe(oldBytes);
    const applied = await runTrackedApplyAsync({ ...input, migrateV1: true });
    expect(applied.metadataIndex.bytes).toBe(check.metadataIndex.bytes);
    expect(applied.migrationEvidence).toEqual(check.migrationEvidence);
    const claims = applied.metadataIndex.header.legacy_identity_claims!;
    expect(claims.source_index).toEqual({ schema: "l9.metadata-index/v1", sha256: hash(oldBytes) });
    expect(claims.snapshot_at_migration).toEqual({ revision: snapshot.revision, tree_oid: snapshot.tree_oid, object_format: snapshot.object_format });
    expect(claims.legacy_records[0].legacy_metadata_id).toBe(id);
    const current = applied.metadataIndex.records.find((record) => record.path === "src/a.ts")!;
    expect(current.metadata.id).toBe(trackedPathIdentity(input.repositoryId, Buffer.from("src/a.ts").toString("base64")));
    expect(current.metadata.id).not.toBe(id);
    expect(current.metadata.legacy_alias.id).not.toBe(id);
    expect(applied.migrationEvidence!.target_index.sha256).toBe(hash(applied.metadataIndex.bytes));
    expect(applied.migrationEvidence!.legacy_records).toEqual(claims.legacy_records);
    expect(applied.transaction.changedPaths).toEqual([METADATA_INDEX_RELATIVE_PATH]);
    expect(fs.readFileSync(path.join(input.root, "src/a.ts"), "utf8")).toBe(source);
    const write = vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("repeat must not write"); });
    const repeatedCheck = await runTrackedCheckAsync(input);
    const repeatedApply = await runTrackedApplyAsync(input);
    expect(repeatedCheck.passed).toBe(true);
    expect(repeatedApply.repositoryMutated).toBe(false);
    expect(repeatedApply.transaction.plannedWrites).toBe(0);
    expect(repeatedApply.transaction.committedWrites).toBe(0);
    expect(repeatedApply.transaction.changedPaths).toEqual([]);
    expect(repeatedApply.metadataIndex.bytes).toBe(applied.metadataIndex.bytes);
    expect(repeatedApply.metadataIndex.coverageBytes).toBe(applied.metadataIndex.coverageBytes);
    expect(repeatedCheck.migrationEvidence).toEqual(applied.migrationEvidence);
    expect(repeatedApply.migrationEvidence).toEqual(applied.migrationEvidence);
    expect(write).not.toHaveBeenCalled();
  });

  test.each([17, false, null, ["foreign", 4], { consumer: "external", version: 2 }].map((id) => ({ id })))("non-string JSON ID $id remains a historical claim, not an active alias", async ({ id }) => {
    const input = repo();
    writeLegacy(input, [legacyRecord("src/a.ts", { id })]);
    const result = await runTrackedApplyAsync({ ...input, migrateV1: true });
    expect(result.metadataIndex.header.legacy_identity_claims!.legacy_records[0]).toMatchObject({ legacy_metadata_id: id, legacy_id_state: "present" });
    expect(result.migrationEvidence!.legacy_records[0].legacy_metadata_id).toEqual(id);
    expect(result.metadataIndex.records.every((record) => typeof record.metadata.legacy_alias.id === "string" && record.content_hash === null)).toBe(true);
    expect((await runTrackedCheckAsync(input)).passed).toBe(true);
  });

  test("retired, protected and absent-ID records remain visible but never enlarge the current denominator", async () => {
    const input = repo(false, [{ path: "GIT_TREE_MANIFEST.json", contents: "{}" }, { path: "secrets/token", contents: "not read" }]);
    const oldBytes = writeLegacy(input, [
      legacyRecord("deleted/retired.ts", { id: "consumer.retired" }),
      legacyRecord("GIT_TREE_MANIFEST.json", { id: "consumer.manifest" }),
      legacyRecord("secrets/token", { id: { historical: true } }),
      legacyRecord("src/a.ts"),
    ]);
    const result = await runTrackedApplyAsync({ ...input, migrateV1: true });
    const claims = result.metadataIndex.header.legacy_identity_claims!;
    expect(claims.legacy_records).toHaveLength(4);
    expect(claims.legacy_records.find((record) => record.path === "deleted/retired.ts")!.snapshot_presence).toBe("absent_from_snapshot");
    expect(claims.legacy_records.find((record) => record.path === "GIT_TREE_MANIFEST.json")!.snapshot_presence).toBe("tracked");
    expect(claims.legacy_records.find((record) => record.path === "src/a.ts")).toMatchObject({ legacy_metadata_id: null, legacy_id_state: "absent" });
    expect(result.metadataIndex.records.map((record) => record.path)).toEqual([".l9/meta-authority.yaml", "src/a.ts"]);
    expect(result.metadataIndex.coverage.totals).toEqual({ tree_leaves: 4, indexed: 2, protected: 2, unsupported: 0 });
    expect(result.metadataIndex.coverage.entries).toHaveLength(4);
    expect(claims.source_index.sha256).toBe(hash(oldBytes));
    expect(claims.legacy_records.every((record) => record.legacy_content_hash_claim === "d".repeat(64) && record.legacy_content_hash_scope === "legacy_v1_claim_not_revalidated")).toBe(true);
    expect(result.metadataIndex.records.every((record) => record.content_hash === null && record.content_hash_scope === "not_inspected")).toBe(true);
    expect((await runTrackedCheckAsync(input)).passed).toBe(true);
  });

  test("historical snapshot/presence is unchanged when the current tree changes", async () => {
    const input = repo();
    writeLegacy(input, [legacyRecord("src/a.ts", { id: "old.a" }), legacyRecord("future.ts", { id: "old.future" })]);
    const first = await runTrackedApplyAsync({ ...input, migrateV1: true });
    const nextTree = fixtureTree(input.root, [{ path: ".l9/meta-authority.yaml", contents: authority }, { path: "future.ts", contents: "now tracked\n" }]);
    const revision = fixtureCommit(input.root, nextTree, input.revision);
    setFixtureHead(input.root, revision, true);
    const nextInput = { ...input, revision };
    const next = await runTrackedApplyAsync(nextInput);
    expect(next.metadataIndex.header.legacy_identity_claims).toEqual(first.metadataIndex.header.legacy_identity_claims);
    expect(next.migrationEvidence!.source_index).toEqual(first.migrationEvidence!.source_index);
    expect(next.migrationEvidence!.snapshot.revision).toBe(input.revision);
    expect(next.migrationEvidence!.target_index.sha256).toBe(hash(next.metadataIndex.bytes));
    expect(next.metadataIndex.coverage.snapshot.revision).toBe(revision);
    expect(next.metadataIndex.records.map((record) => record.path)).toEqual([".l9/meta-authority.yaml", "future.ts"]);
    expect((await runTrackedCheckAsync(nextInput)).passed).toBe(true);
    expect((await runTrackedApplyAsync(nextInput)).repositoryMutated).toBe(false);
  });

  test("custom IDs and empty v1 both require consent; historical override workflow fields are rejected", async () => {
    for (const records of [[], [legacyRecord("src/a.ts", { id: "custom" })]]) {
      const input = repo();
      const oldBytes = writeLegacy(input, records);
      const check = await runTrackedCheckAsync(input);
      expect(check.drift[0].message).toMatch(/migrateV1/);
      expect(check.migrationEvidence).toBeNull();
      expect(check.metadataIndex.header).not.toHaveProperty("legacy_identity_claims");
      await expect(runTrackedApplyAsync({ ...input, migrateV1: false })).rejects.toThrow(/migrateV1/);
      expect(fs.readFileSync(target(input), "utf8")).toBe(oldBytes);
      const migrated = await runTrackedApplyAsync({ ...input, migrateV1: true });
      expect(migrated.metadataIndex.header.legacy_identity_claims!.legacy_records).toHaveLength(records.length);
      expect((await runTrackedCheckAsync(input)).passed).toBe(true);
    }
    const input = repo();
    expect(() => planTrackedOperation({ ...input, legacyIdentityClaims: {} } as never)).toThrow(/unsupported/);
    expect(() => runTrackedCoverage({ ...input, legacyIdentityClaims: {} } as never)).toThrow(/unsupported/);
  });

  test("pure coverage does not read active history or accept history override, and default v1 parsing stays unchanged", () => {
    const { input, oldBytes } = migration();
    const read = vi.spyOn(fs, "readFileSync").mockImplementation(() => { throw new Error("pure coverage must not read index/subjects"); });
    const write = vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("pure coverage must not write"); });
    const result = runTrackedCoverage(input);
    expect(result.header).not.toHaveProperty("legacy_identity_claims");
    expect(result.coverage.subject_content_reads).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(serializeMetadataIndex(parseMetadataIndex(oldBytes))).toBe(oldBytes);
  });

  test("final target hash stays external, historic source hash covers old bytes, and receipt parsing binds the full header", () => {
    const { base, snapshot, oldBytes, compiled, claims } = migration();
    const evidence = compileMetadataIndexMigrationEvidence(base, hash(oldBytes), compiled, snapshot);
    expect(Object.keys(claims).sort()).toEqual(["legacy_records", "snapshot_at_migration", "source_index"]);
    expect(compiled.header).not.toHaveProperty("target_index");
    expect(compiled.bytes).not.toContain('"target_index"');
    expect(compiled.bytes).not.toContain(compiled.sha256);
    expect(evidence.target_index.sha256).toBe(hash(compiled.bytes));
    expect(compiled.coverage.index.sha256).toBe(hash(compiled.bytes));
    expect(parseTrackedCoverage(compiled.coverageBytes, snapshot, compiled.records, compiled.header)).toEqual(compiled.coverage);
    expect(() => parseTrackedCoverage(compiled.coverageBytes, snapshot, compiled.records)).toThrow(/closure/);
    expect(() => compileMetadataIndexLegacyIdentityClaims(base, "a".repeat(64), snapshot)).toThrow(/actual prior/);
    expect(() => compileMetadataIndexMigrationEvidence(base, hash(oldBytes), { ...compiled, sha256: "a".repeat(64) }, snapshot)).toThrow(/final serialized/);
    expect(() => compileMetadataIndexMigrationEvidence(base, hash(oldBytes), { ...compiled, bytes: `${compiled.bytes}\n` }, snapshot)).toThrow(/final serialized/);
    expect(readVersionedMetadataIndex(compiled.bytes).schema).toBe("l9.metadata-index/v2");
    expect(Object.isFrozen(compiled.header.legacy_identity_claims)).toBe(true);
    expect(Object.isFrozen(compiled.header.legacy_identity_claims!.legacy_records)).toBe(true);
  });

  test.each([
    { name: "empty", id: "" }, { name: "control", id: "custom\nid" }, { name: "surrogate", id: "\uD800" },
  ])("unsafe $name legacy ID holds consented check/apply with no writes", async ({ id }) => {
    const input = repo();
    const oldBytes = writeLegacy(input, [legacyRecord("src/a.ts", { id })]);
    expect((await runTrackedCheckAsync({ ...input, migrateV1: true })).drift[0].kind).toBe("conflict");
    await expect(runTrackedApplyAsync({ ...input, migrateV1: true })).rejects.toThrow(/UNMERGEABLE/);
    expect(fs.readFileSync(target(input), "utf8")).toBe(oldBytes);
  });

  test.each([
    ["wrong source schema", (claims: MetadataIndexLegacyIdentityClaimsV2) => { claims.source_index.schema = "l9.metadata-index/v2" as never; }],
    ["bad source hash", (claims: MetadataIndexLegacyIdentityClaimsV2) => { claims.source_index.sha256 = "bad"; }],
    ["snapshot format mismatch", (claims: MetadataIndexLegacyIdentityClaimsV2) => { claims.snapshot_at_migration.object_format = "sha256"; }],
    ["path bytes mismatch", (claims: MetadataIndexLegacyIdentityClaimsV2) => { claims.legacy_records[0].path_bytes_base64 = Buffer.from("other").toString("base64"); }],
    ["canonical ID mismatch", (claims: MetadataIndexLegacyIdentityClaimsV2) => { claims.legacy_records[0].canonical_id = "custom"; }],
    ["absent ID contradiction", (claims: MetadataIndexLegacyIdentityClaimsV2) => { claims.legacy_records[0].legacy_id_state = "absent"; }],
    ["current hash claim", (claims: MetadataIndexLegacyIdentityClaimsV2) => { claims.legacy_records[0].legacy_content_hash_scope = "not_inspected" as never; }],
    ["invalid presence", (claims: MetadataIndexLegacyIdentityClaimsV2) => { claims.legacy_records[0].snapshot_presence = "indexed" as never; }],
    ["duplicate path", (claims: MetadataIndexLegacyIdentityClaimsV2) => { claims.legacy_records.push(claims.legacy_records[0]); }],
    ["self-referential target hash", (claims: MetadataIndexLegacyIdentityClaimsV2) => { Object.assign(claims, { target_index: { schema: "l9.metadata-index/v2", sha256: "a".repeat(64) } }); }],
  ])("corrupt history %s is rejected by serializer/reader and holds governed operations", async (_name, mutate) => {
    const { input, compiled } = migration();
    const claims = structuredClone(compiled.header.legacy_identity_claims!);
    mutate(claims);
    const header = { ...compiled.header, legacy_identity_claims: claims };
    expect(() => serializeMetadataIndexV2(compiled.records, header)).toThrow();
    const damaged = `${JSON.stringify(header)}\n${compiled.bytes.split("\n").slice(1).join("\n")}`;
    fs.writeFileSync(target(input), damaged);
    expect(() => readVersionedMetadataIndex(damaged)).toThrow();
    expect((await runTrackedCheckAsync(input)).drift[0].kind).toBe("conflict");
    await expect(runTrackedApplyAsync(input)).rejects.toThrow(/UNMERGEABLE/);
    expect(fs.readFileSync(target(input), "utf8")).toBe(damaged);
  });

  test("retention guard rejects losing/changing any known ID, removed records or altered old-snapshot claims", () => {
    const { base, snapshot, claims, compiled } = migration([legacyRecord("src/a.ts", { id: "custom" }), legacyRecord("retired.ts", { id: { old: 1 } })]);
    expect(metadataIndexMigrationAliasProblem(base, compiled)).toBeNull();
    const changes: Array<(claims: MetadataIndexLegacyIdentityClaimsV2) => void> = [
      (value) => { value.legacy_records[0].legacy_metadata_id = { old: 2 }; },
      (value) => { value.legacy_records.pop(); },
      (value) => { value.source_index.sha256 = "a".repeat(64); },
      (value) => { value.snapshot_at_migration.revision = "e".repeat(40); },
      (value) => { value.legacy_records[0].snapshot_presence = "tracked"; },
    ];
    const v2base = readVersionedMetadataIndex(compiled.bytes);
    for (const change of changes) {
      const changed = structuredClone(claims); change(changed);
      const targetIndex = compileTrackedMetadataIndex({ snapshot, producerVersion: "4.3.0", legacyIdentityClaims: changed });
      expect(metadataIndexMigrationAliasProblem(base, targetIndex)).toMatch(/ALIAS_LOSS/);
      expect(metadataIndexMigrationAliasProblem(v2base, targetIndex)).toMatch(/unchanged/);
    }
    const without = compileTrackedMetadataIndex({ snapshot, producerVersion: "4.3.0" });
    expect(metadataIndexMigrationAliasProblem(base, without)).toMatch(/every known/);
    expect(metadataIndexMigrationAliasProblem(v2base, without)).toMatch(/unchanged/);
    const projectionChanged: TrackedMetadataCompilation = structuredClone(compiled);
    projectionChanged.records[0].metadata.legacy_alias.id = "custom";
    expect(metadataIndexMigrationAliasProblem(base, projectionChanged)).toMatch(/projection mismatch/);
  });

  test("cycles and non-JSON historical ID values cannot enter the compiler or serializer", () => {
    const { snapshot, compiled, claims } = migration();
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const id of [cycle, undefined, 1n, Infinity, () => true, Symbol("alias")]) {
      const altered = structuredClone(claims); altered.legacy_records[0].legacy_metadata_id = id;
      expect(() => compileTrackedMetadataIndex({ snapshot, producerVersion: "4.3.0", legacyIdentityClaims: altered })).toThrow();
      expect(() => serializeMetadataIndexV2(compiled.records, { ...compiled.header, legacy_identity_claims: altered })).toThrow();
    }
    const aliasCycle = structuredClone(claims); aliasCycle.legacy_records[0].legacy_metadata_id = aliasCycle;
    expect(() => compileTrackedMetadataIndex({ snapshot, producerVersion: "4.3.0", legacyIdentityClaims: aliasCycle })).toThrow(/cycle/);
  });

  test("header history uses exact UTF-8 raw path order with no NFC folding; unsafe legacy path is held", () => {
    const { snapshot, base, oldBytes } = migration([legacyRecord("é.ts", { id: "composed" }), legacyRecord("e\u0301.ts", { id: "decomposed" })]);
    const claims = compileMetadataIndexLegacyIdentityClaims(base, hash(oldBytes), snapshot);
    expect(claims.legacy_records.map((record) => record.path)).toEqual(["e\u0301.ts", "é.ts"]);
    expect(new Set(claims.legacy_records.map((record) => record.canonical_id)).size).toBe(2);
    const reversed = structuredClone(claims); reversed.legacy_records.reverse();
    expect(() => compileTrackedMetadataIndex({ snapshot, producerVersion: "4.3.0", legacyIdentityClaims: reversed })).toThrow(/raw path order/);
    const invalidBytes = serializeMetadataIndex([legacyRecord("bad\uD800.ts", { id: "custom" })]);
    expect(() => compileMetadataIndexLegacyIdentityClaims(readVersionedMetadataIndex(invalidBytes), hash(invalidBytes), snapshot)).toThrow(/spelling/);
  });

  test("schema contracts accept complete nullable evidence and reject missing evidence/target-hash headers", async () => {
    // ESLint's installed AJV supports these validation keywords; meta-validation is
    // disabled because its bundled metaschema is draft-07, while the files declare 2020-12.
    const validator = new Ajv({ meta: false, validateSchema: false, unknownFormats: "ignore" });
    for (const name of ["metadata-index-migration-v2", "metadata-index-header-v2", "metadata-index-record-v2", "metadata-coverage-v2", "tracked-operations-v2"]) {
      validator.addSchema(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "schemas", `${name}.schema.json`), "utf8")));
    }
    const input = repo(); writeLegacy(input, [legacyRecord("src/a.ts", { id: { old: [true, 1, null] } })]);
    const checked = await runTrackedCheckAsync({ ...input, migrateV1: true });
    const applied = await runTrackedApplyAsync({ ...input, migrateV1: true });
    const checkSchema = "https://l9.dev/schemas/tracked-operations-v2.schema.json#/$defs/checkResult";
    const applySchema = "https://l9.dev/schemas/tracked-operations-v2.schema.json#/$defs/applyResult";
    expect(validator.validate(checkSchema, checked)).toBe(true);
    expect(validator.validate(applySchema, applied)).toBe(true);
    expect(validator.validate(checkSchema, { ...checked, migrationEvidence: null })).toBe(true);
    const { migrationEvidence: _evidence, ...missing } = checked;
    expect(validator.validate(checkSchema, missing)).toBe(false);
    expect(validator.validate(applySchema, { ...applied, migrationEvidence: {} })).toBe(false);
    expect(validator.validate("https://l9.dev/schemas/metadata-index-header-v2.schema.json", { ...applied.metadataIndex.header, legacy_identity_claims: { ...applied.metadataIndex.header.legacy_identity_claims, target_index: applied.migrationEvidence!.target_index } })).toBe(false);
    const invalid = structuredClone(applied.migrationEvidence!); invalid.legacy_records[0].legacy_id_state = "absent";
    expect(validator.validate("https://l9.dev/schemas/metadata-index-migration-v2.schema.json", invalid)).toBe(false);
    const before = fixtureGit(input.root, ["status", "--porcelain=v1", "-z"]);
    expect((await runTrackedCheckAsync(input)).passed).toBe(true);
    expect(fixtureGit(input.root, ["status", "--porcelain=v1", "-z"])).toEqual(before);
  });
});
