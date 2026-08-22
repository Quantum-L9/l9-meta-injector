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
exports.ZipBudgetExceededError = exports.Crc32 = exports.ZipFormatError = exports.COMPRESSION_DEFLATE = exports.COMPRESSION_STORED = void 0;
exports.readZipCentralDirectory = readZipCentralDirectory;
exports.streamZipMember = streamZipMember;
// zip_reader.ts — central-directory ZIP reader with streaming, budgeted extraction.
//
// The canonical security boundary cannot be a `unzip` subprocess. A subprocess
// decides for itself what a member path means, whether to follow a symlink entry,
// and how many bytes to write; by the time it returns, the damage is on disk.
// Reading the central directory ourselves means every member is classified,
// path-checked and budgeted BEFORE a single byte is materialized, and the
// extractor stops mid-member the moment a byte budget is exceeded.
//
// Scope: ZIP only, stored (0) and deflate (8). Node's zlib supplies raw inflate,
// so this adds no dependency. Zip64 central-directory records are understood so a
// large archive is read correctly rather than silently truncated.
const fs = __importStar(require("node:fs"));
const zlib = __importStar(require("node:zlib"));
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_FIXED_SIZE = 46;
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_FIXED_SIZE = 30;
const ZIP64_EXTRA_ID = 0x0001;
const MAX_EOCD_SEARCH = 0xffff + EOCD_MIN_SIZE;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
/** General-purpose bit flags this reader interprets. */
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8_NAME = 0x0800;
/** Compression methods this reader can decode. */
exports.COMPRESSION_STORED = 0;
exports.COMPRESSION_DEFLATE = 8;
/** Host system in `version made by`. 3 = Unix, the only host that carries st_mode. */
const HOST_UNIX = 3;
/** POSIX file-type mask and values, as encoded in the Unix external attributes. */
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const S_IFIFO = 0o010000;
const S_IFCHR = 0o020000;
const S_IFBLK = 0o060000;
const S_IFSOCK = 0o140000;
class ZipFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = "ZipFormatError";
    }
}
exports.ZipFormatError = ZipFormatError;
function readExact(fd, length, position) {
    if (length < 0)
        throw new ZipFormatError(`negative read length ${length}`);
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
        const count = fs.readSync(fd, buffer, read, length - read, position + read);
        if (count === 0)
            throw new ZipFormatError(`unexpected end of archive at offset ${position + read}`);
        read += count;
    }
    return buffer;
}
/** Read an 8-byte little-endian value, refusing anything above Number.MAX_SAFE_INTEGER. */
function readSafeUInt64LE(buffer, offset, label) {
    const value = buffer.readBigUInt64LE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ZipFormatError(`${label} exceeds the safe integer range: ${value.toString()}`);
    }
    return Number(value);
}
function decodeMemberName(raw, flags) {
    // Bit 11 declares UTF-8. Without it the historical encoding is CP437, which this
    // reader does not transcode: the bytes are decoded as UTF-8 and flagged when that
    // is lossy, so a name that cannot be represented faithfully is visible rather than
    // silently mangled into a different path.
    try {
        const name = new TextDecoder("utf-8", { fatal: true }).decode(raw);
        return { name, suspect: (flags & FLAG_UTF8_NAME) === 0 && /[^\x20-\x7e]/.test(name) };
    }
    catch {
        return { name: raw.toString("utf8"), suspect: true };
    }
}
function entryKindFor(versionMadeBy, externalAttributes, name) {
    const host = (versionMadeBy >> 8) & 0xff;
    if (host === HOST_UNIX) {
        const mode = (externalAttributes >>> 16) & 0xffff;
        if (mode !== 0) {
            switch (mode & S_IFMT) {
                case S_IFLNK: return { kind: "symlink", unixMode: mode };
                case S_IFDIR: return { kind: "directory", unixMode: mode };
                case S_IFREG: return { kind: "file", unixMode: mode };
                case S_IFIFO:
                case S_IFCHR:
                case S_IFBLK:
                case S_IFSOCK: return { kind: "special", unixMode: mode };
                default: return { kind: "unknown", unixMode: mode };
            }
        }
    }
    // No usable mode: a trailing separator is the portable directory convention.
    return { kind: name.endsWith("/") ? "directory" : "file", unixMode: null };
}
function locateEocd(fd, fileSize) {
    if (fileSize < EOCD_MIN_SIZE)
        throw new ZipFormatError("file is too small to be a ZIP archive");
    const searchLength = Math.min(fileSize, MAX_EOCD_SEARCH);
    const searchStart = fileSize - searchLength;
    const tail = readExact(fd, searchLength, searchStart);
    let eocdOffset = -1;
    for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i--) {
        if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset < 0)
        throw new ZipFormatError("end-of-central-directory record not found");
    let entryCount = tail.readUInt16LE(eocdOffset + 10);
    let centralDirectorySize = tail.readUInt32LE(eocdOffset + 12);
    let centralDirectoryOffset = tail.readUInt32LE(eocdOffset + 16);
    let zip64 = false;
    const needsZip64 = entryCount === U16_MAX || centralDirectorySize === U32_MAX || centralDirectoryOffset === U32_MAX;
    const locatorOffset = eocdOffset - ZIP64_LOCATOR_SIZE;
    if (needsZip64 && locatorOffset >= 0 && tail.readUInt32LE(locatorOffset) === ZIP64_LOCATOR_SIGNATURE) {
        const recordOffset = readSafeUInt64LE(tail, locatorOffset + 8, "zip64 end-of-central-directory offset");
        const record = readExact(fd, 56, recordOffset);
        if (record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) {
            throw new ZipFormatError("zip64 end-of-central-directory record signature is invalid");
        }
        entryCount = readSafeUInt64LE(record, 32, "zip64 entry count");
        centralDirectorySize = readSafeUInt64LE(record, 40, "zip64 central-directory size");
        centralDirectoryOffset = readSafeUInt64LE(record, 48, "zip64 central-directory offset");
        zip64 = true;
    }
    if (centralDirectoryOffset + centralDirectorySize > fileSize) {
        throw new ZipFormatError("central directory extends past the end of the archive");
    }
    return { centralDirectoryOffset, centralDirectorySize, entryCount, zip64 };
}
/** Apply the Zip64 extended-information extra field to the placeholder sizes. */
function applyZip64Extra(extra, entry) {
    let cursor = 0;
    while (cursor + 4 <= extra.length) {
        const headerId = extra.readUInt16LE(cursor);
        const dataSize = extra.readUInt16LE(cursor + 2);
        const dataStart = cursor + 4;
        if (dataStart + dataSize > extra.length)
            break;
        if (headerId === ZIP64_EXTRA_ID) {
            let field = dataStart;
            // Fields appear only for the values that were stored as placeholders, in this order.
            if (entry.uncompressedSize === U32_MAX && field + 8 <= dataStart + dataSize) {
                entry.uncompressedSize = readSafeUInt64LE(extra, field, "zip64 uncompressed size");
                field += 8;
            }
            if (entry.compressedSize === U32_MAX && field + 8 <= dataStart + dataSize) {
                entry.compressedSize = readSafeUInt64LE(extra, field, "zip64 compressed size");
                field += 8;
            }
            if (entry.localHeaderOffset === U32_MAX && field + 8 <= dataStart + dataSize) {
                entry.localHeaderOffset = readSafeUInt64LE(extra, field, "zip64 local header offset");
                field += 8;
            }
            break;
        }
        cursor = dataStart + dataSize;
    }
}
/**
 * Read an archive's central directory.
 *
 * The central directory — not the local headers — is the authority for what an
 * archive claims to contain, so preflight can run over the complete member list
 * before any extraction begins.
 */
