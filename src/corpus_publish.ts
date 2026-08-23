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
 *  1. Write the generation's files, each synced. A crash here leaves an
 *     unreferenced directory that no reader can reach, because `CURRENT.json`
 *     has not moved.
 *  2. Sync the generation directory, so its entries are on the device before
 *     anything points at them. Without this the pointer could survive a power
 *     cut that the files it names did not.
 *  3. Switch `CURRENT.json` with one durable rename. This is the instant the
 *     reader's whole view changes, and it is one syscall rather than twelve.
 *  4. Prune, after the switch, never touching what `CURRENT.json` names.
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

  const current: CorpusCurrent = {
    schema: CORPUS_CURRENT_SCHEMA,
    generation_id: id,
    generation_ref: generationRef,
    committed_at: input.committedAt,
    files: ordered.map((file) => ({
      path: file.path,
      content_hash: sha256TextPrefixed(file.contents),
    })),
  };
  const currentFile = path.join(outDir, CURRENT_FILE);
  commitFileDurably({
    staging: `${currentFile}.${process.pid}.tmp`,
    target: currentFile,
    contents: `${canonicalCorpusJson(current)}\n`,
  });

  // Only now, and only what the pointer does not name.
  const keep = Math.max(1, Math.floor(input.keep ?? DEFAULT_KEEP));
  const pruned: string[] = [];
  const generations = listGenerations(outDir).filter((name) => name !== directoryName);
  const surplus = generations.slice(0, Math.max(0, generations.length - (keep - 1)));
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
