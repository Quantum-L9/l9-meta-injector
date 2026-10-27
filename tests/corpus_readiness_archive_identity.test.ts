// corpus_readiness_archive_identity.test.ts — a body's archive count counts
// physical archives.
//
// Two roots that each hold a `widget/old.zip` hold two archives, not one. The
// readiness input names an archive by the same root-scoped identity the
// snapshot's `archives[]` carry, so the count cannot fold two disks' archives
// together because their paths happen to match (RC-090).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { runCorpusScan } from "../src/corpus_scan";
import { writeRawZip } from "./helpers/zip_fixtures";

/**
 * The archive ids the scan handed readiness. Readiness consumes them only to
 * count, and emits none, so the pass-through below records what it was given
 * and changes nothing about what it computes.
 */
const seenArchiveIds: (string | null | undefined)[] = [];
vi.mock("../src/corpus_readiness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/corpus_readiness")>();
  return {
    ...actual,
    buildReadinessEvidence: (input: Parameters<typeof actual.buildReadinessEvidence>[0]) => {
      for (const artifact of input.artifacts) seenArchiveIds.push(artifact.archive_id);
      return actual.buildReadinessEvidence(input);
    },
  };
});

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-readiness-archive-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function widgetRoot(note: string, extraMembers: { name: string; content: string }[] = []): string {
  const root = tmp();
  fs.mkdirSync(path.join(root, "widget"), { recursive: true });
  fs.writeFileSync(path.join(root, "widget", "package.json"), '{\n  "name": "widget"\n}\n', "utf8");
  writeRawZip(path.join(root, "widget", "old.zip"), [{ name: "notes.md", content: note }, ...extraMembers]);
  return root;
}

async function widgetBody(roots: { path: string; name: string }[]) {
  seenArchiveIds.length = 0;
  const result = await runCorpusScan({ roots, producerVersion: "test" });
  const manifests = result.snapshot.artifacts
    .filter((artifact) => artifact.root_relative_path === "widget/package.json")
    .map((artifact) => artifact.virtual_source_id);
  const body = result.readiness.bodies_of_work.find((candidate) =>
    manifests.every((id) => candidate.member_ids.includes(id)));
  return { result, body };
}

describe("readiness archive identity", () => {
  it("REG-WU-046-RC-090-a: counts two roots' same-path archives as two", async () => {
    const { body } = await widgetBody([
      { path: widgetRoot("# Old notes\nFrom the first disk.\n"), name: "disk-a" },
      { path: widgetRoot("# Old notes\nFrom the second disk, different words.\n"), name: "disk-b" },
    ]);
    expect(body).toBeDefined();
    expect(body?.root_ids).toHaveLength(2);
    expect(body?.metrics.corpus.archive_count).toBe(2);
  });

  it("REG-WU-046-RC-090-b: still counts two members of one archive as one", async () => {
    const { body } = await widgetBody([
      {
        path: widgetRoot("# Old notes\nOne archive.\n", [{ name: "more.md", content: "# More\nSame archive.\n" }]),
        name: "disk-a",
      },
    ]);
    expect(body).toBeDefined();
    expect(body?.metrics.corpus.archive_count).toBe(1);
  });

  it("REG-WU-046-RC-090-c: names every archive by an identity the snapshot's archives carry", async () => {
    const { result } = await widgetBody([
      { path: widgetRoot("# Old notes\nFrom the first disk.\n"), name: "disk-a" },
      { path: widgetRoot("# Old notes\nFrom the second disk, different words.\n"), name: "disk-b" },
    ]);
    const snapshotArchiveIds = new Set(result.snapshot.archives.map((archive) => archive.archive_id));
    const readinessArchiveIds = seenArchiveIds.filter((id): id is string => typeof id === "string");
    expect(readinessArchiveIds.length).toBeGreaterThan(0);
    for (const id of readinessArchiveIds) expect(snapshotArchiveIds.has(id), id).toBe(true);
    expect(new Set(readinessArchiveIds).size).toBe(2);
  });
});
