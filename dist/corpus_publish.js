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
exports.GENERATIONS_DIRECTORY = exports.CURRENT_FILE = exports.CORPUS_CURRENT_SCHEMA = void 0;
exports.generationId = generationId;
exports.readCorpusCurrent = readCorpusCurrent;
exports.resolveCurrentGeneration = resolveCurrentGeneration;
exports.listGenerations = listGenerations;
exports.publishCorpusGeneration = publishCorpusGeneration;
// corpus_publish.ts — a whole output set that appears at once, or not at all.
//
// `commitCorpusOutputs` stages every projection and then renames them into place
// one by one, and its own comment named the hole: no userspace sequence of
// renames is atomic as a set. Kill the process between the twelfth rename and
// the thirteenth and the output directory holds a coverage report describing one
// corpus beside a readiness document describing another. Both parse. Nothing in
// either says which run it came from, so the mixture is not detectable by
// reading it — which is what makes it worse than a missing file.
//
// The fix is not more careful renaming. It is to stop making the reader's view a
// function of many renames:
//
//   <out>/generations/<generation_id>/…   every projection of one run
//   <out>/CURRENT.json                    which generation is the one to read
//
// A generation directory is written in full and then never touched again. The
// switch is a single atomic rename of `CURRENT.json`, so the set a reader sees
// changes from "all of the previous run" to "all of this one" at one instant,
// and a crash at any point leaves one of those two and never a mixture.
//
// The generation id is content-addressed over the file set. Two runs producing
// byte-identical outputs land in the same directory and the switch is a no-op,
// so a retry writes nothing it cannot vouch for and nothing accumulates. A run
// whose outputs embed a wall clock — the corpus CLI's acquisition manifests do —
// produces different bytes and therefore a different generation, which is
// correct: those are different output sets, and pretending otherwise would mean
// serving one run's timestamps under another run's name.
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const corpus_analysis_1 = require("./corpus_analysis");
const durable_write_1 = require("./durable_write");
const ordering_1 = require("./ordering");
const repository_model_1 = require("./repository_model");
exports.CORPUS_CURRENT_SCHEMA = "l9.corpus-current/v1";
/** Where the pointer and the generations live, relative to the output root. */
exports.CURRENT_FILE = "CURRENT.json";
exports.GENERATIONS_DIRECTORY = "generations";
/**
 * Identity of an output set: a hash over its paths and its bytes.
 *
 * Deterministic on purpose: same bytes, same id, whatever order the files are
 * supplied in. A caller whose projections are themselves deterministic gets a
 * no-op switch on a rerun and writes nothing twice. A caller whose projections
 * carry a timestamp gets a new generation each run, because it produced a
 * genuinely new output set — retention, not identity, is what bounds that.
 */
function generationId(files) {
    return (0, repository_model_1.stableId)("corpus-generation", {
        files: [...files]
            .map((file) => ({ content_hash: (0, repository_model_1.sha256TextPrefixed)(file.contents), path: file.path }))
            .sort((a, b) => (0, ordering_1.compareCodePoints)(a.path, b.path)),
    });
}
const DEFAULT_KEEP = 3;
/** The publication-order record never grows past this many entries, or `keep` if larger. */
const MIN_HISTORY_LENGTH = 16;
/**
 * The exclusive publisher lock, relative to the output root (ADR-066).
 *
 * One publisher per output root: the lock is created with an exclusive open before
 * anything is written and removed after pruning. It records the holder's pid and
 * host, so a lock left by a crashed process on this host is taken over.
 */
const PUBLISH_LOCK_FILE = ".corpus-publish.lock";
/**
 * The takeover guard, beside the lock (G01).
 *
 * Taking over a stale lock is read, remove, create: three steps, and two publishers
 * that both read the same stale holder could each remove what the other had just
 * created, and both go on to publish. The guard makes the takeover exclusive. It is
 * created with an exclusive open and records pid and host like the lock; under it the
 * lock is re-read and removed only if it still holds exactly the stale bytes read
 * before, and the new lock is then created exclusively. The guard is removed in a
 * `finally`. It is consulted only on the takeover path, never by an ordinary
 * acquisition, so it adds nothing to a publish that finds the lock free.
 */
