// corpus_session.ts — resuming a scan that did not finish, and staying inside a budget.
//
// A corpus large enough to be interesting is large enough that something will
// interrupt the scan: a laptop lid, a full disk, an unplugged drive. The session
// manifest records what was finished so the next attempt starts where the last one
// stopped.
//
// What "finished" means is deliberately narrow. A completion record names a piece
// of work by its content-addressed key — the source id whose bytes were hashed,
// the archive whose members were staged, the decoder key that produced a
// document, the analysis key that consumed them. None of those keys mention a
// path, a run, or a time, so a completion recorded by one session is still true
// for the next one, and a completion that has stopped being true (because the
// bytes changed) simply produces a different key and is never consulted.
//
// The session manifest is operational. It carries absolute paths and wall-clock
// timestamps, because an operator needs those to understand a failed run, and for
// exactly that reason it is not part of any identity and not part of the cold/warm
// equivalence the qualification suite asserts.
import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalCorpusJson } from "./corpus_analysis";
import { compareCodePoints } from "./ordering";
import { stableId } from "./repository_model";

export const CORPUS_SESSION_SCHEMA = "l9.corpus-session/v1";

export interface CorpusSessionFailure {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  corpus_path?: string;
}

export interface CorpusSessionRoot {
  root_id: string;
  root_key: string;
  /** Operational only: where this root was mounted for this session. */
  absolute_path: string;
}

export interface CorpusResourceBudgets {
  max_parallel_hashers: number;
  max_parallel_decoders: number;
  /**
   * Candidate analysis workers. Recorded rather than exercised: candidate
   * generation is one pass over evidence already in memory, so raising this
   * buys nothing today. It is here because the budget is part of the session
   * manifest, and a resumed run must be able to see it was asked for.
   */
  max_parallel_analysis: number;
  max_parallel_embedding_requests: number;
  /** Ceiling on decoded text held in memory at once, in bytes. */
  max_memory_bytes: number;
  /** The archive session budget, carried verbatim from the archive policy. */
  archive: Record<string, number>;
}

export interface CorpusSession {
  schema: string;
  session_id: string;
  /** Corpus snapshot this session is working toward; null until roots are hashed. */
  corpus_snapshot_target: string | null;
  roots: CorpusSessionRoot[];
  completed_source_ids: string[];
  completed_archive_hashes: string[];
  completed_decoder_keys: string[];
  completed_analysis_keys: string[];
  failure_diagnostics: CorpusSessionFailure[];
  budgets: CorpusResourceBudgets;
  /** Operational. Excluded from every identity this package computes. */
  started_at: string;
  updated_at: string;
}

export const DEFAULT_CORPUS_BUDGETS: Omit<CorpusResourceBudgets, "archive"> = {
  max_parallel_hashers: 1,
  max_parallel_decoders: 4,
  max_parallel_analysis: 1,
  max_parallel_embedding_requests: 2,
  max_memory_bytes: 256 * 1024 * 1024,
};

/**
 * Identity of a session, from the roots it was asked to scan.
 *
 * Known before a single byte is read, which is the point: an interruption during
 * the first hashing pass still leaves a session the next attempt can find.
 */
export function corpusSessionId(rootKeys: readonly string[]): string {
  return stableId("corpus-session", { root_keys: [...rootKeys].sort(compareCodePoints) });
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareCodePoints);
}

/**
 * A session manifest and the atomic writes that keep it usable after a crash.
 *
 * Every save goes to a sibling file and is renamed over the manifest, so a
 * manifest is either the previous complete one or the new complete one. A
 * half-written manifest would make a resume skip work that was never done, which
 * is the one failure mode a resume feature must not have.
 */
export class CorpusSessionStore {
  private readonly file: string;
  private session: CorpusSession;
  private readonly sourceIds: Set<string>;
  private readonly archiveHashes: Set<string>;
  private readonly decoderKeys: Set<string>;
  private readonly analysisKeys: Set<string>;

  private constructor(file: string, session: CorpusSession) {
    this.file = file;
    this.session = session;
    this.sourceIds = new Set(session.completed_source_ids);
    this.archiveHashes = new Set(session.completed_archive_hashes);
    this.decoderKeys = new Set(session.completed_decoder_keys);
    this.analysisKeys = new Set(session.completed_analysis_keys);
  }

