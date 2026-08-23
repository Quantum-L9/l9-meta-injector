export declare const CORPUS_CURRENT_SCHEMA = "l9.corpus-current/v1";
/** Where the pointer and the generations live, relative to the output root. */
export declare const CURRENT_FILE = "CURRENT.json";
export declare const GENERATIONS_DIRECTORY = "generations";
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
    files: {
        path: string;
        content_hash: string;
    }[];
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
export declare function generationId(files: readonly PublishedFile[]): string;
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
    beforeSwitch?: (generation: {
        id: string;
        directory: string;
    }) => void;
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
/** Read the pointer, or null when nothing has been published yet. */
export declare function readCorpusCurrent(outDir: string): CorpusCurrent | null;
/**
 * Resolve the published file set a reader should read.
 *
 * Returns absolute paths for the files `CURRENT.json` names and that are
 * actually present. A file the pointer names and the directory does not have is
 * reported as missing rather than skipped: a generation that lost a file is a
 * broken generation, and silently returning the rest is how a partial set gets
 * read as a whole one.
 */
export declare function resolveCurrentGeneration(outDir: string): {
    current: CorpusCurrent;
    directory: string;
    files: {
        path: string;
        absolute: string;
    }[];
    missing: string[];
} | null;
/** Every generation directory present, in code-point order. */
export declare function listGenerations(outDir: string): string[];
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
export declare function publishCorpusGeneration(input: PublishInput): PublishResult;
