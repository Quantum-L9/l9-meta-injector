// encoding.ts — whole-file UTF-8 validation with bounded memory.
//
// A prefix probe is not an encoding decision. A file whose first 8 KiB decode
// cleanly can still be Windows-1252 from byte 8193 onward, and every mutating
// path in this package (frontmatter parse, inline injection) rewrites the whole
// file. Validating a prefix and then rewriting the whole file is how a lossy
// re-encode happens, so eligibility for decode or mutation is decided here, over
// every byte, before either occurs.
//
// Bounded memory is a hard requirement: an external drive can hand this package a
// multi-gigabyte file, so validation streams fixed-size chunks through a single
// fatal TextDecoder rather than materializing the file.
import * as fs from "node:fs";

/** Chunk size for streaming reads. Fixed so memory never scales with file size. */
export const ENCODING_CHUNK_BYTES = 64 * 1024;

/** UTF-8 byte-order mark. Valid UTF-8; recorded so callers can preserve it. */
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export type EncodingStatus =
  /** Every byte decoded as UTF-8. */
  | "utf8"
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
export function isDecodableText(probe: EncodingProbe): boolean {
  return probe.status === "utf8";
}

/**
 * Validate a whole file as UTF-8 without loading it.
 *
 * Reads fixed-size chunks and feeds them to one fatal streaming decoder, so a
 * multi-byte sequence split across a chunk boundary is not misreported, and a
 * dangling partial sequence at EOF is caught by the final flush.
 */
export function probeFileEncoding(absolutePath: string, chunkBytes = ENCODING_CHUNK_BYTES): EncodingProbe {
  let fd: number | null = null;
  try {
    const stat = fs.statSync(absolutePath);
    fd = fs.openSync(absolutePath, "r");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const buffer = Buffer.alloc(Math.max(1, chunkBytes));
    let offset = 0;
    let hasBom = false;
    let inspected = 0;

    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (count === 0) break;
      const chunk = buffer.subarray(0, count);
      if (inspected === 0 && count >= BOM.length && chunk.subarray(0, BOM.length).equals(BOM)) hasBom = true;
      for (let i = 0; i < count; i++) {
        if (chunk[i] === 0) {
          return { status: "binary", reason: "NUL byte detected", sizeBytes: stat.size, hasBom: false };
        }
      }
      try {
        decoder.decode(chunk, { stream: true });
      } catch (error) {
        return {
          status: "invalid",
          reason: `invalid UTF-8 at byte offset ${offset}: ${error instanceof Error ? error.message : String(error)}`,
          sizeBytes: stat.size,
          hasBom,
        };
      }
      offset += count;
      inspected += count;
    }

    try {
      // Flush: throws when the file ended mid-sequence.
      decoder.decode();
    } catch (error) {
      return {
        status: "invalid",
        reason: `truncated UTF-8 sequence at end of file: ${error instanceof Error ? error.message : String(error)}`,
        sizeBytes: stat.size,
        hasBom,
      };
    }

    return { status: "utf8", reason: "valid UTF-8 over every byte", sizeBytes: stat.size, hasBom };
  } catch (error) {
    return {
      status: "unreadable",
      reason: error instanceof Error ? error.message : String(error),
      hasBom: false,
    };
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Validate an in-memory buffer as UTF-8. Used for archive members, whose bytes
 * are already staged, and anywhere a buffer is decoded before mutation.
 */
export function probeBufferEncoding(bytes: Buffer): EncodingProbe {
  const hasBom = bytes.length >= BOM.length && bytes.subarray(0, BOM.length).equals(BOM);
  if (bytes.includes(0)) {
    return { status: "binary", reason: "NUL byte detected", sizeBytes: bytes.length, hasBom: false };
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    return {
      status: "invalid",
      reason: `invalid UTF-8: ${error instanceof Error ? error.message : String(error)}`,
      sizeBytes: bytes.length,
      hasBom,
    };
  }
  return { status: "utf8", reason: "valid UTF-8 over every byte", sizeBytes: bytes.length, hasBom };
}

/**
 * Read a file as text only when every byte is valid UTF-8.
 *
 * Throws with an explicit encoding reason otherwise. Callers that must not throw
 * should call `probeFileEncoding` first and branch on the status.
 */
export function readUtf8Strict(absolutePath: string): string {
  const probe = probeFileEncoding(absolutePath);
  if (probe.status !== "utf8") {
    throw new Error(`UNSUPPORTED_ENCODING: ${absolutePath}: ${probe.reason}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}
