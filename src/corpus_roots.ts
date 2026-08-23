// corpus_roots.ts — several local roots read as one logical corpus.
//
// A real archive is not one folder. It is an old SSD, a backup volume and a
// directory of ZIPs, and the same document is often in all three. Analyzing each
// one separately answers the wrong question: the duplicate that matters is the
// one that spans the disks, and the project that matters is the one whose files
// are split across them.
//
// Two kinds of root identity live here, and conflating them is the mistake this
// comment exists to prevent:
//
//   root_snapshot_id   what the root contained on this run. Derived from the
//                      physical snapshot hash, so it changes the moment any byte
//                      under the root changes. It is what makes the corpus
//                      snapshot identity honest.
//
//   root_id            which root this is, across runs. Derived from the root's
//                      declared key — the operator's `--root PATH=NAME`, or the
//                      root's own final path segment. It has to survive a byte
//                      changing, or a second run could not tell an edited file
//                      from a deleted one and a new one.
//
// Neither one contains the mount point. `/Volumes/OldSSD` and
// `/mnt/recovered/OldSSD` are the same root: the drive letter, the volume prefix
// and the parent directories are operational, and they live where `observed_at`
// lives — the session manifest and the operator's terminal, never a semantic
// output.
import * as fs from "node:fs";
import * as path from "node:path";
import { compareCodePoints } from "./ordering";
import { sha256TextPrefixed, stableId } from "./repository_model";

/** Schema of a roots manifest file accepted by `--root-manifest`. */
export const CORPUS_ROOTS_SCHEMA = "l9.corpus-roots/v1";

/** Separator between a root label and a root-relative path in a corpus path. */
export const CORPUS_PATH_SEPARATOR = "::";

/** Link hops followed before a chain is treated as unresolvable. */
const MAX_SYMLINK_HOPS = 64;

/** What the operator asked to be scanned. */
export interface CorpusRootSpec {
  /** Absolute or relative filesystem path to a file, directory or archive. */
  path: string;
  /**
   * The root's declared key. Defaults to the final segment of `path`.
   *
   * This is a name for the root, not a location of it: two mounts of one drive
   * declare the same key and are the same root.
   */
  name?: string;
}

/** Identity of one root: which root it is, and what it held on this run. */
export interface CorpusRootIdentity {
  /** `root:sha256:<hex>` of the declared key. Stable across runs and mounts. */
  root_id: string;
  /** The declared key itself, carried so a report is readable. */
  root_key: string;
  /** Label qualifying every path in this root. Equals `root_key`. */
  root_label: string;
  /** `root-snapshot:sha256:<hex>` of the physical snapshot hash. Per run. */
  root_snapshot_id: string;
  source_kind: string;
  source_revision: string;
  physical_snapshot_hash: string;
}

/**
 * A root's identity plus where it was read from.
 *
 * `absolute_path` never reaches a semantic output. It is here so the session
 * manifest and the terminal can tell an operator which disk `OldSSD` was this
 * time.
 */
export interface CorpusRootBinding extends CorpusRootIdentity {
  absolute_path: string;
  /** True when the operator named the root rather than inheriting its basename. */
  key_declared: boolean;
}

/** Root id of a declared key. Stable across runs, mounts and content changes. */
export function corpusRootId(rootKey: string): string {
  return stableId("root", { root_key: rootKey });
}

/** Identity of one observation of a root. Changes whenever its bytes change. */
export function corpusRootSnapshotId(physicalSnapshotHash: string): string {
  return stableId("root-snapshot", { physical_snapshot_hash: physicalSnapshotHash });
}

/**
 * The default key of a root path: its own final segment.
 *
 * `/Volumes/OldSSD` and `/mnt/recovered/OldSSD` both key as `OldSSD`, which is
 * the point — the segments above it describe where the drive is plugged in, and
 * that is not a fact about the corpus. An operator whose two disks share a final
 * segment declares distinct keys instead.
 */
export function defaultRootKey(rootPath: string): string {
  const absolute = path.resolve(rootPath);
  const base = path.basename(absolute);
  return base.length > 0 ? base : absolute;
}

/**
 * Identity of the corpus as a whole.
 *
 * `H(sorted(root source revisions), corpus profile)`. Sorted, so the order the
 * roots were typed in cannot change it; profile-bound, so a corpus analyzed under
 * different rules is a different snapshot even when the bytes are the same.
 */
export function corpusSnapshotId(input: {
  rootSourceRevisions: readonly string[];
  corpusProfileHash: string;
}): string {
  return stableId("corpus-snapshot", {
    corpus_profile_hash: input.corpusProfileHash,
    root_source_revisions: [...input.rootSourceRevisions].sort(compareCodePoints),
  });
}

