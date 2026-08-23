// corpus_root_history.test.ts — when "the same root as last time" is worth saying.
//
// A root nobody named is keyed by its mount point's final path segment.
// `/Volumes/Backup` and an unrelated `/mnt/usb/Backup` therefore produce the same
// root id, and nothing in the bytes tells them apart. Looking at one such disk
// once is fine. Building history on it is not: the diff would describe changes
// that never happened, the resume would adopt another disk's completions, and the
// incremental scan would report a hash nobody read for a file nobody opened.
//
// So these tests are about a refusal, and about the one thing that lifts it.
// Every case below is either "this run makes no continuity claim, so it proceeds"
// or "this run makes one it cannot support, so it stops and says what would fix
// it". The override exists because the operator is the only party who knows
// whether two directories called `Backup` are the same disk — and using it is
// recorded, because a claim someone else underwrote should be visible later.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  InferredRootHistoryError,
  assertLongitudinalRootIdentityAuthorized,
  identityClassOf,
  inferredRootHistoryOverride,
} from "../src/corpus_root_history";
import { DEFAULT_CORPUS_BUDGETS, CorpusSessionStore } from "../src/corpus_session";
import { corpusRootId } from "../src/corpus_roots";
import { runCorpusScan } from "../src/corpus_scan";

const scratch: string[] = [];
function tmp(prefix = "l9-root-history-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** A root directory with one plan in it, under a chosen directory name. */
function rootNamed(name: string): string {
  const base = tmp();
  const root = path.join(base, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "plan.md"),
    "# Rollout Plan\n\nStatus: wip\n\n- [ ] Stage one\n",
    "utf8",
  );
  return root;
}

// ───────────────────────── the rule itself ─────────────────────────

describe("the authorization rule", () => {
  const declared = (key: string) => ({
    root_id: corpusRootId(key),
    root_key: key,
    root_identity_class: "declared" as const,
  });
  const inferred = (key: string) => ({
    root_id: corpusRootId(key),
    root_key: key,
    root_identity_class: "inferred" as const,
  });
  /** A snapshot or session written before the class was recorded. */
  const legacy = (key: string) => ({ root_id: corpusRootId(key), root_key: key });

  const authorize = (
    previous: ReturnType<typeof declared>[] | ReturnType<typeof legacy>[],
    current: ReturnType<typeof declared>[],
    allow = false,
  ) => assertLongitudinalRootIdentityAuthorized({
    operation: "previous-snapshot diff",
    previousRoots: previous,
    currentRoots: current,
    allowInferredRootHistory: allow,
  });

  it("allows a claim between two roots the operator named", () => {
    const result = authorize([declared("Backup")], [declared("Backup")]);
    expect(result.matched_root_ids).toEqual([corpusRootId("Backup")]);
    expect(result.weak_claims).toEqual([]);
    expect(result.override_used).toBe(false);
  });

  it("refuses inferred on both sides", () => {
    expect(() => authorize([inferred("Backup")], [inferred("Backup")]))
      .toThrow(InferredRootHistoryError);
  });

  it("refuses a root named now but not before", () => {
    // The previous key was a basename, so the thing being matched against may
    // not be this root at all. Naming it afterwards cannot fix that.
    expect(() => authorize([inferred("Backup")], [declared("Backup")]))
      .toThrow(/previously inferred, now declared/);
  });

  it("refuses a root named before but not now", () => {
    expect(() => authorize([declared("Backup")], [inferred("Backup")]))
      .toThrow(/previously declared, now inferred/);
  });

  it("refuses when any matched root is weak, even beside declared ones", () => {
    expect(() => authorize(
      [declared("OldSSD"), inferred("Backup")],
      [declared("OldSSD"), inferred("Backup")],
    )).toThrow(/'Backup'/);
  });

  it("reads a record with no identity class as inferred", () => {
    expect(identityClassOf(legacy("Backup"))).toBe("inferred");
    expect(() => authorize([legacy("Backup")], [declared("Backup")]))
      .toThrow(InferredRootHistoryError);
  });

  it("ignores a root that only one side has", () => {
    // Added and removed roots make no continuity claim, so an added inferred
    // root never forces an override the operator could not reason about.
    const result = authorize([declared("OldSSD")], [declared("OldSSD"), inferred("NewDisk")]);
    expect(result.matched_root_ids).toEqual([corpusRootId("OldSSD")]);
    expect(result.weak_claims).toEqual([]);
  });

  it("proceeds on a weak claim the operator accepted, and says it was weak", () => {
    const result = authorize([inferred("Backup")], [inferred("Backup")], true);
    expect(result.override_used).toBe(true);
    expect(result.weak_claims.map((claim) => claim.root_key)).toEqual(["Backup"]);
  });

  it("names the operation, the root, both classes, the remedy and the override", () => {
    try {
      authorize([inferred("Backup")], [inferred("Backup")]);
      expect.unreachable("the guard should have refused");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("previous-snapshot diff");
      expect(message).toContain("'Backup'");
      expect(message).toContain("previously inferred, now inferred");
      expect(message).toContain("inferred basename identity");
      expect(message).toContain("--root <path>=<key>");
      expect(message).toContain("--allow-inferred-root-history");
    }
  });

  it("records an override only when one was used", () => {
    const weak = authorize([inferred("Backup")], [inferred("Backup")], true);
    const strong = authorize([declared("OldSSD")], [declared("OldSSD")]);
    expect(inferredRootHistoryOverride([{ operation: "resume", result: strong }])).toBeNull();
    const record = inferredRootHistoryOverride([
      { operation: "previous-snapshot diff", result: weak },
      { operation: "resume", result: weak },
    ]);
    expect(record?.enabled).toBe(true);
    expect(record?.affected_root_ids).toEqual([corpusRootId("Backup")]);
    expect(record?.operations).toEqual(["previous-snapshot diff", "resume"]);
  });
});