function readZipCentralDirectory(archivePath) {
    const fd = fs.openSync(archivePath, "r");
    try {
        const fileSize = fs.fstatSync(fd).size;
        const eocd = locateEocd(fd, fileSize);
        const central = readExact(fd, eocd.centralDirectorySize, eocd.centralDirectoryOffset);
        const entries = [];
        let cursor = 0;
        let index = 0;
        while (cursor + CENTRAL_FIXED_SIZE <= central.length) {
            if (central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
                throw new ZipFormatError(`central-directory header signature is invalid at offset ${cursor}`);
            }
            const versionMadeBy = central.readUInt16LE(cursor + 4);
            const generalPurposeFlags = central.readUInt16LE(cursor + 8);
            const compressionMethod = central.readUInt16LE(cursor + 10);
            const crc32 = central.readUInt32LE(cursor + 16);
            const nameLength = central.readUInt16LE(cursor + 28);
            const extraLength = central.readUInt16LE(cursor + 30);
            const commentLength = central.readUInt16LE(cursor + 32);
            const externalAttributes = central.readUInt32LE(cursor + 38);
            const sizes = {
                compressedSize: central.readUInt32LE(cursor + 20),
                uncompressedSize: central.readUInt32LE(cursor + 24),
                localHeaderOffset: central.readUInt32LE(cursor + 42),
            };
            const nameStart = cursor + CENTRAL_FIXED_SIZE;
            const extraStart = nameStart + nameLength;
            const commentStart = extraStart + extraLength;
            const next = commentStart + commentLength;
            if (next > central.length)
                throw new ZipFormatError("central-directory entry runs past the directory");
            applyZip64Extra(central.subarray(extraStart, commentStart), sizes);
            const rawName = central.subarray(nameStart, extraStart);
            const decoded = decodeMemberName(rawName, generalPurposeFlags);
            const classified = entryKindFor(versionMadeBy, externalAttributes, decoded.name);
            entries.push({
                name: decoded.name,
                nameEncodingSuspect: decoded.suspect,
                compressionMethod,
                generalPurposeFlags,
                crc32,
                compressedSize: sizes.compressedSize,
                uncompressedSize: sizes.uncompressedSize,
                localHeaderOffset: sizes.localHeaderOffset,
                externalAttributes,
                versionMadeBy,
                kind: classified.kind,
                encrypted: (generalPurposeFlags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0,
                unixMode: classified.unixMode,
                index,
            });
            index++;
            cursor = next;
        }
        return { entries, declaredEntryCount: eocd.entryCount, zip64: eocd.zip64 };
    }
    finally {
        fs.closeSync(fd);
    }
}
// ───────────────────────────── CRC-32 ─────────────────────────────
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();
/** Incremental CRC-32, matching the checksum a ZIP central directory records. */
class Crc32 {
    constructor() {
        this.state = 0xffffffff;
    }
    update(chunk) {
        let crc = this.state;
        for (let i = 0; i < chunk.length; i++)
            crc = CRC_TABLE[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
        this.state = crc;
    }
    digest() {
        return (this.state ^ 0xffffffff) >>> 0;
    }
}
exports.Crc32 = Crc32;
class ZipBudgetExceededError extends Error {
    constructor(message) {
        super(message);
        this.name = "ZipBudgetExceededError";
    }
}
exports.ZipBudgetExceededError = ZipBudgetExceededError;
/**
 * Read one member and hand its bytes to `sink` in chunks.
 *
 * `maxUncompressedBytes` is enforced by the decompressor itself, not by trusting
 * the central directory: a member that understates its uncompressed size still
 * cannot produce more than the ceiling, because zlib aborts at the limit and the
 * sink never sees the excess. That is the runtime accounting a declared-size
 * check alone cannot provide.
 *
 * Stored members are read incrementally, so an uncompressed archive of any size
 * costs one chunk of memory. Deflated members are bounded by the same ceiling,
 * which the caller derives from the archive policy rather than from the archive.
 */
function streamZipMember(archivePath, entry, limits, sink) {
    if (entry.compressionMethod !== exports.COMPRESSION_STORED && entry.compressionMethod !== exports.COMPRESSION_DEFLATE) {
        throw new ZipFormatError(`unsupported compression method ${entry.compressionMethod} for ${entry.name}`);
    }
    const fd = fs.openSync(archivePath, "r");
    try {
        const header = readExact(fd, LOCAL_FIXED_SIZE, entry.localHeaderOffset);
        if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
            throw new ZipFormatError(`local header signature is invalid for ${entry.name}`);
        }
        const nameLength = header.readUInt16LE(26);
        const extraLength = header.readUInt16LE(28);
        const dataStart = entry.localHeaderOffset + LOCAL_FIXED_SIZE + nameLength + extraLength;
        const crc = new Crc32();
        let produced = 0;
        const emit = (chunk) => {
            produced += chunk.length;
            if (produced > limits.maxUncompressedBytes) {
                throw new ZipBudgetExceededError(`member ${entry.name} exceeded the ${limits.maxUncompressedBytes}-byte extraction ceiling`);
            }
            crc.update(chunk);
            sink(chunk);
        };
        const chunkBytes = Math.max(1, limits.chunkBytes ?? 64 * 1024);
        if (entry.compressionMethod === exports.COMPRESSION_STORED) {
            const readBuffer = Buffer.alloc(chunkBytes);
            let remaining = entry.compressedSize;
            let position = dataStart;
            while (remaining > 0) {
                const want = Math.min(readBuffer.length, remaining);
                const count = fs.readSync(fd, readBuffer, 0, want, position);
                if (count === 0)
                    throw new ZipFormatError(`unexpected end of stored member ${entry.name}`);
                emit(Buffer.from(readBuffer.subarray(0, count)));
                position += count;
                remaining -= count;
            }
        }
        else {
            const compressed = readExact(fd, entry.compressedSize, dataStart);
            let inflated;
            try {
                inflated = zlib.inflateRawSync(compressed, { maxOutputLength: limits.maxUncompressedBytes });
            }
            catch (error) {
                const code = error.code;
                if (code === "ERR_BUFFER_TOO_LARGE") {
                    throw new ZipBudgetExceededError(`member ${entry.name} exceeded the ${limits.maxUncompressedBytes}-byte extraction ceiling`);
                }
                throw new ZipFormatError(`member ${entry.name} could not be decompressed: ${error instanceof Error ? error.message : String(error)}`);
            }
            for (let offset = 0; offset < inflated.length; offset += chunkBytes) {
                emit(inflated.subarray(offset, Math.min(offset + chunkBytes, inflated.length)));
            }
        }
        return { bytesWritten: produced, crc32: crc.digest() };
    }
    finally {
        fs.closeSync(fd);
    }
}
//# sourceMappingURL=zip_reader.js.map