/**
 * The corpus-scoped path of a root-relative path.
 *
 * `OldSSD::plans/deploy.md`. The root half is the declared key and the relative
 * half is exactly what acquisition recorded, so no mount point, parent directory
 * or drive letter can enter.
 */
export function corpusPath(rootLabel: string, rootRelativePath: string): string {
  return `${rootLabel}${CORPUS_PATH_SEPARATOR}${rootRelativePath}`;
}

/** Split a corpus path back into its root label and root-relative half. */
export function splitCorpusPath(value: string): { rootLabel: string; rootRelativePath: string } {
  const index = value.indexOf(CORPUS_PATH_SEPARATOR);
  if (index < 0) throw new Error(`corpus: '${value}' is not a corpus path`);
  return {
    rootLabel: value.slice(0, index),
    rootRelativePath: value.slice(index + CORPUS_PATH_SEPARATOR.length),
  };
}

/**
 * Identity of one artifact inside the corpus.
 *
 * Binds the root id and the root-relative path, and nothing else. Two roots
 * holding an identical `README.md` produce two ids; one root read from two mount
 * points produces one; and the id survives the file's bytes changing, which is
 * what lets the next run report a change rather than a deletion and an addition.
 */
export function virtualSourceId(rootId: string, rootRelativePath: string): string {
  return stableId("vsrc", { root_id: rootId, root_relative_path: rootRelativePath });
}

// ───────────────────────────── root specs ─────────────────────────────

/** Parse a `--root PATH` or `--root PATH=NAME` argument. */
export function parseRootArgument(value: string): CorpusRootSpec {
  const separator = value.lastIndexOf("=");
  // A path containing `=` and no name is ambiguous; the trailing `=NAME` form is
  // the one an operator can always fall back to.
  if (separator > 0 && separator < value.length - 1) {
    return { path: value.slice(0, separator), name: value.slice(separator + 1) };
  }
  return { path: value.replace(/=$/, "") };
}

/**
 * Read a roots manifest.
 *
 * Two forms are accepted, because both are things an operator already has: a JSON
 * document declaring `l9.corpus-roots/v1`, and a plain list of paths one per line
 * with `#` comments. Relative paths resolve against the manifest's own directory.
 */
export function readRootManifest(manifestPath: string): CorpusRootSpec[] {
  const absolute = path.resolve(manifestPath);
  const text = fs.readFileSync(absolute, "utf8");
  const base = path.dirname(absolute);
  const resolveSpec = (spec: CorpusRootSpec): CorpusRootSpec => ({
    ...spec,
    path: path.resolve(base, spec.path),
  });

  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as { schema?: unknown; roots?: unknown };
    if (parsed.schema !== CORPUS_ROOTS_SCHEMA) {
      throw new Error(
        `corpus: ${absolute} declares schema '${String(parsed.schema)}'; expected '${CORPUS_ROOTS_SCHEMA}'`,
      );
    }
    if (!Array.isArray(parsed.roots)) throw new Error(`corpus: ${absolute} has no 'roots' array`);
    return parsed.roots.map((entry, index) => {
      if (typeof entry === "string") return resolveSpec({ path: entry });
      if (entry === null || typeof entry !== "object") {
        throw new Error(`corpus: ${absolute} root #${index} is neither a path nor an object`);
      }
      const record = entry as { path?: unknown; name?: unknown };
      if (typeof record.path !== "string" || record.path.length === 0) {
        throw new Error(`corpus: ${absolute} root #${index} has no 'path'`);
      }
      return resolveSpec({
        path: record.path,
        ...(typeof record.name === "string" && record.name.length > 0 ? { name: record.name } : {}),
      });
    });
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => resolveSpec(parseRootArgument(line)));
}

// ───────────────────────────── binding ─────────────────────────────

/** One root folded into another because both are the same root, twice mounted. */
export interface FoldedRoot {
  root_id: string;
  root_key: string;
  /** Absolute path of the duplicate mount. Operational only. */
  absolute_path: string;
  kept_absolute_path: string;
}

export interface CorpusRootBindingResult {
  roots: CorpusRootBinding[];
  folded: FoldedRoot[];
}

/**
 * Order roots by identity and fold any that repeats one already bound.
 *
 * The same disk mounted twice is one root: keeping both would double every count
 * in the corpus and invent a duplicate cluster for every file on it, which is a
 * fact about the operator's mount table rather than about their work. Two roots
 * that share a key while holding different bytes are not that case, and are
 * refused rather than silently merged into a corpus that describes neither.
 */
