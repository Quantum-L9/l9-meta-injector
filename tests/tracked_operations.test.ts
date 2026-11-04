import * as fs from "node:fs";
import * as path from "node:path";
import { vi } from "vitest";
vi.mock("node:fs", async (importOriginal) => ({ ...await importOriginal<typeof import("node:fs")>() }));
import { runTrackedCoverage, runTrackedCheckAsync, runTrackedApplyAsync } from "../src/carrier_operation";
import { serializeMetadataIndex, compileTrackedMetadataIndex, readVersionedMetadataIndex, METADATA_INDEX_RELATIVE_PATH } from "../src/metadata_index";
import type { TrackedCoverageInput } from "../src/operation_contracts";
import * as transactions from "../src/file_transaction";
import {
  fixtureRepository, fixtureTree, fixtureCommit, setFixtureHead, fixtureGit, cleanupGitFixtures, scratchDirectory,
} from "./helpers/git_tree_fixtures";

const authority = `schema: l9.meta-authority/v1\nwriter:\n  repository: Quantum-L9/l9-meta-injector\n  ref: ${"a".repeat(40)}\ndefault_carrier: central_manifest\nlegacy_writers: forbidden\ninline_allow: ["prompts/**/*.md"]\n`;
function repo(extra: Array<{ path: string; contents: string; mode?: "100644" | "100755" | "120000" }> = []): TrackedCoverageInput {
  const root = fixtureRepository();
  const tree = fixtureTree(root, [
    { path: ".l9/meta-authority.yaml", contents: authority },
    { path: "src/a.ts", contents: "export const answer = 42;\n" },
    { path: "prompts/p.md", contents: "# Prompt\n\nExact body.\n" }, ...extra,
  ]);
  const revision = fixtureCommit(root, tree);
  setFixtureHead(root, revision, true);
  return { root, revision, repositoryId: "Owner/Repo", contract: "l9.tracked-carrier-policy/v2", producerVersion: "4.3.0" };
}
const indexTarget = (input: TrackedCoverageInput): string => path.join(input.root, METADATA_INDEX_RELATIVE_PATH);
afterEach(() => { vi.restoreAllMocks(); cleanupGitFixtures(); });

function injectTransaction(stage: transactions.TransactionFaultStage, change: (root: string) => void): void {
  const original = transactions.executeFileTransaction;
  vi.spyOn(transactions, "executeFileTransaction").mockImplementation((root, intents, options = {}) => original(root, intents, {
    ...options,
    faultInjector: (context) => {
      if (context.stage === stage) change(root);
      options.faultInjector?.(context);
    },
  }));
}

