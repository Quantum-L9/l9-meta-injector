// corpus_resume_scale.test.ts — a large scan that died, and the run that finished it.
//
// Kept apart from the rest of the scale qualification because it is three passes
// over a ten-thousand-artifact corpus rather than one, and because what it proves
// is different: not that the scan survives the size, but that an interruption
// partway through costs the work that was in flight and nothing that was already
// finished.
//
// The interruption is a real failure rather than a simulated one. The cache
// throws once the run is inside the decode stage, which is what a killed process
// looks like from inside the scan: the session manifest and the cache hold
// everything already completed, and the run never reaches its outputs.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CorpusCache, MemoryCorpusCache } from "../src/corpus_cache";
import { runCorpusScan } from "../src/corpus_scan";
import { corpusRootId } from "../src/corpus_roots";
import { CorpusSessionStore, DEFAULT_CORPUS_BUDGETS } from "../src/corpus_session";
import { renderCorpusSnapshot } from "../src/corpus_snapshot";
import { writeScaleCorpus } from "./helpers/multi_root_fixtures";

const scratch: string[] = [];
function tmp(prefix = "l9-corpus-resume-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** The ceiling an operator raises deliberately for a corpus that is mostly ZIPs. */
const ARCHIVE_POLICY = { maxNestedArchiveCount: 512 };

const SPEC = {
  artifacts: 10000,
  archives: 100,
  nestedArchives: 10,
  duplicateClusters: 100,
  candidateProjects: 20,
  mixedDocumentsPerFormat: 10,
};

describe("a large scan that was interrupted", () => {
  it("resumes a scan that died partway and finishes with the same output", async () => {
    const base = tmp();
    const corpus = writeScaleCorpus(base, SPEC);
    const roots = corpus.roots.map((root) => ({ path: root, name: path.basename(root) }));
    const store = new MemoryCorpusCache("scale-resume");
    const sessionFile = path.join(tmp("l9-scale-session-"), "corpus-session.json");
    const sessionRoots = roots.map((root) => ({
      root_id: corpusRootId(root.name),
      root_key: root.name,
      absolute_path: root.path,
      // Resuming adopts completions recorded against a root id, which is a
      // continuity claim; the class the session was started under is what a
      // later resume is judged against.
      root_identity_class: "declared" as const,
    }));
    const budgets = { ...DEFAULT_CORPUS_BUDGETS, archive: {} };
    const options = {
      roots,
      producerVersion: "scale",
      // Off here, and on in `corpus_scale.test.ts`, which is the file that
      // qualifies semantic discovery at ten thousand documents. This file is
      // about resuming an interrupted scan and about the archive budget. Neither
      // is a function of the topic pass, and running it here would add a minute
      // to a test that measures something else.
      topics: { enabled: false },
      archivePolicy: ARCHIVE_POLICY,
    };

    // The interruption is real rather than simulated: the cache throws once the
    // run is inside the decode stage, which is what a killed process looks like
    // from inside the scan — work already completed is in the cache and named in
    // the session manifest, and the run never reaches its outputs. The threshold
    // is past the whole hashing pass on purpose, so the death lands in decoding
    // rather than before it and the resume has decoder work to carry forward.
    const decodeStageBegins = SPEC.artifacts + 1_000;
    let writesBeforeDeath = 0;
    const dying: CorpusCache = {
      enabled: true,
      root: null,
      get: (layer, key) => store.get(layer, key),
      put: (layer, key, payload) => {
        writesBeforeDeath += 1;
        if (writesBeforeDeath > decodeStageBegins) {
          throw new Error("scale-resume: simulated process death");
        }
        store.put(layer, key, payload);
      },
      stats: () => store.stats(),
      diagnostics: () => store.diagnostics(),
    };

    const interruptedSession = CorpusSessionStore.open({
      file: sessionFile,
      roots: sessionRoots,
      budgets,
      now: "2026-01-01T00:00:00.000Z",
    });
    await expect(runCorpusScan({ ...options, cache: dying, session: interruptedSession }))
      .rejects.toThrow(/simulated process death/);
    interruptedSession.save("2026-01-01T00:01:00.000Z");

    // A failed run leaves the session behind and publishes nothing.
    expect(fs.existsSync(sessionFile)).toBe(true);
    expect(writesBeforeDeath).toBeGreaterThan(decodeStageBegins);

    const resumedSession = CorpusSessionStore.open({
      file: sessionFile,
      roots: sessionRoots,
      budgets,
      now: "2026-01-01T00:02:00.000Z",
      resume: true,
    });
    expect(resumedSession.id).toBe(interruptedSession.id);
    // Both stages the death straddled are carried forward: every file already
    // hashed, and every document already decoded.
    expect(resumedSession.resumedCounts.source_ids).toBeGreaterThan(0);
    expect(resumedSession.resumedCounts.decoder_keys).toBeGreaterThan(0);

    const resumed = await runCorpusScan({ ...options, cache: store, session: resumedSession });

    // Work the dead run finished was not done again...
    expect(resumed.cacheStats.hits).toBeGreaterThan(0);
    // ...and the corpus it produced is the corpus a clean run produces.
    const clean = await runCorpusScan({ ...options, cache: new MemoryCorpusCache("scale-clean") });
    expect(renderCorpusSnapshot(resumed.snapshot)).toBe(renderCorpusSnapshot(clean.snapshot));
    expect(resumed.snapshot.verification.verification_class).toBe("fully_verified");
  }, 900_000);
});

describe("the archive budget at scale", () => {
  it("holds what it cannot expand, and says so rather than truncating quietly", async () => {
    const base = tmp();
    const corpus = writeScaleCorpus(base, {
      artifacts: 300, archives: 100, nestedArchives: 10, duplicateClusters: 10, candidateProjects: 4,
      mixedDocumentsPerFormat: 2,
    });
    // The default ceiling, deliberately left in place: an unbounded archive
    // expansion is how a scan becomes a zip bomb, and a corpus of a hundred ZIPs
    // is exactly where the ceiling bites.
    const result = await runCorpusScan({
      roots: corpus.roots.map((root) => ({ path: root, name: path.basename(root) })),
      producerVersion: "budget",
      // Off here, and on in `corpus_scale.test.ts`, which is the file that
      // qualifies semantic discovery at ten thousand documents. This file is
      // about resuming an interrupted scan and about the archive budget. Neither
      // is a function of the topic pass, and running it here would add a minute
      // to a test that measures something else.
      topics: { enabled: false },
    });

    const held = result.snapshot.archives.filter((archive) => !archive.expanded);
    expect(held.length).toBeGreaterThan(0);
    // Held is not lost: every one was still observed and hashed.
    for (const archive of held) expect(archive.content_hash).toMatch(/^sha256:/);
    // And the run says which limit it hit, so a short member count is explained
    // rather than being read as a corpus that simply held less.
    expect(result.diagnostics.some((d) => d.code === "archive.session_budget_exceeded")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "local-source.archive_held")).toBe(true);
  }, 300_000);
});
