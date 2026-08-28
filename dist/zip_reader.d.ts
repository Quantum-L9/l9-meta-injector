/** Compression methods this reader can decode. */
export declare const COMPRESSION_STORED = 0;
export declare const COMPRESSION_DEFLATE = 8;
export type ZipEntryKind = "file" | "directory" | "symlink" | "special" | "unknown";
export interface ZipCentralEntry {
    /** Member name exactly as stored, decoded per the UTF-8 flag. */
    name: string;
    /** True when the stored name is not valid UTF-8 and was decoded lossily. */
    nameEncodingSuspect: boolean;
    compressionMethod: number;
    generalPurposeFlags: number;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
    externalAttributes: number;
    versionMadeBy: number;
    /** Entry kind derived from the Unix mode when present, else from the name. */
    kind: ZipEntryKind;
    /** True when either encryption bit is set. */
    encrypted: boolean;
    /** Unix mode when the host system recorded one, else null. */
    unixMode: number | null;
    /** Index in central-directory order. Preserved so ordering is reproducible. */
    index: number;
}
export interface ZipDirectory {
    entries: ZipCentralEntry[];
    /** Total entry count declared by the end-of-central-directory record. */
    declaredEntryCount: number;
    /** True when the archive used Zip64 records. */
    zip64: boolean;
}
export declare class ZipFormatError extends Error {
    constructor(message: string);
}
/**
 * Read an archive's central directory.
 *
 * The central directory — not the local headers — is the authority for what an
 * archive claims to contain, so preflight can run over the complete member list
 * before any extraction begins.
 */
export declare function readZipCentralDirectory(archivePath: string): ZipDirectory;
/** Incremental CRC-32, matching the checksum a ZIP central directory records. */
export declare class Crc32 {
    private state;
    update(chunk: Buffer): void;
    digest(): number;
}
export interface ZipMemberStreamLimits {
    /** Hard ceiling on bytes produced for this member. Exceeding it aborts the read. */
    maxUncompressedBytes: number;
    /** Chunk size used for stored members and for the sink. */
    chunkBytes?: number;
}
export declare class ZipBudgetExceededError extends Error {
    constructor(message: string);
}
export interface ZipMemberStreamResult {
    bytesWritten: number;
    crc32: number;
}
/**
 * Read one member and hand its bytes to `sink` in chunks.
 *
 * `maxUncompressedBytes` is enforced by the decompressor itself, not by trusting
 * the central directory: a member that understates its uncompressed size still
 * cannot produce more than the ceiling, because zlib aborts at the limit and the
 * sink never sees the excess. That is the runtime accounting a declared-size
 * check alone cannot provide.
 *
 * The two paths do not cost the same memory, and the difference is deliberate.
 * A stored member is read incrementally, so an uncompressed archive of any size
 * costs one chunk. A deflated member is inflated synchronously and held whole:
 * peak cost is its compressed bytes plus its inflated bytes, and the chunking
 * below is a delivery detail, not evidence of streaming. What bounds that is
 * `maxUncompressedBytes`, enforced inside zlib, together with the archive- and
 * member-level ceilings the caller derives from the archive policy. Within
 * those ceilings the buffering is bounded; there is no size at which this
 * becomes a streaming inflate. Raising them raises real peak memory.
 */
export declare function streamZipMember(archivePath: string, entry: ZipCentralEntry, limits: ZipMemberStreamLimits, sink: (chunk: Buffer) => void): ZipMemberStreamResult;