describe("governed universal index-only operations", () => {
  test("G14 coverage never reads subject contents or writes anything even hidden binary/link payloads", () => {
    const input = repo([{ path: ".private/opaque", contents: "\0\xffunknown" }, { path: "archive.zip", contents: "not an archive" }, { path: "link", contents: "/outside/never-read", mode: "120000" }]);
    const original = fs.readFileSync;
    const before = fixtureGit(input.root, ["status", "--porcelain=v1", "-z"]);
    const read = vi.spyOn(fs, "readFileSync").mockImplementation(((target: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (typeof target !== "number" && Buffer.from(String(target)).toString().startsWith(`${input.root}${path.sep}`)) throw new Error("forbidden subject read");
      return (original as (...args: unknown[]) => unknown)(target, ...args);
    }) as typeof fs.readFileSync);
    const write = vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("forbidden write"); });
    const result = runTrackedCoverage(input);
    expect(result.records).toHaveLength(6);
    expect(result.coverage.subject_content_reads).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    read.mockRestore(); write.mockRestore();
    expect(fixtureGit(input.root, ["status", "--porcelain=v1", "-z"])).toEqual(before);
    expect(fs.existsSync(indexTarget(input))).toBe(false);
  });
  test("G11-G15 check is in-memory/read-only and apply only writes active index; repeat is stable", async () => {
    const input = repo([{ path: ".hidden/generated", contents: "abc" }, { path: "link", contents: "missing", mode: "120000" }]);
    const source = fs.readFileSync(path.join(input.root, "prompts/p.md"));
    const check = await runTrackedCheckAsync(input);
    expect(check.passed).toBe(false);
    expect(check.drift[0].kind).toBe("missing");
    expect(fs.existsSync(indexTarget(input))).toBe(false);
    const applied = await runTrackedApplyAsync(input);
    expect(applied.passed).toBe(true);
    expect(applied.transaction.changedPaths).toEqual([METADATA_INDEX_RELATIVE_PATH]);
    expect(applied.sourceMutated).toBe(false);
    expect(fs.readFileSync(path.join(input.root, "prompts/p.md"))).toEqual(source);
    expect(fs.readlinkSync(path.join(input.root, "link"))).toBe("missing");
    expect(fs.existsSync(path.join(input.root, "prompts/p.md.l9meta.yaml"))).toBe(false);
    expect(readVersionedMetadataIndex(fs.readFileSync(indexTarget(input), "utf8")).schema).toBe("l9.metadata-index/v2");
    expect((await runTrackedCheckAsync(input)).passed).toBe(true);
    const repeated = await runTrackedApplyAsync(input);
    expect(repeated.repositoryMutated).toBe(false);
    expect(repeated.transaction.changedPaths).toEqual([]);
    expect(repeated.metadataIndex.bytes).toBe(applied.metadataIndex.bytes);
    expect(repeated.metadataIndex.coverageBytes).toBe(applied.metadataIndex.coverageBytes);
  });
  test("G12-G13 replacing existing v1 requires explicit migrateV1, including empty v1", async () => {
    for (const bytes of ["", serializeMetadataIndex([{ schema: "l9.metadata-index/v1", path: "src/a.ts", carrier: "central_manifest", artifact_type: "source", content_hash: "a".repeat(64), metadata: {} }])]) {
      const input = repo(); fs.writeFileSync(indexTarget(input), bytes);
      await expect(runTrackedApplyAsync(input)).rejects.toThrow(/migrateV1/);
      expect(fs.readFileSync(indexTarget(input), "utf8")).toBe(bytes);
      expect((await runTrackedCheckAsync(input)).drift[0].kind).toBe("conflict");
      await runTrackedApplyAsync({ ...input, migrateV1: true });
      expect(readVersionedMetadataIndex(fs.readFileSync(indexTarget(input), "utf8")).schema).toBe("l9.metadata-index/v2");
    }
  });
  test("G16 authority is required and changing its writer binding holds without writes", async () => {
    const input = repo();
    await expect(runTrackedApplyAsync({ ...input, expectedWriterRef: "b".repeat(40) })).rejects.toThrow(/AUTHORITY/);
    expect(fs.existsSync(indexTarget(input))).toBe(false);
    fs.rmSync(path.join(input.root, ".l9/meta-authority.yaml"));
    await expect(runTrackedApplyAsync(input)).rejects.toThrow(/AUTHORITY/);
    expect(fs.existsSync(indexTarget(input))).toBe(false);
  });
  test("G16 historical snapshot, dirty staged sources, and dirty unstaged protected controls hold", async () => {
    const input = repo();
    fs.appendFileSync(path.join(input.root, "src/a.ts"), "// changed\n");
    await expect(runTrackedApplyAsync(input)).rejects.toThrow(/unstaged/);
    fixtureGit(input.root, ["add", "src/a.ts"]);
    await expect(runTrackedApplyAsync(input)).rejects.toThrow(/staged/);
    fixtureGit(input.root, ["reset", "--hard", input.revision]);
    fs.appendFileSync(path.join(input.root, ".l9/meta-authority.yaml"), "# changed\n");
    await expect(runTrackedApplyAsync(input)).rejects.toThrow(/unstaged/);
    fixtureGit(input.root, ["reset", "--hard", input.revision]);
    const tree = fixtureTree(input.root, [{ path: "other", contents: "next" }]);
    const next = fixtureCommit(input.root, tree, input.revision);
    setFixtureHead(input.root, next);
    await expect(runTrackedApplyAsync(input)).rejects.toThrow(/current HEAD/);
    expect(fs.existsSync(indexTarget(input))).toBe(false);
  });
  test("G16 stale source just before commit holds and source staleness after commit rolls index back", async () => {
    const before = repo();
    injectTransaction("before_commit", (root) => fs.appendFileSync(path.join(root, "src/a.ts"), "// concurrent\n"));
    await expect(runTrackedApplyAsync(before)).rejects.toThrow(/unstaged/);
    expect(fs.existsSync(indexTarget(before))).toBe(false);
    vi.restoreAllMocks();
    const after = repo();
    fs.writeFileSync(indexTarget(after), "");
    injectTransaction("before_validation", (root) => fs.appendFileSync(path.join(root, "src/a.ts"), "// concurrent\n"));
    await expect(runTrackedApplyAsync({ ...after, migrateV1: true })).rejects.toThrow(/unstaged/);
    expect(fs.readFileSync(indexTarget(after), "utf8")).toBe("");
    expect(fs.readFileSync(path.join(after.root, "src/a.ts"), "utf8")).toContain("// concurrent");
  });
  test("G16 index CAS rejects concurrent bytes even if the tree snapshot is unchanged", async () => {
    const input = repo(); fs.writeFileSync(indexTarget(input), "");
    injectTransaction("before_commit", (root) => fs.writeFileSync(path.join(root, METADATA_INDEX_RELATIVE_PATH), serializeMetadataIndex([{ schema: "l9.metadata-index/v1", path: "other", carrier: "central_manifest", artifact_type: "unknown", content_hash: "b".repeat(64), metadata: {} }])));
    await expect(runTrackedApplyAsync({ ...input, migrateV1: true })).rejects.toThrow(/CAS/);
    expect(readVersionedMetadataIndex(fs.readFileSync(indexTarget(input), "utf8")).schema).toBe("l9.metadata-index/v1");
  });
  test("G16 unsafe index destination, dangling link, and .l9 ancestry never dereference/write outside", async () => {
    const outside = scratchDirectory();
    const target = path.join(outside, "outside-index"); fs.writeFileSync(target, "outside unchanged");
    for (const destination of [target, path.join(outside, "missing")]) {
      const input = repo(); fs.symlinkSync(destination, indexTarget(input));
      const checked = await runTrackedCheckAsync(input);
      expect(checked.passed).toBe(false);
      expect(checked.drift[0].kind).toBe("conflict");
      await expect(runTrackedApplyAsync(input)).rejects.toThrow(/regular file/);
      expect(fs.lstatSync(indexTarget(input)).isSymbolicLink()).toBe(true);
    }
    expect(fs.readFileSync(target, "utf8")).toBe("outside unchanged");
    const input = repo();
    fs.renameSync(path.join(input.root, ".l9"), path.join(outside, "l9"));
    fs.symlinkSync(path.join(outside, "l9"), path.join(input.root, ".l9"));
    await expect(runTrackedApplyAsync(input)).rejects.toThrow(/real directory/);
  });
  test("active v2 identity mismatch/malformed base are conflicts, never silently replaced", async () => {
    const input = repo();
    const other = compileTrackedMetadataIndex({ snapshot: { repository_id: "Other/Repo", revision: input.revision, tree_oid: "a".repeat(40), object_format: "sha1", entries: [] }, producerVersion: input.producerVersion });
    fs.writeFileSync(indexTarget(input), other.bytes);
    expect((await runTrackedCheckAsync(input)).drift[0].kind).toBe("conflict");
    await expect(runTrackedApplyAsync(input)).rejects.toThrow(/repository identity/);
    fs.writeFileSync(indexTarget(input), "broken\n");
    expect((await runTrackedCheckAsync(input)).drift[0].kind).toBe("conflict");
    await expect(runTrackedApplyAsync({ ...input, migrateV1: true })).rejects.toThrow(/UNMERGEABLE/);
    expect(fs.readFileSync(indexTarget(input), "utf8")).toBe("broken\n");
  });
  test("G16 destination symlink swap immediately before commit is held without outside writes", async () => {
    const input = repo(); fs.writeFileSync(indexTarget(input), "");
    const outside = path.join(scratchDirectory(), "outside"); fs.writeFileSync(outside, "outside unchanged");
    injectTransaction("before_commit", (root) => {
      fs.rmSync(path.join(root, METADATA_INDEX_RELATIVE_PATH));
      fs.symlinkSync(outside, path.join(root, METADATA_INDEX_RELATIVE_PATH));
    });
    await expect(runTrackedApplyAsync({ ...input, migrateV1: true })).rejects.toThrow(/regular file/);
    expect(fs.readFileSync(outside, "utf8")).toBe("outside unchanged");
    expect(fs.readFileSync(path.join(input.root, "src/a.ts"), "utf8")).toBe("export const answer = 42;\n");
  });
  test("pending transaction state cannot trigger legacy source recovery from this seam", async () => {
    const input = repo(); fs.mkdirSync(path.join(input.root, ".l9/.transactions"));
    fs.writeFileSync(path.join(input.root, ".l9/.transactions/pending.json"), "unsafe state");
    await expect(runTrackedApplyAsync(input)).rejects.toThrow(/recovery workflow/);
    expect(fs.existsSync(indexTarget(input))).toBe(false);
  });
  test("explicit opt-in cannot dispatch legacy inventory/pipeline/source options", () => {
    const input = repo();
    expect(() => runTrackedCoverage({ ...input, contract: "wrong" } as never)).toThrow(/opt-in/);
    expect(() => runTrackedCoverage({ ...input, localFiles: true } as never)).toThrow(/unsupported/);
    expect(() => runTrackedCoverage({ ...input, producerVersion: "Unknown" })).toThrow(/producer version/);
  });
});
