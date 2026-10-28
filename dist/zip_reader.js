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
exports.ZipBudgetExceededError = exports.Crc32 = exports.ZipSizeMismatchError = exports.ZipFormatError = exports.COMPRESSION_DEFLATE = exports.COMPRESSION_STORED = void 0;
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
// so this adds no dependency. Stored members stream a chunk at a time; deflated
// members are inflated synchronously and held whole, bounded by the extraction
// ceiling rather than by streaming. See `streamZipMember` for that contract. Zip64 central-directory records are understood so a
// large archive is read correctly rather than silently truncated.
//
// Declared sizes are claims, not facts (ADR-061). Every member's declared data
// extent must fit inside the archive before the central directory, so no
// attacker-chosen length ever becomes an allocation; and the bytes a member
// produces must equal its declared uncompressed size, so the preflight rules
// judged on declared sizes bound the bytes actually produced.
const node_buffer_1 = require("node:buffer");
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
/**
 * A member produced more or fewer bytes than its central directory declares.
 *
 * A subclass of `ZipFormatError`, so every classifier that already holds a
 * format error holds this fail-closed; classifiers that distinguish integrity
 * failures (a CRC mismatch) refine it to their integrity code (ADR-061).
 */
class ZipSizeMismatchError extends ZipFormatError {
    constructor(message) {
        super(message);
        this.name = "ZipSizeMismatchError";
    }
}
exports.ZipSizeMismatchError = ZipSizeMismatchError;
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
    const byName = name.endsWith("/") ? "directory" : "file";
    if (host === HOST_UNIX) {
        const mode = (externalAttributes >>> 16) & 0xffff;
        // A mode with permission bits but no S_IFMT type bits declares no type (CPython
        // `zipfile.writestr` records 0o600): the name decides, exactly as on a non-Unix
        // host, and the recorded mode is still reported.
        if (mode !== 0 && (mode & S_IFMT) === 0)
            return { kind: byName, unixMode: mode };
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
    return { kind: byName, unixMode: null };
}
/**
 * Find the real EOCD record, not merely the last signature-shaped bytes.
 *
 * ZIP comments are arbitrary bytes and may legally contain PK\x05\x06. A candidate
 * is therefore considered only when its own declared comment length terminates
 * exactly at physical EOF. Invalid later candidates are skipped so a legal
 * signature inside a comment cannot shadow the real record.
 */
