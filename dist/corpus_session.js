"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryBudget = exports.YIELD_INTERVAL = exports.CorpusSessionStore = exports.DEFAULT_CORPUS_BUDGETS = exports.CORPUS_SESSION_SCHEMA = void 0;
exports.corpusSessionId = corpusSessionId;
exports.yieldToEventLoop = yieldToEventLoop;
exports.boundedMap = boundedMap;
exports.commitCorpusOutputs = commitCorpusOutputs;
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
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const corpus_analysis_1 = require("./corpus_analysis");
const durable_write_1 = require("./durable_write");
const ordering_1 = require("./ordering");
const repository_model_1 = require("./repository_model");
exports.CORPUS_SESSION_SCHEMA = "l9.corpus-session/v1";
exports.DEFAULT_CORPUS_BUDGETS = {
    max_parallel_decoders: 4,
    max_parallel_embedding_requests: 2,
    max_memory_bytes: 256 * 1024 * 1024,
};
/**
 * Identity of a session, from the roots it was asked to scan.
 *
 * Known before a single byte is read, which is the point: an interruption during
 * the first hashing pass still leaves a session the next attempt can find.
 */
function corpusSessionId(rootKeys) {
    return (0, repository_model_1.stableId)("corpus-session", { root_keys: [...rootKeys].sort(ordering_1.compareCodePoints) });
}
function uniqueSorted(values) {
    return [...new Set(values)].sort(ordering_1.compareCodePoints);
}
/**
 * A session manifest and the atomic writes that keep it usable after a crash.
 *
 * Every save goes to a sibling file and is renamed over the manifest, so a
 * manifest is either the previous complete one or the new complete one. A
 * half-written manifest would make a resume skip work that was never done, which
 * is the one failure mode a resume feature must not have.
 */
