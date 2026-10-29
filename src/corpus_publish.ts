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
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { canonicalCorpusJson } from "./corpus_analysis";
import { commitFileDurably, syncDirectory, writeFileDurably } from "./durable_write";
import { compareCodePoints } from "./ordering";
import { sha256TextPrefixed, stableId } from "./repository_model";

export const CORPUS_CURRENT_SCHEMA = "l9.corpus-current/v1";

/** Where the pointer and the generations live, relative to the output root. */
export const CURRENT_FILE = "CURRENT.json";
export const GENERATIONS_DIRECTORY = "generations";

export interface PublishedFile {
  /** Path relative to the generation directory. Always forward-slashed. */
  path: string;
  contents: string;
}

/** The pointer a reader resolves before reading anything else. */
export interface CorpusCurrent {
  schema: string;
  generation_id: string;
  /** Output-relative directory this generation's files live in. */
  generation_ref: string;
  /** Wall clock. Operational: it enters no identity and no comparison. */
  committed_at: string;
  /** Every file in the generation, with its hash, in code-point order. */
  files: { path: string; content_hash: string }[];
  /**
   * Generations that were current before this one, newest first (ADR-066).
   *
   * Written in the same durable rename as the rest of the pointer, so the record of
   * publication order can never disagree with the switch it describes. Bounded; a
   * generation that falls off the end counts as unrecorded. Absent in pointers
   * written by earlier releases, which readers still accept.
   */
  previous_generation_ids?: string[];
}

/**
 * Identity of an output set: a hash over its paths and its bytes.
 *
 * Deterministic on purpose: same bytes, same id, whatever order the files are
 * supplied in. A caller whose projections are themselves deterministic gets a
 * no-op switch on a rerun and writes nothing twice. A caller whose projections
 * carry a timestamp gets a new generation each run, because it produced a
 * genuinely new output set — retention, not identity, is what bounds that.
 */
export function generationId(files: readonly PublishedFile[]): string {
  return stableId("corpus-generation", {
    files: [...files]
      .map((file) => ({ content_hash: sha256TextPrefixed(file.contents), path: file.path }))
      .sort((a, b) => compareCodePoints(a.path, b.path)),
  });
}

export interface PublishInput {
  /** Output root. The generation directory and `CURRENT.json` live under it. */
  outDir: string;
  files: readonly PublishedFile[];
  committedAt: string;
  /**
   * Generations to keep, newest first, including the one being published.
   *
   * Pruning happens strictly after the switch, and only ever removes a
   * generation `CURRENT.json` does not name. A crash during a prune leaves an
   * unreferenced directory, which costs disk and is inert — the failure mode
   * worth having when the alternative is removing something a reader is using.
   */
  keep?: number;
  /**
   * Called after the generation is fully written and before `CURRENT.json` is
   * switched. A test seam for crash injection; nothing in production passes it.
   */
  beforeSwitch?: (generation: { id: string; directory: string }) => void;
}