function findEocdOffset(tail, searchStart, fileSize) {
    for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i--) {
        if (tail.readUInt32LE(i) !== EOCD_SIGNATURE)
            continue;
        const commentLength = tail.readUInt16LE(i + 20);
        const recordEnd = searchStart + i + EOCD_MIN_SIZE + commentLength;
        if (recordEnd === fileSize)
            return i;
    }
    throw new ZipFormatError("end-of-central-directory record not found or its comment does not reach the end of the archive");
}
/** Read and fully frame the Zip64 EOCD record addressed by its locator. */
function readZip64Eocd(fd, tail, locatorOffset, locatorAbsoluteOffset) {
    const locatorDisk = tail.readUInt32LE(locatorOffset + 4);
    const totalDisks = tail.readUInt32LE(locatorOffset + 16);
    if (locatorDisk !== 0 || totalDisks !== 1) {
        throw new ZipFormatError("multi-disk (split) ZIP archives are not supported");
    }
    const recordOffset = readSafeUInt64LE(tail, locatorOffset + 8, "zip64 end-of-central-directory offset");
    const prefix = readExact(fd, 12, recordOffset);
    if (prefix.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) {
        throw new ZipFormatError("zip64 end-of-central-directory record signature is invalid");
    }
    const payloadSize = readSafeUInt64LE(prefix, 4, "zip64 end-of-central-directory size");
    if (payloadSize < 44)
        throw new ZipFormatError("zip64 end-of-central-directory record is truncated");
    const totalRecordSize = 12 + payloadSize;
    if (recordOffset + totalRecordSize !== locatorAbsoluteOffset) {
        throw new ZipFormatError("zip64 end-of-central-directory record does not terminate at its locator");
    }
    const record = readExact(fd, totalRecordSize, recordOffset);
    const diskNumber = record.readUInt32LE(16);
    const centralDirectoryDisk = record.readUInt32LE(20);
    const entriesOnDisk = readSafeUInt64LE(record, 24, "zip64 entries on disk");
    const entryCount = readSafeUInt64LE(record, 32, "zip64 entry count");
    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
        throw new ZipFormatError("multi-disk (split) ZIP archives are not supported");
    }
    return {
        entryCount,
        centralDirectorySize: readSafeUInt64LE(record, 40, "zip64 central-directory size"),
        centralDirectoryOffset: readSafeUInt64LE(record, 48, "zip64 central-directory offset"),
        zip64: true,
    };
}
function locateEocd(fd, fileSize) {
    if (fileSize < EOCD_MIN_SIZE)
        throw new ZipFormatError("file is too small to be a ZIP archive");
    const searchLength = Math.min(fileSize, MAX_EOCD_SEARCH);
    const searchStart = fileSize - searchLength;
    const tail = readExact(fd, searchLength, searchStart);
    const eocdOffset = findEocdOffset(tail, searchStart, fileSize);
    const eocdAbsoluteOffset = searchStart + eocdOffset;
    const classic = {
        entryCount: tail.readUInt16LE(eocdOffset + 10),
        centralDirectorySize: tail.readUInt32LE(eocdOffset + 12),
        centralDirectoryOffset: tail.readUInt32LE(eocdOffset + 16),
        zip64: false,
    };
    const diskNumber = tail.readUInt16LE(eocdOffset + 4);
    const centralDirectoryDisk = tail.readUInt16LE(eocdOffset + 6);
    const entriesOnDisk = tail.readUInt16LE(eocdOffset + 8);
    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== classic.entryCount) {
        throw new ZipFormatError("multi-disk (split) ZIP archives are not supported");
    }
    const needsZip64 = classic.entryCount === U16_MAX
        || classic.centralDirectorySize === U32_MAX
        || classic.centralDirectoryOffset === U32_MAX;
    const locatorOffset = eocdOffset - ZIP64_LOCATOR_SIZE;
    const hasLocator = locatorOffset >= 0 && tail.readUInt32LE(locatorOffset) === ZIP64_LOCATOR_SIGNATURE;
    if (needsZip64 && !hasLocator) {
        throw new ZipFormatError("zip64 archive is missing its end-of-central-directory locator");
    }
    const resolved = needsZip64
        ? readZip64Eocd(fd, tail, locatorOffset, searchStart + locatorOffset)
        : classic;
    const centralEnd = resolved.centralDirectoryOffset + resolved.centralDirectorySize;
    if (centralEnd > fileSize) {
        throw new ZipFormatError("central directory extends past the end of the archive");
    }
    if (resolved.zip64) {
        const zip64RecordOffset = readSafeUInt64LE(tail, locatorOffset + 8, "zip64 end-of-central-directory offset");
        if (centralEnd !== zip64RecordOffset) {
            throw new ZipFormatError("central directory does not terminate at the zip64 end record");
        }
    }
    else if (centralEnd !== eocdAbsoluteOffset) {
        throw new ZipFormatError("central directory does not terminate at the end-of-central-directory record");
    }
    return {
        ...resolved,
        commentOffset: eocdAbsoluteOffset + EOCD_MIN_SIZE,
        commentLength: tail.readUInt16LE(eocdOffset + 20),
    };
}
/** Locate the Zip64 extended-information field's payload inside an extra-field blob. */
function findZip64ExtraPayload(extra) {
    let cursor = 0;
    while (cursor + 4 <= extra.length) {
        const headerId = extra.readUInt16LE(cursor);
        const dataSize = extra.readUInt16LE(cursor + 2);
        const dataStart = cursor + 4;
        if (dataStart + dataSize > extra.length)
            return null;
        if (headerId === ZIP64_EXTRA_ID)
            return extra.subarray(dataStart, dataStart + dataSize);
        cursor = dataStart + dataSize;
    }
    return null;
}
/** Apply the Zip64 extended-information extra field to placeholder sizes. */
function applyZip64Extra(extra, entry) {
    const payload = findZip64ExtraPayload(extra);
    if (payload === null)
        return;
    let field = 0;
    const nextValue = (label) => {
        if (field + 8 > payload.length)
            return null;
        const value = readSafeUInt64LE(payload, field, label);
        field += 8;
        return value;
    };
    if (entry.uncompressedSize === U32_MAX) {
        entry.uncompressedSize = nextValue("zip64 uncompressed size") ?? entry.uncompressedSize;
    }
    if (entry.compressedSize === U32_MAX) {
        entry.compressedSize = nextValue("zip64 compressed size") ?? entry.compressedSize;
    }
    if (entry.localHeaderOffset === U32_MAX) {
        entry.localHeaderOffset = nextValue("zip64 local header offset") ?? entry.localHeaderOffset;
    }
}
/** Parse one central-directory header at `cursor`, or throw if it is malformed. */
function readCentralEntry(central, cursor, index, centralDirectoryOffset) {
    if (central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
        throw new ZipFormatError(`central-directory header signature is invalid at offset ${cursor}`);
    }
    const versionMadeBy = central.readUInt16LE(cursor + 4);
    const generalPurposeFlags = central.readUInt16LE(cursor + 8);
    const nameLength = central.readUInt16LE(cursor + 28);
    const extraLength = central.readUInt16LE(cursor + 30);
    const commentLength = central.readUInt16LE(cursor + 32);
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
    const decoded = decodeMemberName(central.subarray(nameStart, extraStart), generalPurposeFlags);
    const externalAttributes = central.readUInt32LE(cursor + 38);
    const classified = entryKindFor(versionMadeBy, externalAttributes, decoded.name);
    return {
        entry: {
            name: decoded.name,
            nameEncodingSuspect: decoded.suspect,
            compressionMethod: central.readUInt16LE(cursor + 10),
            generalPurposeFlags,
            crc32: central.readUInt32LE(cursor + 16),
            compressedSize: sizes.compressedSize,
            uncompressedSize: sizes.uncompressedSize,
            localHeaderOffset: sizes.localHeaderOffset,
            externalAttributes,
            versionMadeBy,
            kind: classified.kind,
            encrypted: (generalPurposeFlags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0,
            unixMode: classified.unixMode,
            index,
            modTime: central.readUInt16LE(cursor + 12),
            modDate: central.readUInt16LE(cursor + 14),
            centralRecordOffset: centralDirectoryOffset + cursor,
            centralRecordLength: next - cursor,
        },
        next,
    };
}
/**
 * Refuse any entry whose declared data extent does not fit before the central
 * directory.
 *
 * The local header's own name and extra lengths are read (bytes 26..29) so the
 * bound is exact: an honest last member ends exactly at the central directory.
 * Checked here, at directory read, so every consumer -- extraction, the
 * inventory writer, the OOXML decoder -- is protected before any allocation
 * sized by `compressedSize`.
 */
function assertDataExtentsPrecedeCentralDirectory(fd, entries, centralDirectoryOffset) {
    const refuse = (entry) => new ZipFormatError(`member ${entry.name} declares a data extent that extends past the start of the central directory ` +
        `(local header offset ${entry.localHeaderOffset}, compressed size ${entry.compressedSize}, ` +
        `uncompressed size ${entry.uncompressedSize}, central directory at ${centralDirectoryOffset})`);
    for (const entry of entries) {
        // The fixed header alone already overruns: refuse without reading at an
        // offset the archive cannot contain.
        if (entry.localHeaderOffset + LOCAL_FIXED_SIZE + entry.compressedSize > centralDirectoryOffset) {
            throw refuse(entry);
        }
        const header = readExact(fd, LOCAL_FIXED_SIZE, entry.localHeaderOffset);
        const dataStart = entry.localHeaderOffset + LOCAL_FIXED_SIZE + header.readUInt16LE(26) + header.readUInt16LE(28);
        if (dataStart + entry.compressedSize > centralDirectoryOffset)
            throw refuse(entry);
    }
}
/** Read an archive's central directory. */
function readZipCentralDirectory(archivePath) {
    const fd = fs.openSync(archivePath, "r");
    try {
        const eocd = locateEocd(fd, fs.fstatSync(fd).size);
        const central = readExact(fd, eocd.centralDirectorySize, eocd.centralDirectoryOffset);
        const entries = [];
        let cursor = 0;
        while (cursor + CENTRAL_FIXED_SIZE <= central.length) {
            const parsed = readCentralEntry(central, cursor, entries.length, eocd.centralDirectoryOffset);
            entries.push(parsed.entry);
            cursor = parsed.next;
        }
        if (entries.length !== eocd.entryCount) {
            throw new ZipFormatError(`central directory declares ${eocd.entryCount} entries but ${entries.length} could be parsed`);
        }
        if (cursor !== central.length) {
            throw new ZipFormatError(`central directory declares ${central.length} bytes but ${cursor} were consumed`);
        }
        assertDataExtentsPrecedeCentralDirectory(fd, entries, eocd.centralDirectoryOffset);
        return {
            entries,
            declaredEntryCount: eocd.entryCount,
            zip64: eocd.zip64,
            eocdCommentOffset: eocd.commentOffset,
            eocdCommentLength: eocd.commentLength,
        };
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
        for (const byte of chunk)
            crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
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
/** Read a stored (uncompressed) member incrementally, one chunk at a time. */
function readStoredMember(fd, entry, dataStart, chunkBytes, emit) {
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
/** The caller's ceiling was reached: a budget refusal, whatever the member declared. */
function ceilingError(entry, maxUncompressedBytes) {
    return new ZipBudgetExceededError(`member ${entry.name} exceeded the ${maxUncompressedBytes}-byte extraction ceiling`);
}
/** The member produced more than it declares while staying inside the caller's ceiling. */
function overDeclaredError(entry) {
    return new ZipSizeMismatchError(`member ${entry.name} produced more than the ${entry.uncompressedSize} bytes its central directory declares`);
}
/**
 * Inflate a deflated member whole, under a ceiling zlib itself enforces.
 *
 * zlib is bounded by the caller's ceiling, not by the declared size, so a member
 * that runs past the ceiling is a budget refusal whatever it declared (the same
 * verdict an honest bomb receives), while one that stays inside the ceiling but
 * produces more than it declares is a size mismatch. Either way nothing beyond
 * the declared size is ever emitted (ADR-061).
 */
function readDeflatedMember(fd, entry, dataStart, chunkBytes, maxUncompressedBytes, emit) {
    const compressed = readExact(fd, entry.compressedSize, dataStart);
    let inflated;
    try {
        // zlib refuses a maxOutputLength above buffer.constants.MAX_LENGTH
        // (ERR_OUT_OF_RANGE) and throws ERR_BUFFER_TOO_LARGE only for output strictly
        // longer than it; the caller has already refused a ceiling below 1.
        inflated = zlib.inflateRawSync(compressed, {
            maxOutputLength: Math.min(maxUncompressedBytes, node_buffer_1.constants.MAX_LENGTH),
        });
    }
    catch (error) {
        if (error.code === "ERR_BUFFER_TOO_LARGE") {
            throw ceilingError(entry, maxUncompressedBytes);
        }
        throw new ZipFormatError(`member ${entry.name} could not be decompressed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (inflated.length > entry.uncompressedSize)
        throw overDeclaredError(entry);
    for (let offset = 0; offset < inflated.length; offset += chunkBytes) {
        emit(inflated.subarray(offset, Math.min(offset + chunkBytes, inflated.length)));
    }
}
/**
 * Offset of a member's data, read from its local header.
 *
 * Also the backstop for an entry handed in directly rather than read by
 * `readZipCentralDirectory`: a data extent that runs past the archive's own size
 * is refused before any read is sized by it.
 */
function memberDataStart(fd, entry) {
    const header = readExact(fd, LOCAL_FIXED_SIZE, entry.localHeaderOffset);
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
        throw new ZipFormatError(`local header signature is invalid for ${entry.name}`);
    }
    const dataStart = entry.localHeaderOffset + LOCAL_FIXED_SIZE + header.readUInt16LE(26) + header.readUInt16LE(28);
    if (dataStart + entry.compressedSize > fs.fstatSync(fd).size) {
        throw new ZipFormatError(`member ${entry.name} declares a data extent past the end of the archive`);
    }
    return dataStart;
}
/** Read one member and hand its bytes to `sink` in chunks. */
function streamZipMember(archivePath, entry, limits, sink) {
    if (entry.compressionMethod !== exports.COMPRESSION_STORED && entry.compressionMethod !== exports.COMPRESSION_DEFLATE) {
        throw new ZipFormatError(`unsupported compression method ${entry.compressionMethod} for ${entry.name}`);
    }
    if (limits.maxUncompressedBytes <= 0) {
        throw new ZipBudgetExceededError(`member ${entry.name} cannot be extracted: the remaining extraction allowance is exhausted`);
    }
    const fd = fs.openSync(archivePath, "r");
    try {
        const dataStart = memberDataStart(fd, entry);
        // Nothing past the declared size, and nothing past the caller's ceiling, ever
        // reaches the sink. A stored member produces exactly its compressed bytes, so
        // which bound it overran is known before the first chunk.
        const limit = Math.min(entry.uncompressedSize, limits.maxUncompressedBytes);
        const crc = new Crc32();
        let produced = 0;
        const emit = (chunk) => {
            produced += chunk.length;
            if (produced > limit) {
                throw produced > limits.maxUncompressedBytes || entry.compressedSize > limits.maxUncompressedBytes
                    ? ceilingError(entry, limits.maxUncompressedBytes)
                    : overDeclaredError(entry);
            }
            crc.update(chunk);
            sink(chunk);
        };
        const chunkBytes = Math.max(1, limits.chunkBytes ?? 64 * 1024);
        if (entry.compressionMethod === exports.COMPRESSION_STORED) {
            readStoredMember(fd, entry, dataStart, chunkBytes, emit);
        }
        else {
            readDeflatedMember(fd, entry, dataStart, chunkBytes, limits.maxUncompressedBytes, emit);
        }
        // Output was never allowed past the declared size; ending short of it is the
        // other half of the same lie.
        if (produced !== entry.uncompressedSize) {
            throw new ZipSizeMismatchError(`member ${entry.name} produced ${produced} bytes but its central directory declares ${entry.uncompressedSize}`);
        }
        return { bytesWritten: produced, crc32: crc.digest() };
    }
    finally {
        fs.closeSync(fd);
    }
}
//# sourceMappingURL=zip_reader.js.map