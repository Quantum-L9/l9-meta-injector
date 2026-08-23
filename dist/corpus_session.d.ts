export declare const CORPUS_SESSION_SCHEMA = "l9.corpus-session/v1";
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
export declare const DEFAULT_CORPUS_BUDGETS: Omit<CorpusResourceBudgets, "archive">;
/**
 * Identity of a session, from the roots it was asked to scan.
 *
 * Known before a single byte is read, which is the point: an interruption during
 * the first hashing pass still leaves a session the next attempt can find.
 */
export declare function corpusSessionId(rootKeys: readonly string[]): string;
/**
 * A session manifest and the atomic writes that keep it usable after a crash.
 *
 * Every save goes to a sibling file and is renamed over the manifest, so a
 * manifest is either the previous complete one or the new complete one. A
 * half-written manifest would make a resume skip work that was never done, which
 * is the one failure mode a resume feature must not have.
 */
export declare class CorpusSessionStore {
    private readonly file;
    private session;
    private readonly sourceIds;
    private readonly archiveHashes;
    private readonly decoderKeys;
    private readonly analysisKeys;
    private constructor();
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
    }): CorpusSessionStore;
    get id(): string;
    /** Completions carried in from a previous attempt, before this one adds any. */
    get resumedCounts(): {
        source_ids: number;
        archive_hashes: number;
        decoder_keys: number;
        analysis_keys: number;
    };
    hasDecoderKey(key: string): boolean;
    hasAnalysisKey(key: string): boolean;
    hasSourceId(id: string): boolean;
    hasArchiveHash(hash: string): boolean;
    completeSource(id: string): void;
    completeArchive(hash: string): void;
    completeDecoder(key: string): void;
    completeAnalysis(key: string): void;
    fail(diagnostic: CorpusSessionFailure): void;
    setTarget(corpusSnapshotId: string): void;
    /** The manifest as it currently stands. */
    snapshot(now: string): CorpusSession;
    /** Write the manifest through a rename, so it is never observed half-written. */
    save(now: string): string;
}
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
export declare function yieldToEventLoop(): Promise<void>;
/** Artifacts assembled between two yields. Small enough to stay responsive. */
export declare const YIELD_INTERVAL = 512;
export declare function boundedMap<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]>;
/**
 * A ceiling on bytes held at once.
 *
 * Callers reserve before reading a document and release after they have reduced
 * it to features. A document larger than the whole budget is admitted alone
 * rather than refused: refusing it would silently drop content, and the budget
 * exists to prevent a hundred concurrent reads, not to censor one large file.
 */
export declare class MemoryBudget {
    readonly limitBytes: number;
    private inFlight;
    private waiters;
    /** Largest concurrent reservation seen, for the coverage report. */
    peakBytes: number;
    /** Times a caller had to wait for room. */
    waits: number;
    constructor(limitBytes: number);
    reserve(bytes: number): Promise<void>;
    release(bytes: number): void;
}
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
export declare function commitCorpusOutputs(input: CommitCorpusOutputsInput): string[];