export function bindCorpusRoots(bindings: readonly CorpusRootBinding[]): CorpusRootBindingResult {
  const ordered = [...bindings].sort(
    (a, b) => compareCodePoints(a.root_id, b.root_id) || compareCodePoints(a.absolute_path, b.absolute_path),
  );
  const roots: CorpusRootBinding[] = [];
  const folded: FoldedRoot[] = [];
  const seen = new Map<string, CorpusRootBinding>();
  for (const binding of ordered) {
    const existing = seen.get(binding.root_id);
    if (existing === undefined) {
      seen.set(binding.root_id, binding);
      roots.push(binding);
      continue;
    }
    if (existing.physical_snapshot_hash !== binding.physical_snapshot_hash) {
      throw new Error(
        `corpus: two roots declare the key '${binding.root_key}' but hold different content `
        + `(${existing.absolute_path} and ${binding.absolute_path}); `
        + "give each one a distinct key with --root PATH=NAME",
      );
    }
    folded.push({
      root_id: binding.root_id,
      root_key: binding.root_key,
      absolute_path: binding.absolute_path,
      kept_absolute_path: existing.absolute_path,
    });
  }
  return { roots, folded };
}

/** The identity half of a binding, with every operational field dropped. */
export function rootIdentity(binding: CorpusRootBinding): CorpusRootIdentity {
  return {
    root_id: binding.root_id,
    root_key: binding.root_key,
    root_label: binding.root_label,
    root_snapshot_id: binding.root_snapshot_id,
    source_kind: binding.source_kind,
    source_revision: binding.source_revision,
    physical_snapshot_hash: binding.physical_snapshot_hash,
  };
}

/**
 * The path a write to `target` would actually land on.
 *
 * `path.resolve` normalizes `..` and `.` and stops there, which is not enough to
 * decide containment: a symlink at `/tmp/out` pointing into an observed root
 * resolves to `/tmp/out` lexically and to the root in fact, and a check that only
 * looked at the former would approve writes straight into the tree this package
 * promises not to touch.
 *
 * The nearest existing ancestor is resolved through `realpath` and the
 * not-yet-existing remainder is re-appended, so a target that has not been
 * created yet is still judged by where it would be created.
 */
export function resolveForContainment(target: string): string {
  const missing: string[] = [];
  const rejoin = (base: string): string =>
    missing.length === 0 ? base : path.join(base, ...[...missing].reverse());
  let cursor = path.resolve(target);
  let hops = 0;
  for (;;) {
    try {
      return rejoin(fs.realpathSync(cursor));
    } catch {
      // Not fully present. Either this component is a link that does not resolve,
      // or it does not exist at all.
    }

    // A dangling symlink is the case that matters: `--out` pointing at a
    // directory that does not exist *yet*, inside a tree this run is observing.
    // `realpath` refuses it, so the link is read directly.
    let linkTarget: string | null = null;
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) linkTarget = fs.readlinkSync(cursor);
    } catch {
      // Not a link, or unreadable; fall through to walking up.
    }
    if (linkTarget !== null && hops < MAX_SYMLINK_HOPS) {
      hops += 1;
      cursor = path.resolve(path.dirname(cursor), linkTarget);
      continue;
    }

    const parent = path.dirname(cursor);
    // The filesystem root itself could not be resolved, or a link chain is longer
    // than any legitimate one: nothing better than the lexical answer is
    // available, and it is the conservative one to compare against.
    if (parent === cursor) return rejoin(cursor);
    missing.push(path.basename(cursor));
    cursor = parent;
  }
}

/**
 * The directory an observed root's outputs must stay out of.
 *
 * A root that is a file protects its parent directory, because that is where a
 * sibling write would land.
 */
export function containmentBoundary(rootPath: string): string {
  const resolved = resolveForContainment(rootPath);
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);
}

/** True when `target` is `container` or lies beneath it, both already resolved. */
export function isInsideContainer(container: string, target: string): boolean {
  return target === container || target.startsWith(container + path.sep);
}

/**
 * Refuse a path that lies inside any observed root.
 *
 * Used for every writable location the corpus layer owns — the cache, the session
 * manifest, the projections. Writing under an observed root would mutate what was
 * just observed and make the next run read this run's output as user content.
 *
 * Both sides are resolved through `realpath` first. Comparing lexical paths would
 * let a symlink walk straight through this check.
 */
export function assertOutsideRoots(
  target: string,
  rootPaths: readonly string[],
  what: string,
): string {
  const resolvedTarget = resolveForContainment(target);
  for (const rootPath of rootPaths) {
    if (isInsideContainer(containmentBoundary(rootPath), resolvedTarget)) {
      throw new Error(
        `corpus: refusing to write ${what} inside an observed root: ${resolvedTarget}`
        + (resolvedTarget === path.resolve(target) ? "" : ` (reached through ${path.resolve(target)})`),
      );
    }
  }
  return resolvedTarget;
}

/** Digest of a text payload, used by callers that need a profile hash. */
export function corpusTextDigest(value: string): string {
  return sha256TextPrefixed(value);
}
