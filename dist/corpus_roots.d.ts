/** Schema of a roots manifest file accepted by `--root-manifest`. */
export declare const CORPUS_ROOTS_SCHEMA = "l9.corpus-roots/v1";
/** Schema of a corpus manifest file accepted by `--manifest`. */
export declare const CORPUS_MANIFEST_SCHEMA = "l9.local-corpus/v1";
/** Corpus name used when no manifest declares one. */
export declare const DEFAULT_CORPUS_ID = "local-corpus";
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
/**
 * Where a root's key came from, and therefore how much its id is worth.
 *
 * `declared` — the operator named this root. The key is a name they chose for a
 * disk, so the same key across two runs means the same disk because a person
 * said so. This is the identity a longitudinal comparison can rest on.
 *
 * `inferred` — the key is the final segment of the path it was mounted at. That
 * is a good default and a weak identity: `/Volumes/Backup` this month and
 * `/mnt/usb/Backup` next month are the same disk under this rule, which is
 * usually right, but so are two entirely unrelated drives that both happen to
 * end in `Backup`. Nothing in the bytes can tell those cases apart, so the class
 * is recorded and the diff refuses to quietly treat an inferred match as
 * continuity.
 */
export type RootIdentityClass = "declared" | "inferred";
/** Identity of one root: which root it is, and what it held on this run. */
export interface CorpusRootIdentity {
    /** `root:sha256:<hex>` of the declared key. Stable across runs and mounts. */
    root_id: string;
    /** The declared key itself, carried so a report is readable. */
    root_key: string;
    /** Whether the operator named this root or its basename was taken. */
    root_identity_class: RootIdentityClass;
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
    /**
     * True when the operator named the root rather than inheriting its basename.
     *
     * The same fact as `root_identity_class`, kept as a boolean because callers
     * branch on it. The class is what reaches the snapshot; this stays operational.
     */
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
/** One root's contribution to the corpus source identity. */
export interface CorpusSourceSnapshotRoot {
    root_id: string;
    source_revision: string;
    /** Packet id of the root's own Repository Model Packet. */
    rmp_packet_id: string;
}
/**
 * Identity of what the corpus *contained*.
 *
 * `H(sorted(root_id, source_revision, rmp_packet_id))`. Sorted, so the order the
 * roots were typed in cannot change it.
 *
 * No analysis profile enters this. That separation is the whole point: swapping an
 * embedding model, raising a threshold or turning interpretation off changes what
 * was concluded about the corpus and changes nothing about what was on the disks.
 * An identity that mixed the two would report every policy change as though the
 * drives had been rewritten, and a later run could no longer tell a real byte
 * change from a settings change. What the analysis was computed under is
 * `corpusAnalysisId`, and it is a separate number on purpose.
 */
export declare function corpusSourceSnapshotId(roots: readonly CorpusSourceSnapshotRoot[]): string;
/** Every policy the derived layers were computed under. */
export interface CorpusAnalysisProfiles {
    corpus_profile: string;
    document_decoder_profiles: readonly string[];
    interpretation_profile: string;
    /**
     * The rules read over decoded blocks, for formats that have no lines.
     *
     * Separate from `interpretation_profile` because the two answer the same
     * question about different sources: one reads a file that has line numbers and
     * cites them, the other reads a Word document that has none and cites block
     * locators. Folding them together would mean a change to either invalidated
     * both, and would hide which of the two produced a given claim.
     */
    document_block_profile: string;
    semantic_candidate_profile: string;
    /** Present only when embeddings ran. */
    embedding_profile?: string;
    readiness_profile: string;
}
/**
 * Identity of what was *concluded* about the corpus.
 *
 * Binds the source identity and every analysis profile, so two runs share it only
 * when both the bytes and the rules were the same. Changing a model changes this
 * and leaves `corpusSourceSnapshotId` alone, which is the honest report: the
 * conclusions are new, the disks are not.
 */
export declare function corpusAnalysisId(input: {
    corpusSourceSnapshotId: string;
    profiles: CorpusAnalysisProfiles;
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
/**
 * The directory a root's own outputs are written under, inside `roots/`.
 *
 * An operator who declared `old-ssd` should find `roots/old-ssd/`, so a key that
 * is already a plain directory name is used as one. A key that is not — one with
 * a slash, a space, a leading dot, or a script the local filesystem may normalize
 * — is slugged and given a short digest of the exact key. The digest is what makes
 * the mapping injective: two keys that slug alike stay two directories, and the
 * name is still stable across runs and machines because it is a function of the
 * key alone.
 */
export declare function rootDirectoryName(rootKey: string): string;
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
/** A corpus manifest: a named corpus and the roots it is made of. */
export interface CorpusManifest {
    corpus_id: string;
    roots: CorpusRootSpec[];
}
/**
 * Read a corpus manifest.
 *
 * The manifest is where an operator names their corpus and names each root, and
 * naming the roots is the point: `root_id` is the identity the corpus carries
 * across runs, so it has to be a decision rather than a consequence of where the
 * drive happened to mount today. A root declared `old-ssd` stays `old-ssd` at
 * `/Volumes/OldSSD`, at `/mnt/recovered/OldSSD`, and on the next machine.
 *
 * `--root-manifest`'s two older forms are still accepted here, so a roots list
 * that predates corpus naming keeps working; those carry no corpus name, and the
 * default one is used.
 */
export declare function readCorpusManifest(manifestPath: string): CorpusManifest;
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