class CorpusSessionStore {
    constructor(file, session) {
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
    static open(input) {
        const file = path.resolve(input.file);
        const sessionId = corpusSessionId(input.roots.map((root) => root.root_key));
        const fresh = {
            schema: exports.CORPUS_SESSION_SCHEMA,
            session_id: sessionId,
            corpus_snapshot_target: null,
            roots: [...input.roots].sort((a, b) => (0, ordering_1.compareCodePoints)(a.root_id, b.root_id)),
            completed_source_ids: [],
            completed_archive_hashes: [],
            completed_decoder_keys: [],
            completed_analysis_keys: [],
            failure_diagnostics: [],
            budgets: input.budgets,
            started_at: input.now,
            updated_at: input.now,
        };
        if (input.resume !== true || !fs.existsSync(file))
            return new CorpusSessionStore(file, fresh);
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        }
        catch {
            // An unreadable manifest is treated as no manifest. Recomputing work that
            // was already done is safe; skipping work that was not is not.
            return new CorpusSessionStore(file, fresh);
        }
        if (parsed.schema !== exports.CORPUS_SESSION_SCHEMA || parsed.session_id !== sessionId) {
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
    get id() {
        return this.session.session_id;
    }
    /** Completions carried in from a previous attempt, before this one adds any. */
    get resumedCounts() {
        return {
            source_ids: this.session.completed_source_ids.length,
            archive_hashes: this.session.completed_archive_hashes.length,
            decoder_keys: this.session.completed_decoder_keys.length,
            analysis_keys: this.session.completed_analysis_keys.length,
        };
    }
    hasDecoderKey(key) {
        return this.decoderKeys.has(key);
    }
    hasAnalysisKey(key) {
        return this.analysisKeys.has(key);
    }
    hasSourceId(id) {
        return this.sourceIds.has(id);
    }
    hasArchiveHash(hash) {
        return this.archiveHashes.has(hash);
    }
    completeSource(id) {
        this.sourceIds.add(id);
    }
    completeArchive(hash) {
        this.archiveHashes.add(hash);
    }
    completeDecoder(key) {
        this.decoderKeys.add(key);
    }
    completeAnalysis(key) {
        this.analysisKeys.add(key);
    }
    fail(diagnostic) {
        this.session.failure_diagnostics.push(diagnostic);
    }
    setTarget(corpusSnapshotId) {
        this.session.corpus_snapshot_target = corpusSnapshotId;
    }
    /** The manifest as it currently stands. */
    snapshot(now) {
        return {
            ...this.session,
            completed_source_ids: uniqueSorted(this.sourceIds),
            completed_archive_hashes: uniqueSorted(this.archiveHashes),
            completed_decoder_keys: uniqueSorted(this.decoderKeys),
            completed_analysis_keys: uniqueSorted(this.analysisKeys),
            failure_diagnostics: [...this.session.failure_diagnostics].sort((a, b) => (0, ordering_1.compareCodePoints)(a.code, b.code)
                || (0, ordering_1.compareCodePoints)(a.corpus_path ?? "", b.corpus_path ?? "")
                || (0, ordering_1.compareCodePoints)(a.message, b.message)),
            updated_at: now,
        };
    }
    /**
     * Write the manifest durably, so it is never read back half-written.
     *
     * Staged, synced, renamed, parent synced. A resume manifest is the one file in
     * this package whose corruption is silently harmful rather than loudly so: a
     * torn `completed_source_ids` that still parses makes the next attempt skip
     * work that was never done, which is precisely the failure a resume feature
     * must not have. The rename alone does not survive a power cut.
     */
    save(now) {
        const session = this.snapshot(now);
        this.session = session;
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        (0, durable_write_1.commitFileDurably)({
            staging: `${this.file}.${process.pid}.tmp`,
            target: this.file,
            contents: `${(0, corpus_analysis_1.canonicalCorpusJson)(session)}\n`,
        });
        return this.file;
    }
}
exports.CorpusSessionStore = CorpusSessionStore;
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
function yieldToEventLoop() {
    return new Promise((resolve) => setImmediate(resolve));
}
/** Artifacts assembled between two yields. Small enough to stay responsive. */
exports.YIELD_INTERVAL = 512;
async function boundedMap(items, limit, worker) {
    const bound = Math.max(1, Math.floor(limit));
    const results = new Array(items.length);
    let cursor = 0;
    const run = async () => {
        for (;;) {
            const index = cursor++;
            if (index >= items.length)
                return;
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
class MemoryBudget {
    constructor(limitBytes) {
        this.limitBytes = limitBytes;
        this.inFlight = 0;
        this.waiters = [];
        /** Largest concurrent reservation seen, for the coverage report. */
        this.peakBytes = 0;
        /** Times a caller had to wait for room. */
        this.waits = 0;
    }
    async reserve(bytes) {
        const wanted = Math.max(0, bytes);
        while (this.inFlight > 0 && this.inFlight + wanted > this.limitBytes) {
            this.waits += 1;
            await new Promise((resolve) => this.waiters.push(resolve));
        }
        this.inFlight += wanted;
        if (this.inFlight > this.peakBytes)
            this.peakBytes = this.inFlight;
    }
    release(bytes) {
        this.inFlight = Math.max(0, this.inFlight - Math.max(0, bytes));
        const waiting = this.waiters;
        this.waiters = [];
        for (const resolve of waiting)
            resolve();
    }
}
exports.MemoryBudget = MemoryBudget;
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
function commitCorpusOutputs(input) {
    const staged = [];
    const suffix = `${process.pid}.tmp`;
    const removals = (input.remove ?? []).map((file) => path.resolve(file));
    const discardStaging = () => {
        for (const entry of staged)
            fs.rmSync(entry.staging, { force: true });
    };
    const restoreRenamed = () => {
        for (const entry of staged) {
            if (!entry.renamed)
                continue;
            fs.rmSync(entry.target, { force: true });
            if (entry.backup !== null) {
                try {
                    fs.renameSync(entry.backup, entry.target);
                }
                catch {
                    // The previous contents could not be put back. Nothing better is
                    // available here, and the backup is left on disk rather than deleted
                    // so an operator can recover it by hand.
                }
            }
        }
    };
    const dropBackups = () => {
        for (const entry of staged) {
            if (entry.backup !== null)
                fs.rmSync(entry.backup, { force: true });
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
    }
    catch (error) {
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
        for (const file of removals)
            fs.rmSync(file, { force: true });
    }
    catch (error) {
        restoreRenamed();
        discardStaging();
        throw error;
    }
    dropBackups();
    return staged.map((entry) => entry.target);
}
//# sourceMappingURL=corpus_session.js.map