export interface PublishResult {
  generation_id: string;
  generation_directory: string;
  current_file: string;
  /** True when this generation already existed and its bytes were reused. */
  reused: boolean;
  written_paths: string[];
  pruned_generation_ids: string[];
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

interface PublishLockHolder {
  pid: number;
  host: string;
  acquired_at: string;
}

/** The raw bytes of a lock-shaped file, or null when it is absent or unreadable. */
function readLockText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function parseLockHolder(text: string | null): PublishLockHolder | null {
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as Partial<PublishLockHolder> | null;
    if (parsed === null || typeof parsed !== "object") return null;
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    if (typeof parsed.host !== "string") return null;
    return { pid: parsed.pid, host: parsed.host, acquired_at: String(parsed.acquired_at ?? "") };
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else. Only ESRCH proves it is gone.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** A holder that is a dead process on this host. Across hosts a pid proves nothing. */
function holderIsStale(holder: PublishLockHolder | null): holder is PublishLockHolder {
  return holder !== null && holder.host === os.hostname() && !processIsAlive(holder.pid);
}

function holderRecord(): string {
  return `${JSON.stringify({ pid: process.pid, host: os.hostname(), acquired_at: new Date().toISOString() })}\n`;
}

/** Create `file` with an exclusive open. False when it already exists. */
function createExclusive(file: string, contents: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(file, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    fs.writeSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

function publisherRefusal(lockFile: string, holder: PublishLockHolder | null, detail = ""): Error {
  const who = holder === null ? "an unreadable holder" : `pid ${holder.pid} on ${holder.host}`;
  return new Error(
    `corpus: another publisher holds ${lockFile} (${who}${detail}); wait for it to finish, or remove the lock file if that publisher is gone`,
  );
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
function acquireTakeoverGuard(lockFile: string): { file: string; contents: string } {
  const file = `${lockFile}${TAKEOVER_GUARD_SUFFIX}`;
  const contents = holderRecord();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (createExclusive(file, contents)) return { file, contents };
    const seen = readLockText(file);
    if (seen === null && !fs.existsSync(file)) continue; // released meanwhile: try again
    const holder = parseLockHolder(seen);
    if (attempt > 0 || !holderIsStale(holder)) {
      throw publisherRefusal(lockFile, holder, `, taking over a stale lock under ${file}`);
    }
    const aside = `${file}.${process.pid}.${process.hrtime.bigint()}.reap`;
    try {
      fs.renameSync(file, aside);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const moved = readLockText(aside);
    if (moved === seen) {
      fs.rmSync(aside, { force: true });
      continue;
    }
    try {
      fs.linkSync(aside, file);
    } catch {
      // A third guard stands there already; it is the one in charge now.
    }
    fs.rmSync(aside, { force: true });
    throw publisherRefusal(lockFile, parseLockHolder(moved), `, taking over a stale lock under ${file}`);
  }
  throw publisherRefusal(lockFile, parseLockHolder(readLockText(file)), `, taking over a stale lock under ${file}`);
}

/** Remove a guard or lock, but only if it is still the one this publisher wrote. */
function releaseOwned(owned: { file: string; contents: string }): void {
  try {
    if (fs.readFileSync(owned.file, "utf8") === owned.contents) fs.rmSync(owned.file, { force: true });
  } catch {
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
function acquirePublishLock(outDir: string): { file: string; contents: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, PUBLISH_LOCK_FILE);
  const contents = holderRecord();
  if (createExclusive(file, contents)) return { file, contents };
  const staleText = readLockText(file);
  const holder = parseLockHolder(staleText);
  if (!holderIsStale(holder)) throw publisherRefusal(file, holder);

  const guard = acquireTakeoverGuard(file);
  try {
    // Only the exact stale bytes are removed. If the lock changed since it was
    // judged stale, another publisher took it over first and it is theirs.
    if (readLockText(file) === staleText) fs.rmSync(file, { force: true });
    if (createExclusive(file, contents)) return { file, contents };
  } finally {
    releaseOwned(guard);
  }
  throw publisherRefusal(file, parseLockHolder(readLockText(file)));
}


/** The string ids of a pointer's publication record, tolerating a pointer without one. */
function recordedHistory(current: CorpusCurrent | null): string[] {
  const list = current?.previous_generation_ids;
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
}

/** The directory name a generation id lands in, or null for an id that cannot be one. */
function directoryNameOrNull(id: string): string | null {
  try {
    return generationDirectoryName(id);
  } catch {
    return null;
  }
}

/** Read the pointer, or null when nothing has been published yet. */
export function readCorpusCurrent(outDir: string): CorpusCurrent | null {
  const file = path.join(outDir, CURRENT_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // Absent, or unreadable. Both mean "there is no generation to read", which
    // is a better answer than a partially-parsed pointer into a directory that
    // may not be there.
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const current = parsed as Partial<CorpusCurrent>;
  if (current.schema !== CORPUS_CURRENT_SCHEMA) return null;
  if (typeof current.generation_id !== "string" || typeof current.generation_ref !== "string") {
    return null;
  }
  return current as CorpusCurrent;
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
export function resolveCurrentGeneration(outDir: string): {
  current: CorpusCurrent;
  directory: string;
  files: { path: string; absolute: string }[];
  missing: string[];
} | null {
  const current = readCorpusCurrent(outDir);
  if (current === null) return null;
  const directory = path.join(outDir, ...current.generation_ref.split("/"));
  const files: { path: string; absolute: string }[] = [];
  const missing: string[] = [];
  for (const entry of current.files) {
    const absolute = path.join(directory, ...entry.path.split("/"));
    if (fs.existsSync(absolute)) files.push({ path: entry.path, absolute });
    else missing.push(entry.path);
  }
  return { current, directory, files, missing };
}

/** Every generation directory present, in code-point order. */
export function listGenerations(outDir: string): string[] {
  const root = path.join(outDir, GENERATIONS_DIRECTORY);
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareCodePoints);
  } catch {
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
function generationDirectoryName(id: string): string {
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
export function publishCorpusGeneration(input: PublishInput): PublishResult {
  const outDir = path.resolve(input.outDir);
  const id = generationId(input.files);
  const directoryName = generationDirectoryName(id);
  const generationRef = `${GENERATIONS_DIRECTORY}/${directoryName}`;
  const generationDirectory = path.join(outDir, GENERATIONS_DIRECTORY, directoryName);

  const ordered = [...input.files].sort((a, b) => compareCodePoints(a.path, b.path));
  for (const file of ordered) {
    if (file.path.length === 0 || file.path.startsWith("/") || file.path.includes("..")) {
      throw new Error(`corpus: refusing to publish '${file.path}' outside its generation`);
    }
  }

  const lock = acquirePublishLock(outDir);
  try {
    return publishUnderLock(input, { outDir, id, directoryName, generationRef, generationDirectory, ordered });
  } finally {
    releaseOwned(lock);
  }
}

function publishUnderLock(
  input: PublishInput,
  target: {
    outDir: string;
    id: string;
    directoryName: string;
    generationRef: string;
    generationDirectory: string;
    ordered: PublishedFile[];
  },
): PublishResult {
  const { outDir, id, directoryName, generationRef, generationDirectory, ordered } = target;
  const keep = Math.max(1, Math.floor(input.keep ?? DEFAULT_KEEP));

  // A generation is identified by its bytes, so one that already exists already
  // holds exactly these files and rewriting it would be work with no effect.
  // Existence is judged by the pointer having named it, not by the directory
  // being there: a directory left by a crash before step 3 may be incomplete.
  const previous = readCorpusCurrent(outDir);
  const reused = previous?.generation_id === id && fs.existsSync(generationDirectory);

  const writtenPaths: string[] = [];
  if (!reused) {
    // Written fresh rather than merged into whatever a previous crash left. The
    // set is content-addressed, so the bytes are the same either way; starting
    // clean means a file the earlier attempt failed on cannot survive as a
    // zero-length remnant beside its correct siblings.
    fs.rmSync(generationDirectory, { recursive: true, force: true });
    fs.mkdirSync(generationDirectory, { recursive: true });
    const touchedDirectories = new Set<string>([generationDirectory]);
    for (const file of ordered) {
      const absolute = path.join(generationDirectory, ...file.path.split("/"));
      const parent = path.dirname(absolute);
      fs.mkdirSync(parent, { recursive: true });
      touchedDirectories.add(parent);
      writeFileDurably(absolute, file.contents);
      writtenPaths.push(absolute);
    }
    // Every directory that gained an entry, so the entries themselves are on the
    // device and not only the bytes they point at.
    for (const directory of [...touchedDirectories].sort(compareCodePoints)) {
      syncDirectory(directory);
    }
    syncDirectory(path.join(outDir, GENERATIONS_DIRECTORY));
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

  const current: CorpusCurrent = {
    schema: CORPUS_CURRENT_SCHEMA,
    generation_id: id,
    generation_ref: generationRef,
    committed_at: input.committedAt,
    files: ordered.map((file) => ({
      path: file.path,
      content_hash: sha256TextPrefixed(file.contents),
    })),
    previous_generation_ids: history,
  };
  const currentFile = path.join(outDir, CURRENT_FILE);
  commitFileDurably({
    staging: `${currentFile}.${process.pid}.tmp`,
    target: currentFile,
    contents: `${canonicalCorpusJson(current)}\n`,
  });

  // Only now, and only what the pointer does not name. The pointer is re-read
  // rather than trusted: whatever it names at deletion time is never deleted.
  const named = readCorpusCurrent(outDir);
  const protectedNames = new Set([directoryName]);
  if (named !== null) protectedNames.add(path.posix.basename(named.generation_ref));
  // Newest first: this generation, then the recorded ones it replaced.
  const recorded = [id, ...history]
    .map(directoryNameOrNull)
    .filter((name): name is string => name !== null);
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
  const pruned: string[] = [];
  for (const name of surplus) {
    fs.rmSync(path.join(outDir, GENERATIONS_DIRECTORY, name), { recursive: true, force: true });
    pruned.push(name);
  }
  if (pruned.length > 0) syncDirectory(path.join(outDir, GENERATIONS_DIRECTORY));

  return {
    generation_id: id,
    generation_directory: generationDirectory,
    current_file: currentFile,
    reused,
    written_paths: writtenPaths,
    pruned_generation_ids: pruned,
  };
}