  /**
   * Open a session, resuming an existing manifest when one matches.
   *
   * A manifest for a different set of roots is not this session and is replaced;
   * a manifest for the same roots is adopted, completions and all.
   */
  static open(input: {
    file: string;
    roots: readonly CorpusSessionRoot[];
    budgets: CorpusResourceBudgets;
    now: string;
    resume?: boolean;
  }): CorpusSessionStore {
    const file = path.resolve(input.file);
    const sessionId = corpusSessionId(input.roots.map((root) => root.root_key));
    const fresh: CorpusSession = {
      schema: CORPUS_SESSION_SCHEMA,
      session_id: sessionId,
      corpus_snapshot_target: null,
      roots: [...input.roots].sort((a, b) => compareCodePoints(a.root_id, b.root_id)),
      completed_source_ids: [],
      completed_archive_hashes: [],
      completed_decoder_keys: [],
      completed_analysis_keys: [],
      failure_diagnostics: [],
      budgets: input.budgets,
      started_at: input.now,
      updated_at: input.now,
    };
    if (input.resume !== true || !fs.existsSync(file)) return new CorpusSessionStore(file, fresh);

    let parsed: Partial<CorpusSession>;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CorpusSession>;
    } catch {
      // An unreadable manifest is treated as no manifest. Recomputing work that
      // was already done is safe; skipping work that was not is not.
      return new CorpusSessionStore(file, fresh);
    }
    if (parsed.schema !== CORPUS_SESSION_SCHEMA || parsed.session_id !== sessionId) {
      return new CorpusSessionStore(file, fresh);
    }
    return new CorpusSessionStore(file, {
      ...fresh,
      corpus_snapshot_target: parsed.corpus_snapshot_target ?? null,
      completed_source_ids: parsed.completed_source_ids ?? [],
      completed_archive_hashes: parsed.completed_archive_hashes ?? [],
      completed_decoder_keys: parsed.completed_decoder_keys ?? [],
      completed_analysis_keys: parsed.completed_analysis_keys ?? [],
      failure_diagnostics: parsed.failure_diagnostics ?? [],
      started_at: parsed.started_at ?? input.now,
    });
  }

  get id(): string {
    return this.session.session_id;
  }

  /** Completions carried in from a previous attempt, before this one adds any. */
  get resumedCounts(): {
    source_ids: number;
    archive_hashes: number;
    decoder_keys: number;
    analysis_keys: number;
  } {
    return {
      source_ids: this.session.completed_source_ids.length,
      archive_hashes: this.session.completed_archive_hashes.length,
      decoder_keys: this.session.completed_decoder_keys.length,
      analysis_keys: this.session.completed_analysis_keys.length,
    };
  }

  hasDecoderKey(key: string): boolean {
    return this.decoderKeys.has(key);
  }

  hasAnalysisKey(key: string): boolean {
    return this.analysisKeys.has(key);
  }

  hasSourceId(id: string): boolean {
    return this.sourceIds.has(id);
  }

  hasArchiveHash(hash: string): boolean {
    return this.archiveHashes.has(hash);
  }

  completeSource(id: string): void {
    this.sourceIds.add(id);
  }

  completeArchive(hash: string): void {
    this.archiveHashes.add(hash);
  }

  completeDecoder(key: string): void {
    this.decoderKeys.add(key);
  }

  completeAnalysis(key: string): void {
    this.analysisKeys.add(key);
  }

  fail(diagnostic: CorpusSessionFailure): void {
    this.session.failure_diagnostics.push(diagnostic);
  }

  setTarget(corpusSnapshotId: string): void {
    this.session.corpus_snapshot_target = corpusSnapshotId;
  }

  /** The manifest as it currently stands. */
  snapshot(now: string): CorpusSession {
    return {
      ...this.session,
      completed_source_ids: uniqueSorted(this.sourceIds),
      completed_archive_hashes: uniqueSorted(this.archiveHashes),
      completed_decoder_keys: uniqueSorted(this.decoderKeys),
      completed_analysis_keys: uniqueSorted(this.analysisKeys),
      failure_diagnostics: [...this.session.failure_diagnostics].sort(
        (a, b) => compareCodePoints(a.code, b.code)
          || compareCodePoints(a.corpus_path ?? "", b.corpus_path ?? "")
          || compareCodePoints(a.message, b.message),
      ),
      updated_at: now,
    };
  }

  /** Write the manifest through a rename, so it is never observed half-written. */
  save(now: string): string {
    const session = this.snapshot(now);
    this.session = session;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const staging = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(staging, `${canonicalCorpusJson(session)}\n`, "utf8");
    fs.renameSync(staging, this.file);
    return this.file;
  }
}

// ───────────────────────────── bounded work ─────────────────────────────

/**
 * Map over items with at most `limit` in flight, preserving input order.
 *
 * The bound is the point. A corpus scan that opens every document it finds will
 * exhaust file handles on a large disk long before it exhausts anything else, and
 * an unbounded promise fan-out is the usual way that happens.
 */
/**
 * Hand the event loop back for one tick.
 *
 * Acquisition and artifact assembly are synchronous passes, and over a corpus of
 * tens of thousands of artifacts a single uninterrupted pass holds the thread for
 * tens of seconds. Nothing else in the process runs during that: a signal handler
 * cannot observe a SIGINT, a progress reporter cannot report, and a host that
 * expects the process to answer periodically concludes it has hung.
 *
 * `setImmediate` rather than `await null`: a resolved promise only drains the
 * microtask queue and would let the same synchronous pass continue without any
 * I/O or timer callback getting a turn.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Artifacts assembled between two yields. Small enough to stay responsive. */
