/** Schema of a roots manifest file accepted by `--root-manifest`. */
export declare const CORPUS_ROOTS_SCHEMA = "l9.corpus-roots/v1";
/** Separator between a root label and a root-relative path in a corpus path. */
export declare const CORPUS_PATH_SEPARATOR = "::";
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
export declare function corpusRootId(rootKey: string): string;
/** Identity of one observation of a root. Changes whenever its bytes change. */
export declare function corpusRootSnapshotId(physicalSnapshotHash: string): string;
/**
 * The default key of a root path: its own final segment.
 *
 * `/Volumes/OldSSD` and `/mnt/recovered/OldSSD` both key as `OldSSD`, which is
 * the point — the segments above it describe where the drive is plugged in, and
 * that is not a fact about the corpus. An operator whose two disks share a final
 * segment declares distinct keys instead.
 */
export declare function defaultRootKey(rootPath: string): string;
/**
 * Identity of the corpus as a whole.
 *
 * `H(sorted(root source revisions), corpus profile)`. Sorted, so the order the
 * roots were typed in cannot change it; profile-bound, so a corpus analyzed under
 * different rules is a different snapshot even when the bytes are the same.
 */
export declare function corpusSnapshotId(input: {
    rootSourceRevisions: readonly string[];
    corpusProfileHash: string;
}): string;
/**
 * The corpus-scoped path of a root-relative path.
 *
 * `OldSSD::plans/deploy.md`. The root half is the declared key and the relative
 * half is exactly what acquisition recorded, so no mount point, parent directory
 * or drive letter can enter.
 */
export declare function corpusPath(rootLabel: string, rootRelativePath: string): string;
/** Split a corpus path back into its root label and root-relative half. */
export declare function splitCorpusPath(value: string): {
    rootLabel: string;
    rootRelativePath: string;
};
/**
 * Identity of one artifact inside the corpus.
 *
 * Binds the root id and the root-relative path, and nothing else. Two roots
 * holding an identical `README.md` produce two ids; one root read from two mount
 * points produces one; and the id survives the file's bytes changing, which is
 * what lets the next run report a change rather than a deletion and an addition.
 */
export declare function virtualSourceId(rootId: string, rootRelativePath: string): string;
/** Parse a `--root PATH` or `--root PATH=NAME` argument. */
export declare function parseRootArgument(value: string): CorpusRootSpec;
/**
 * Read a roots manifest.
 *
 * Two forms are accepted, because both are things an operator already has: a JSON
 * document declaring `l9.corpus-roots/v1`, and a plain list of paths one per line
 * with `#` comments. Relative paths resolve against the manifest's own directory.
 */
export declare function readRootManifest(manifestPath: string): CorpusRootSpec[];
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
export declare function bindCorpusRoots(bindings: readonly CorpusRootBinding[]): CorpusRootBindingResult;
/** The identity half of a binding, with every operational field dropped. */
export declare function rootIdentity(binding: CorpusRootBinding): CorpusRootIdentity;
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
export declare function resolveForContainment(target: string): string;
/**
 * The directory an observed root's outputs must stay out of.
 *
 * A root that is a file protects its parent directory, because that is where a
 * sibling write would land.
 */
export declare function containmentBoundary(rootPath: string): string;
/** True when `target` is `container` or lies beneath it, both already resolved. */
export declare function isInsideContainer(container: string, target: string): boolean;
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
export declare function assertOutsideRoots(target: string, rootPaths: readonly string[], what: string): string;
/** Digest of a text payload, used by callers that need a profile hash. */
export declare function corpusTextDigest(value: string): string;