const TAKEOVER_GUARD_SUFFIX = ".takeover";
/** The raw bytes of a lock-shaped file, or null when it is absent or unreadable. */
function readLockText(file) {
    try {
        return fs.readFileSync(file, "utf8");
    }
    catch {
        return null;
    }
}
function parseLockHolder(text) {
    if (text === null)
        return null;
    try {
        const parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== "object")
            return null;
        if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0)
            return null;
        if (typeof parsed.host !== "string")
            return null;
        return { pid: parsed.pid, host: parsed.host, acquired_at: String(parsed.acquired_at ?? "") };
    }
    catch {
        return null;
    }
}
function processIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        // EPERM: the process exists but belongs to someone else. Only ESRCH proves it is gone.
        return error.code !== "ESRCH";
    }
}
/** A holder that is a dead process on this host. Across hosts a pid proves nothing. */
function holderIsStale(holder) {
    return holder !== null && holder.host === os.hostname() && !processIsAlive(holder.pid);
}
function holderRecord() {
    return `${JSON.stringify({ pid: process.pid, host: os.hostname(), acquired_at: new Date().toISOString() })}\n`;
}
/** Create `file` with an exclusive open. False when it already exists. */
function createExclusive(file, contents) {
    let fd;
    try {
        fd = fs.openSync(file, "wx");
    }
    catch (error) {
        if (error.code === "EEXIST")
            return false;
        throw error;
    }
    try {
        fs.writeSync(fd, contents);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    return true;
}
function publisherRefusal(lockFile, holder, detail = "") {
    const who = holder === null ? "an unreadable holder" : `pid ${holder.pid} on ${holder.host}`;
    return new Error(`corpus: another publisher holds ${lockFile} (${who}${detail}); wait for it to finish, or remove the lock file if that publisher is gone`);
}
/**
 * Take the takeover guard, or throw the publisher refusal.
 *
 * A guard held by a live process, by another host, or that cannot be read is
 * refused: someone is taking the lock over right now. A guard whose holder is a
 * dead process on this host — a publisher killed inside its takeover — is reaped
 * once so it cannot wedge every later publisher. Reaping is not a plain remove,
 * because between reading the dead guard and removing it another publisher may
 * have reaped it too and created its own: the guard is renamed aside (atomic, it
 * moves whatever stands there now), and only if the moved bytes are the dead
 * holder's are they deleted. Anything else is a live guard that was moved by
 * mistake; it is linked back without overwriting and this publisher is refused.
 */
function acquireTakeoverGuard(lockFile) {
    const file = `${lockFile}${TAKEOVER_GUARD_SUFFIX}`;
    const contents = holderRecord();
    for (let attempt = 0; attempt < 2; attempt += 1) {
        if (createExclusive(file, contents))
            return { file, contents };
        const seen = readLockText(file);
        if (seen === null && !fs.existsSync(file))
            continue; // released meanwhile: try again
        const holder = parseLockHolder(seen);
        if (attempt > 0 || !holderIsStale(holder)) {
            throw publisherRefusal(lockFile, holder, `, taking over a stale lock under ${file}`);
        }
        const aside = `${file}.${process.pid}.${process.hrtime.bigint()}.reap`;
        try {
            fs.renameSync(file, aside);
        }
        catch (error) {
            if (error.code === "ENOENT")
                continue;
            throw error;
        }
        const moved = readLockText(aside);
        if (moved === seen) {
            fs.rmSync(aside, { force: true });
            continue;
        }
        try {
            fs.linkSync(aside, file);
        }
        catch {
            // A third guard stands there already; it is the one in charge now.
        }
        fs.rmSync(aside, { force: true });
        throw publisherRefusal(lockFile, parseLockHolder(moved), `, taking over a stale lock under ${file}`);
    }
    throw publisherRefusal(lockFile, parseLockHolder(readLockText(file)), `, taking over a stale lock under ${file}`);
}
/** Remove a guard or lock, but only if it is still the one this publisher wrote. */
function releaseOwned(owned) {
    try {
        if (fs.readFileSync(owned.file, "utf8") === owned.contents)
            fs.rmSync(owned.file, { force: true });
    }
    catch {
        // Already gone: nothing to release.
    }
}
/**
 * Take the output root's publisher lock, or throw naming the lock file.
 *
 * A lock whose holder is a dead process on this host is taken over, under the
 * takeover guard (G01): the lock is re-read under the guard and removed only if it
 * still holds the bytes judged stale, and the new lock is created exclusively, so
 * of two publishers that judged the same lock stale exactly one ends up holding it
 * and the other is refused. A lock held by a live process, by another host, or
 * whose content cannot be read is refused: across hosts a pid proves nothing, and
 * an unreadable lock may be one being written.
 */
function acquirePublishLock(outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, PUBLISH_LOCK_FILE);
    const contents = holderRecord();
    if (createExclusive(file, contents))
        return { file, contents };
    const staleText = readLockText(file);
    const holder = parseLockHolder(staleText);
    if (!holderIsStale(holder))
        throw publisherRefusal(file, holder);
    const guard = acquireTakeoverGuard(file);
    try {
        // Only the exact stale bytes are removed. If the lock changed since it was
        // judged stale, another publisher took it over first and it is theirs.
        if (readLockText(file) === staleText)
            fs.rmSync(file, { force: true });
        if (createExclusive(file, contents))
            return { file, contents };
    }
    finally {
        releaseOwned(guard);
    }
    throw publisherRefusal(file, parseLockHolder(readLockText(file)));
}
/** The string ids of a pointer's publication record, tolerating a pointer without one. */
function recordedHistory(current) {
    const list = current?.previous_generation_ids;
    return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
}
/** The directory name a generation id lands in, or null for an id that cannot be one. */
function directoryNameOrNull(id) {
    try {
        return generationDirectoryName(id);
    }
    catch {
        return null;
    }
}
/** Read the pointer, or null when nothing has been published yet. */
function readCorpusCurrent(outDir) {
    const file = path.join(outDir, exports.CURRENT_FILE);
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch {
        // Absent, or unreadable. Both mean "there is no generation to read", which
        // is a better answer than a partially-parsed pointer into a directory that
        // may not be there.
        return null;
    }
    if (parsed === null || typeof parsed !== "object")
        return null;
    const current = parsed;
    if (current.schema !== exports.CORPUS_CURRENT_SCHEMA)
        return null;
    if (typeof current.generation_id !== "string" || typeof current.generation_ref !== "string") {
        return null;
    }
    return current;
}
/**
 * Resolve the published file set a reader should read.
 *
 * Returns absolute paths for the files `CURRENT.json` names and that are
 * actually present. A file the pointer names and the directory does not have is
 * reported as missing rather than skipped: a generation that lost a file is a
 * broken generation, and silently returning the rest is how a partial set gets
 * read as a whole one.
 */
