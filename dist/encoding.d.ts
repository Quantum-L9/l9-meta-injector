/** Chunk size for streaming reads. Fixed so memory never scales with file size. */
export declare const ENCODING_CHUNK_BYTES: number;
export type EncodingStatus = 
/** Every byte decoded as UTF-8. */
"utf8"
/** A NUL byte was found: treated as binary, never decoded or mutated. */
 | "binary"
/** Bytes are not valid UTF-8 (e.g. Windows-1252, Latin-1, truncated sequence). */
 | "invalid"
/** The file could not be opened or read. */
 | "unreadable";
export interface EncodingProbe {
    status: EncodingStatus;
    /** Human-readable reason, always populated. Never contains file content. */
    reason: string;
    /** Size in bytes when it could be determined. */
    sizeBytes?: number;
    /** True when the file begins with a UTF-8 BOM. Only meaningful for `utf8`. */
    hasBom: boolean;
}
/** True when this probe permits decoding the file as text. */
export declare function isDecodableText(probe: EncodingProbe): boolean;
/**
 * Validate a whole file as UTF-8 without loading it.
 *
 * Reads fixed-size chunks and feeds them to one fatal streaming decoder, so a
 * multi-byte sequence split across a chunk boundary is not misreported, and a
 * dangling partial sequence at EOF is caught by the final flush.
 */
export declare function probeFileEncoding(absolutePath: string, chunkBytes?: number): EncodingProbe;
/**
 * Validate an in-memory buffer as UTF-8. Used for archive members, whose bytes
 * are already staged, and anywhere a buffer is decoded before mutation.
 */
export declare function probeBufferEncoding(bytes: Buffer): EncodingProbe;
/**
 * Read a file as text only when every byte is valid UTF-8.
 *
 * Throws with an explicit encoding reason otherwise. Callers that must not throw
 * should call `probeFileEncoding` first and branch on the status.
 */
export declare function readUtf8Strict(absolutePath: string): string;
