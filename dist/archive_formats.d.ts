/** Archive extensions the canonical ZIP reader expands (v1: zip only). */
export declare const EXPANDABLE_ARCHIVE_EXTENSIONS: ReadonlySet<string>;
/**
 * Archive extensions this package recognizes but never opens.
 *
 * Every one of these is classified as an archive, hashed, and reported through
 * `archive.format_not_expanded`. TAR and every compressed tarball spelling sit
 * here: there is no TAR reader in v1, and no external tool is consulted.
 */
export declare const KNOWN_UNEXPANDABLE_ARCHIVE_EXTENSIONS: ReadonlySet<string>;
/** Every extension this package classifies as an archive, expandable or not. */
export declare const ARCHIVE_EXTENSIONS: ReadonlySet<string>;
/** Lower-cased extension of a path or member name, as `path.extname` reports it. */
export declare function archiveExtensionOf(name: string): string;
export declare function isExpandableArchivePath(name: string): boolean;
export declare function isKnownUnexpandableArchivePath(name: string): boolean;
export declare function isArchivePath(name: string): boolean;
/** Byte signatures this package recognizes. None of them authorizes expansion. */
export type ArchiveSignature = "zip" | "tar" | "gzip" | "bzip2" | "xz" | "zstd" | "7z" | "rar";
/** Prefix length the signature probe needs: the ustar magic sits at offset 257. */
export declare const ARCHIVE_SIGNATURE_PROBE_BYTES = 512;
/**
 * Identify an archive container from its leading bytes, or null.
 *
 * Only unambiguous magic is recognized. A pre-POSIX (v7) tar carries no magic
 * at all and is not detected; that is a documented limit, not a guess. ZIP is
 * recognized by its local-header, empty-archive or spanning signature.
 */
export declare function sniffArchiveSignature(prefix: Buffer): ArchiveSignature | null;
/**
 * Extensions whose files are ZIP containers by format and are read by their own
 * document decoders rather than as archives. A ZIP signature on one of these is
 * the expected shape of the document, not a disguised archive.
 */
export declare const ZIP_CONTAINER_DOCUMENT_EXTENSIONS: ReadonlySet<string>;
/**
 * Whether a signature found under `name` is worth reporting: the file's name
 * did not already declare it an archive, and it is not a document container
 * whose ZIP framing is its normal format.
 */
export declare function signatureContradictsName(name: string, signature: ArchiveSignature): boolean;