// ───────────────────────── through a real scan ─────────────────────────

describe("a scan", () => {
  it("reads an unnamed root once without complaint", async () => {
    // The convenient case, and it stays convenient: one look at a disk makes no
    // claim about any other run.
    const result = await runCorpusScan({
      roots: [{ path: rootNamed("Backup") }],
      producerVersion: "test",
    });
    expect(result.snapshot.roots[0]?.root_identity_class).toBe("inferred");
    expect(result.diff).toBeNull();
    expect(result.snapshot.operational_provenance).toBeUndefined();
  });

  it("refuses to diff an unnamed root against a previous snapshot", async () => {
    const root = rootNamed("Backup");
    const first = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    await expect(runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
      previousSnapshot: first.snapshot,
    })).rejects.toThrow(/refusing previous-snapshot diff/);
  });

  it("diffs an unnamed root when the operator accepts the weaker identity", async () => {
    const root = rootNamed("Backup");
    const first = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const second = await runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
      previousSnapshot: first.snapshot,
      allowInferredRootHistory: true,
    });

    expect(second.diff).not.toBeNull();
    // The caution the diff already carried, and the override beside it: one says
    // the match was weak, the other says who accepted that.
    expect(second.diff?.longitudinal_identity_cautions.length).toBeGreaterThan(0);
    expect(second.diff?.inferred_root_history_override?.enabled).toBe(true);
    expect(second.snapshot.operational_provenance?.inferred_root_history_override)
      .toEqual({
        enabled: true,
        affected_root_ids: [corpusRootId("Backup")],
        operations: ["previous-snapshot diff"],
      });
    expect(second.diagnostics.map((note) => note.code))
      .toContain("corpus.inferred_root_history_override");
  });

  it("diffs a named root with no override and no caution", async () => {
    const root = rootNamed("Backup");
    const roots = [{ path: root, name: "Backup" }];
    const first = await runCorpusScan({ roots, producerVersion: "test" });
    const second = await runCorpusScan({
      roots,
      producerVersion: "test",
      previousSnapshot: first.snapshot,
    });

    expect(second.diff).not.toBeNull();
    expect(second.diff?.longitudinal_identity_cautions).toEqual([]);
    expect(second.diff?.inferred_root_history_override).toBeUndefined();
    expect(second.snapshot.operational_provenance).toBeUndefined();
  });

  it("refuses a mixed history where one root was named and the other was not", async () => {
    const named = rootNamed("OldSSD");
    const unnamed = rootNamed("Backup");
    const first = await runCorpusScan({
      roots: [{ path: named, name: "OldSSD" }, { path: unnamed, name: "Backup" }],
      producerVersion: "test",
    });
    await expect(runCorpusScan({
      // The second root loses its name, so its continuity is now a guess.
      roots: [{ path: named, name: "OldSSD" }, { path: unnamed }],
      producerVersion: "test",
      previousSnapshot: first.snapshot,
    })).rejects.toThrow(/'Backup'/);
  });

  it("refuses a snapshot written before the identity class existed", async () => {
    const root = rootNamed("Backup");
    const first = await runCorpusScan({
      roots: [{ path: root, name: "Backup" }],
      producerVersion: "test",
    });
    // A document that does not say the operator named the root is not evidence
    // that they did.
    const legacySnapshot = {
      ...first.snapshot,
      roots: first.snapshot.roots.map((entry) => {
        const { root_identity_class: _dropped, ...rest } = entry;
        return rest as typeof entry;
      }),
    };
    await expect(runCorpusScan({
      roots: [{ path: root, name: "Backup" }],
      producerVersion: "test",
      previousSnapshot: legacySnapshot,
    })).rejects.toThrow(/previously inferred/);
  });

  it("refuses incremental hash reuse across an unnamed root", async () => {
    const root = rootNamed("Backup");
    const first = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    await expect(runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
      previousSnapshot: first.snapshot,
      verification: "incremental",
    })).rejects.toThrow(/refusing/);
  });

  it("keeps the corpus source identity out of the operator's authorization", async () => {
    // The override changes how strong a claim about history is. It changes
    // nothing about the bytes on the disk, so the identity of what was observed
    // must not move with it.
    const root = rootNamed("Backup");
    const first = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const withOverride = await runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
      previousSnapshot: first.snapshot,
      allowInferredRootHistory: true,
    });
    expect(withOverride.snapshot.corpus_source_snapshot_id)
      .toBe(first.snapshot.corpus_source_snapshot_id);
    expect(withOverride.snapshot.analysis.corpus_analysis_id)
      .toBe(first.snapshot.analysis.corpus_analysis_id);
  });

  it("refuses two unrelated directories that happen to share a basename", async () => {
    // The case the whole guard exists for: two different disks, one key.
    const first = await runCorpusScan({
      roots: [{ path: rootNamed("Backup") }],
      producerVersion: "test",
    });
    const other = rootNamed("Backup");
    fs.writeFileSync(path.join(other, "unrelated.md"), "# Something else entirely\n", "utf8");
    await expect(runCorpusScan({
      roots: [{ path: other }],
      producerVersion: "test",
      previousSnapshot: first.snapshot,
    })).rejects.toThrow(/refusing previous-snapshot diff/);
  });
});

