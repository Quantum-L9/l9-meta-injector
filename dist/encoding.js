"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENCODING_CHUNK_BYTES = void 0;
exports.isDecodableText = isDecodableText;
exports.probeFileEncoding = probeFileEncoding;
exports.probeBufferEncoding = probeBufferEncoding;
exports.readUtf8Strict = readUtf8Strict;
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
const fs = __importStar(require("node:fs"));
/** Chunk size for streaming reads. Fixed so memory never scales with file size. */
exports.ENCODING_CHUNK_BYTES = 64 * 1024;
/** UTF-8 byte-order mark. Valid UTF-8; recorded so callers can preserve it. */
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
/** True when this probe permits decoding the file as text. */
function isDecodableText(probe) {
    return probe.status === "utf8";
}
/**
 * Validate a whole file as UTF-8 without loading it.
 *
 * Reads fixed-size chunks and feeds them to one fatal streaming decoder, so a
 * multi-byte sequence split across a chunk boundary is not misreported, and a
 * dangling partial sequence at EOF is caught by the final flush.
 */
function probeFileEncoding(absolutePath, chunkBytes = exports.ENCODING_CHUNK_BYTES) {
    let fd = null;
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
            if (count === 0)
                break;
            const chunk = buffer.subarray(0, count);
            if (inspected === 0 && count >= BOM.length && chunk.subarray(0, BOM.length).equals(BOM))
                hasBom = true;
            for (let i = 0; i < count; i++) {
                if (chunk[i] === 0) {
                    return { status: "binary", reason: "NUL byte detected", sizeBytes: stat.size, hasBom: false };
                }
            }
            try {
                decoder.decode(chunk, { stream: true });
            }
            catch (error) {
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
        }
        catch (error) {
            return {
                status: "invalid",
                reason: `truncated UTF-8 sequence at end of file: ${error instanceof Error ? error.message : String(error)}`,
                sizeBytes: stat.size,
                hasBom,
            };
        }
        return { status: "utf8", reason: "valid UTF-8 over every byte", sizeBytes: stat.size, hasBom };
    }
    catch (error) {
        return {
            status: "unreadable",
            reason: error instanceof Error ? error.message : String(error),
            hasBom: false,
        };
    }
    finally {
        if (fd !== null)
            fs.closeSync(fd);
    }
}
/**
 * Validate an in-memory buffer as UTF-8. Used for archive members, whose bytes
 * are already staged, and anywhere a buffer is decoded before mutation.
 */
function probeBufferEncoding(bytes) {
    const hasBom = bytes.length >= BOM.length && bytes.subarray(0, BOM.length).equals(BOM);
    if (bytes.includes(0)) {
        return { status: "binary", reason: "NUL byte detected", sizeBytes: bytes.length, hasBom: false };
    }
    try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch (error) {
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
function readUtf8Strict(absolutePath) {
    const probe = probeFileEncoding(absolutePath);
    if (probe.status !== "utf8") {
        throw new Error(`UNSUPPORTED_ENCODING: ${absolutePath}: ${probe.reason}`);
    }
    return fs.readFileSync(absolutePath, "utf8");
}
//# sourceMappingURL=encoding.js.map