export const YIELD_INTERVAL = 512;

export async function boundedMap<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const bound = Math.max(1, Math.floor(limit));
  const results = new Array<R>(items.length);
  let cursor = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(bound, items.length) }, run));
  return results;
}

/**
 * A ceiling on bytes held at once.
 *
 * Callers reserve before reading a document and release after they have reduced
 * it to features. A document larger than the whole budget is admitted alone
 * rather than refused: refusing it would silently drop content, and the budget
 * exists to prevent a hundred concurrent reads, not to censor one large file.
 */
export class MemoryBudget {
  private inFlight = 0;
  private waiters: (() => void)[] = [];
  /** Largest concurrent reservation seen, for the coverage report. */
  peakBytes = 0;
  /** Times a caller had to wait for room. */
  waits = 0;

  constructor(readonly limitBytes: number) {}

  async reserve(bytes: number): Promise<void> {
    const wanted = Math.max(0, bytes);
    while (this.inFlight > 0 && this.inFlight + wanted > this.limitBytes) {
      this.waits += 1;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.inFlight += wanted;
    if (this.inFlight > this.peakBytes) this.peakBytes = this.inFlight;
  }

  release(bytes: number): void {
    this.inFlight = Math.max(0, this.inFlight - Math.max(0, bytes));
    const waiting = this.waiters;
    this.waiters = [];
    for (const resolve of waiting) resolve();
  }
}

// ───────────────────────────── atomic output ─────────────────────────────

export interface CorpusOutputFile {
  /** Absolute path the file lands at. */
  path: string;
  contents: string;
}

export interface CommitCorpusOutputsInput {
  files: readonly CorpusOutputFile[];
  /**
   * Projections this run did not produce that must not survive from a previous
   * one. A `corpus-diff.json` left beside a newer snapshot describes a comparison
   * that no longer holds, and nothing in the file says so.
   */
  remove?: readonly string[];
}

interface StagedOutput {
  staging: string;
  target: string;
  /** Where the previous contents were moved, when there were any. */
  backup: string | null;
  renamed: boolean;
}

/**
 * Write every projection, then move them all into place.
 *
 * A run that fails mid-write must not leave a coverage report describing one
 * corpus beside a readiness document describing another. Three things make that
 * hold: every file is staged before any is moved, every target is checked before
 * anything is staged, and each target's previous contents are moved aside rather
 * than overwritten, so a failure part-way through the renames can put them back.
 *
 * What this cannot defend against is the process being killed between two
 * renames. No userspace sequence of renames is atomic as a set, and claiming
 * otherwise would be the kind of guarantee that is only discovered to be false
 * during an incident.
 */
export function commitCorpusOutputs(input: CommitCorpusOutputsInput): string[] {
  const staged: StagedOutput[] = [];
  const suffix = `${process.pid}.tmp`;
  const removals = (input.remove ?? []).map((file) => path.resolve(file));

  const discardStaging = (): void => {
    for (const entry of staged) fs.rmSync(entry.staging, { force: true });
  };
  const restoreRenamed = (): void => {
    for (const entry of staged) {
      if (!entry.renamed) continue;
      fs.rmSync(entry.target, { force: true });
      if (entry.backup !== null) {
        try {
          fs.renameSync(entry.backup, entry.target);
        } catch {
          // The previous contents could not be put back. Nothing better is
          // available here, and the backup is left on disk rather than deleted
          // so an operator can recover it by hand.
        }
      }
    }
  };
  const dropBackups = (): void => {
    for (const entry of staged) {
      if (entry.backup !== null) fs.rmSync(entry.backup, { force: true });
    }
  };

  try {
    for (const file of input.files) {
      const target = path.resolve(file.path);
      // Every reason a rename could fail is checked here, while nothing has moved
      // yet. A target that is a directory is the one that actually happens, and
      // discovering it halfway through the renames would leave half a result set.
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        throw new Error(`corpus: refusing to replace the directory ${target} with an output file`);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const staging = `${target}.${suffix}`;
      fs.writeFileSync(staging, file.contents, "utf8");
      staged.push({ staging, target, backup: null, renamed: false });
    }
  } catch (error) {
    discardStaging();
    throw error;
  }

  try {
    for (const entry of staged) {
      if (fs.existsSync(entry.target)) {
        const backup = `${entry.target}.${suffix}.prev`;
        fs.renameSync(entry.target, backup);
        entry.backup = backup;
      }
      fs.renameSync(entry.staging, entry.target);
      entry.renamed = true;
    }
    for (const file of removals) fs.rmSync(file, { force: true });
  } catch (error) {
    restoreRenamed();
    discardStaging();
    throw error;
  }

  dropBackups();
  return staged.map((entry) => entry.target);
}