// ───────────────────────── resume ─────────────────────────

describe("resuming a session", () => {
  function sessionFor(rootPath: string, key: string, declaredKey: boolean, resume: boolean) {
    return CorpusSessionStore.open({
      file: path.join(tmp("l9-root-history-session-"), "corpus-session.json"),
      roots: [{
        root_id: corpusRootId(key),
        root_key: key,
        absolute_path: rootPath,
        ...(declaredKey ? { root_identity_class: "declared" as const } : {}),
      }],
      budgets: { ...DEFAULT_CORPUS_BUDGETS, archive: {} },
      now: "2026-01-01T00:00:00.000Z",
      resume,
    });
  }

  it("makes no claim when it starts fresh", async () => {
    const root = rootNamed("Backup");
    const session = sessionFor(root, "Backup", false, false);
    const result = await runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
      session,
    });
    expect(result.snapshot.operational_provenance).toBeUndefined();
  });

  it("refuses to adopt an unnamed root's completions", async () => {
    const root = rootNamed("Backup");
    const file = path.join(tmp("l9-root-history-session-"), "corpus-session.json");
    const roots = [{ root_id: corpusRootId("Backup"), root_key: "Backup", absolute_path: root }];
    const budgets = { ...DEFAULT_CORPUS_BUDGETS, archive: {} };
    CorpusSessionStore.open({ file, roots, budgets, now: "2026-01-01T00:00:00.000Z" })
      .save("2026-01-01T00:00:00.000Z");

    const resumed = CorpusSessionStore.open({
      file,
      roots,
      budgets,
      now: "2026-01-02T00:00:00.000Z",
      resume: true,
    });
    expect(resumed.resumedRoots.length).toBeGreaterThan(0);
    await expect(runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
      session: resumed,
    })).rejects.toThrow(/refusing resume/);
  });

  it("adopts an unnamed root's completions when the operator accepts it", async () => {
    const root = rootNamed("Backup");
    const file = path.join(tmp("l9-root-history-session-"), "corpus-session.json");
    const roots = [{ root_id: corpusRootId("Backup"), root_key: "Backup", absolute_path: root }];
    const budgets = { ...DEFAULT_CORPUS_BUDGETS, archive: {} };
    CorpusSessionStore.open({ file, roots, budgets, now: "2026-01-01T00:00:00.000Z" })
      .save("2026-01-01T00:00:00.000Z");

    const result = await runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
      allowInferredRootHistory: true,
      session: CorpusSessionStore.open({
        file,
        roots,
        budgets,
        now: "2026-01-02T00:00:00.000Z",
        resume: true,
      }),
    });
    expect(result.snapshot.operational_provenance?.inferred_root_history_override?.operations)
      .toEqual(["resume"]);
  });

  it("adopts a named root's completions with no override", async () => {
    const root = rootNamed("Backup");
    const file = path.join(tmp("l9-root-history-session-"), "corpus-session.json");
    const roots = [{
      root_id: corpusRootId("Backup"),
      root_key: "Backup",
      absolute_path: root,
      root_identity_class: "declared" as const,
    }];
    const budgets = { ...DEFAULT_CORPUS_BUDGETS, archive: {} };
    CorpusSessionStore.open({ file, roots, budgets, now: "2026-01-01T00:00:00.000Z" })
      .save("2026-01-01T00:00:00.000Z");

    const result = await runCorpusScan({
      roots: [{ path: root, name: "Backup" }],
      producerVersion: "test",
      session: CorpusSessionStore.open({
        file,
        roots,
        budgets,
        now: "2026-01-02T00:00:00.000Z",
        resume: true,
      }),
    });
    expect(result.snapshot.operational_provenance).toBeUndefined();
  });

  it("refuses a session manifest written before the identity class existed", async () => {
    const root = rootNamed("Backup");
    const file = path.join(tmp("l9-root-history-session-"), "corpus-session.json");
    const roots = [{
      root_id: corpusRootId("Backup"),
      root_key: "Backup",
      absolute_path: root,
      root_identity_class: "declared" as const,
    }];
    const budgets = { ...DEFAULT_CORPUS_BUDGETS, archive: {} };
    CorpusSessionStore.open({ file, roots, budgets, now: "2026-01-01T00:00:00.000Z" })
      .save("2026-01-01T00:00:00.000Z");

    // Strip the class the way a manifest from an earlier release would have it.
    const stored = JSON.parse(fs.readFileSync(file, "utf8")) as {
      roots: { root_identity_class?: string }[];
    };
    for (const entry of stored.roots) delete entry.root_identity_class;
    fs.writeFileSync(file, JSON.stringify(stored, null, 2), "utf8");

    await expect(runCorpusScan({
      roots: [{ path: root, name: "Backup" }],
      producerVersion: "test",
      session: CorpusSessionStore.open({
        file,
        roots,
        budgets,
        now: "2026-01-02T00:00:00.000Z",
        resume: true,
      }),
    })).rejects.toThrow(/refusing resume/);
  });
});