function resolveCurrentGeneration(outDir) {
    const current = readCorpusCurrent(outDir);
    if (current === null)
        return null;
    const directory = path.join(outDir, ...current.generation_ref.split("/"));
    const files = [];
    const missing = [];
    for (const entry of current.files) {
        const absolute = path.join(directory, ...entry.path.split("/"));
        if (fs.existsSync(absolute))
            files.push({ path: entry.path, absolute });
        else
            missing.push(entry.path);
    }
    return { current, directory, files, missing };
}
/** Every generation directory present, in code-point order. */
function listGenerations(outDir) {
    const root = path.join(outDir, exports.GENERATIONS_DIRECTORY);
    try {
        return fs.readdirSync(root, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort(ordering_1.compareCodePoints);
    }
    catch {
        return [];
    }
}
/**
 * A generation id as a directory name.
 *
 * `stableId` produces `corpus-generation:sha256:<hex>`, and a colon is a path
 * separator on some platforms and an alternate-data-stream marker on Windows.
 * The hex alone is what lands on disk; the full id stays in `CURRENT.json`,
 * where it is data rather than a path.
 */
function generationDirectoryName(id) {
    const hex = id.slice(id.lastIndexOf(":") + 1);
    if (!/^[0-9a-f]{16,}$/.test(hex)) {
        throw new Error(`corpus: generation id '${id}' does not end in a hex digest`);
    }
    return hex;
}
/**
 * Write one generation and switch to it.
 *
 * Order matters at every step and each one is chosen against a specific crash:
 *
 *  0. Take the output root's exclusive publisher lock (ADR-066), released in a
 *     `finally` after pruning. Two publishers into one root serialise or the
 *     second is refused before it writes anything.
 *  1. Write the generation's files, each synced. A crash here leaves an
 *     unreferenced directory that no reader can reach, because `CURRENT.json`
 *     has not moved.
 *  2. Sync the generation directory, so its entries are on the device before
 *     anything points at them. Without this the pointer could survive a power
 *     cut that the files it names did not.
 *  3. Switch `CURRENT.json` with one durable rename. This is the instant the
 *     reader's whole view changes, and it is one syscall rather than twelve.
 *  4. Prune, after the switch, never touching what `CURRENT.json` names when
 *     re-read at that moment. Retention is by publication order recorded in the
 *     pointer: unrecorded directories go first, then the oldest recorded ones,
 *     until `keep` remain (ADR-066).
 */
function publishCorpusGeneration(input) {
    const outDir = path.resolve(input.outDir);
    const id = generationId(input.files);
    const directoryName = generationDirectoryName(id);
    const generationRef = `${exports.GENERATIONS_DIRECTORY}/${directoryName}`;
    const generationDirectory = path.join(outDir, exports.GENERATIONS_DIRECTORY, directoryName);
    const ordered = [...input.files].sort((a, b) => (0, ordering_1.compareCodePoints)(a.path, b.path));
    for (const file of ordered) {
        if (file.path.length === 0 || file.path.startsWith("/") || file.path.includes("..")) {
            throw new Error(`corpus: refusing to publish '${file.path}' outside its generation`);
        }
    }
    const lock = acquirePublishLock(outDir);
    try {
        return publishUnderLock(input, { outDir, id, directoryName, generationRef, generationDirectory, ordered });
    }
    finally {
        releaseOwned(lock);
    }
}
function publishUnderLock(input, target) {
    const { outDir, id, directoryName, generationRef, generationDirectory, ordered } = target;
    const keep = Math.max(1, Math.floor(input.keep ?? DEFAULT_KEEP));
    // A generation is identified by its bytes, so one that already exists already
    // holds exactly these files and rewriting it would be work with no effect.
    // Existence is judged by the pointer having named it, not by the directory
    // being there: a directory left by a crash before step 3 may be incomplete.
    const previous = readCorpusCurrent(outDir);
    const reused = previous?.generation_id === id && fs.existsSync(generationDirectory);
    const writtenPaths = [];
    if (!reused) {
        // Written fresh rather than merged into whatever a previous crash left. The
        // set is content-addressed, so the bytes are the same either way; starting
        // clean means a file the earlier attempt failed on cannot survive as a
        // zero-length remnant beside its correct siblings.
        fs.rmSync(generationDirectory, { recursive: true, force: true });
        fs.mkdirSync(generationDirectory, { recursive: true });
        const touchedDirectories = new Set([generationDirectory]);
        for (const file of ordered) {
            const absolute = path.join(generationDirectory, ...file.path.split("/"));
            const parent = path.dirname(absolute);
            fs.mkdirSync(parent, { recursive: true });
            touchedDirectories.add(parent);
            (0, durable_write_1.writeFileDurably)(absolute, file.contents);
            writtenPaths.push(absolute);
        }
        // Every directory that gained an entry, so the entries themselves are on the
        // device and not only the bytes they point at.
        for (const directory of [...touchedDirectories].sort(ordering_1.compareCodePoints)) {
            (0, durable_write_1.syncDirectory)(directory);
        }
        (0, durable_write_1.syncDirectory)(path.join(outDir, exports.GENERATIONS_DIRECTORY));
    }
    input.beforeSwitch?.({ id, directory: generationDirectory });
    // Defence in depth under the lock: never point at a generation that is not whole.
    const absent = ordered
        .filter((file) => !fs.existsSync(path.join(generationDirectory, ...file.path.split("/"))))
        .map((file) => file.path);
    if (absent.length > 0) {
        throw new Error(`corpus: generation ${generationRef} is missing ${absent.join(", ")}; CURRENT.json was not switched`);
    }
    // Publication order, newest first: the generation being replaced, then what it
    // replaced. Recorded in the pointer itself, so it moves in the same rename.
    const history = previous === null
        ? []
        : [previous.generation_id, ...recordedHistory(previous)]
            .filter((item, index, list) => item !== id && list.indexOf(item) === index)
            .slice(0, Math.max(keep, MIN_HISTORY_LENGTH));
    const current = {
        schema: exports.CORPUS_CURRENT_SCHEMA,
        generation_id: id,
        generation_ref: generationRef,
        committed_at: input.committedAt,
        files: ordered.map((file) => ({
            path: file.path,
            content_hash: (0, repository_model_1.sha256TextPrefixed)(file.contents),
        })),
        previous_generation_ids: history,
    };
    const currentFile = path.join(outDir, exports.CURRENT_FILE);
    (0, durable_write_1.commitFileDurably)({
        staging: `${currentFile}.${process.pid}.tmp`,
        target: currentFile,
        contents: `${(0, corpus_analysis_1.canonicalCorpusJson)(current)}\n`,
    });
    // Only now, and only what the pointer does not name. The pointer is re-read
    // rather than trusted: whatever it names at deletion time is never deleted.
    const named = readCorpusCurrent(outDir);
    const protectedNames = new Set([directoryName]);
    if (named !== null)
        protectedNames.add(path.posix.basename(named.generation_ref));
    // Newest first: this generation, then the recorded ones it replaced.
    const recorded = [id, ...history]
        .map(directoryNameOrNull)
        .filter((name) => name !== null);
    const present = listGenerations(outDir);
    const presentSet = new Set(present);
    const keptRecorded = new Set(recorded.filter((name) => presentSet.has(name)).slice(0, keep));
    // Prune order: directories with no publication record (crash orphans, pre-upgrade
    // generations) in name order first, then recorded generations oldest first.
    const recordedOrder = new Map(recorded.map((name, index) => [name, index]));
    const unrecorded = present.filter((name) => !recordedOrder.has(name));
    const olderRecorded = present
        .filter((name) => recordedOrder.has(name) && !keptRecorded.has(name))
        .sort((a, b) => (recordedOrder.get(b) ?? 0) - (recordedOrder.get(a) ?? 0));
    const surplusCount = Math.max(0, present.length - keep);
    const surplus = [...unrecorded, ...olderRecorded]
        .filter((name) => !protectedNames.has(name))
        .slice(0, surplusCount);
    const pruned = [];
    for (const name of surplus) {
        fs.rmSync(path.join(outDir, exports.GENERATIONS_DIRECTORY, name), { recursive: true, force: true });
        pruned.push(name);
    }
    if (pruned.length > 0)
        (0, durable_write_1.syncDirectory)(path.join(outDir, exports.GENERATIONS_DIRECTORY));
    return {
        generation_id: id,
        generation_directory: generationDirectory,
        current_file: currentFile,
        reused,
        written_paths: writtenPaths,
        pruned_generation_ids: pruned,
    };
}
//# sourceMappingURL=corpus_publish.js.map