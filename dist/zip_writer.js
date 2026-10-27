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
exports.rootMetaKind = rootMetaKind;
exports.holdZipRewrite = holdZipRewrite;
exports.buildZipBuffer = buildZipBuffer;
exports.injectZipRootMeta = injectZipRootMeta;
exports.peekZipRootMeta = peekZipRootMeta;
// zip_writer.ts — inventory-only ZIP rewrite: copy member blobs, upsert root .l9meta.yaml (ADR-049).
// Observation still uses zip_reader only. This module must not become a second engine.
const fs = __importStar(require("node:fs"));
const archive_preflight_1 = require("./archive_preflight");
const zip_reader_1 = require("./zip_reader");
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const LOCAL_FIXED = 30;
const CENTRAL_FIXED = 46;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const FLAG_UTF8_NAME = 0x0800;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const CENTRAL_LOCAL_OFFSET_FIELD = 42;
/** Root-meta identity is the admission identity (archive_preflight owns the rule). */
function rootMetaKind(name) {
    return (0, archive_preflight_1.rootMetaMemberKind)(name);
}
/**
 * Why a rewrite must not run, or null.
 *
 * With `centralRecordOf`, kept members' original central records are also checked:
 * a record whose local-header offset field is the Zip64 placeholder keeps the real
 * offset in its Zip64 extra, which patching the fixed field cannot relocate, so it
 * holds as Zip64 (ADR-049: Zip64 archives hold until a writer can emit Zip64).
 */
function holdZipRewrite(directory, centralRecordOf) {
    if (directory.zip64)
        return "archive.zip64";
    for (const entry of directory.entries) {
        if (entry.encrypted)
            return "archive.member_encrypted";
        if (entry.compressedSize > U32_MAX || entry.uncompressedSize > U32_MAX || entry.localHeaderOffset > U32_MAX) {
            return "archive.zip64";
        }
    }
    if (centralRecordOf) {
        for (const entry of directory.entries) {
            if (rootMetaKind(entry.name) !== null)
                continue;
            if (centralRecordOf(entry).readUInt32LE(CENTRAL_LOCAL_OFFSET_FIELD) === U32_MAX)
                return "archive.zip64";
        }
    }
    return null;
}
function readExact(fd, length, position) {
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
        const count = fs.readSync(fd, buffer, read, length - read, position + read);
        if (count === 0)
            throw new zip_reader_1.ZipFormatError(`unexpected end of archive at offset ${position + read}`);
        read += count;
    }
    return buffer;
}
function copyLocalRecord(fd, entry) {
    const header = readExact(fd, LOCAL_FIXED, entry.localHeaderOffset);
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
        throw new zip_reader_1.ZipFormatError(`local header signature is invalid for ${entry.name}`);
    }
    const nameLen = header.readUInt16LE(26);
    const extraLen = header.readUInt16LE(28);
    let total = LOCAL_FIXED + nameLen + extraLen + entry.compressedSize;
    if ((entry.generalPurposeFlags & FLAG_DATA_DESCRIPTOR) !== 0) {
        const peek = readExact(fd, 4, entry.localHeaderOffset + total);
        total += peek.readUInt32LE(0) === DATA_DESCRIPTOR_SIGNATURE ? 16 : 12;
    }
    return readExact(fd, total, entry.localHeaderOffset);
}
/** A kept member's original central-directory record, verbatim. */
function readCentralRecord(fd, entry) {
    const offset = entry.centralRecordOffset;
    const length = entry.centralRecordLength;
    if (offset === undefined || length === undefined || length < CENTRAL_FIXED) {
        throw new zip_reader_1.ZipFormatError(`central record extent is unknown for ${entry.name}`);
    }
    const record = readExact(fd, length, offset);
    if (record.readUInt32LE(0) !== CENTRAL_SIGNATURE) {
        throw new zip_reader_1.ZipFormatError(`central-directory header signature is invalid for ${entry.name}`);
    }
    const declared = CENTRAL_FIXED + record.readUInt16LE(28) + record.readUInt16LE(30) + record.readUInt16LE(32);
    if (declared !== length) {
        throw new zip_reader_1.ZipFormatError(`central record length disagrees with its fields for ${entry.name}`);
    }
    return record;
}
/** The original record with only the relative-offset-of-local-header field moved. */
function relocateCentralRecord(record, localHeaderOffset) {
    if (localHeaderOffset > U32_MAX)
        throw new zip_reader_1.ZipFormatError("Zip64 emit is out of scope for inventory writer v1");
    const copy = Buffer.from(record);
    copy.writeUInt32LE(localHeaderOffset, CENTRAL_LOCAL_OFFSET_FIELD);
    return copy;
}
function crc32(data) {
    const crc = new zip_reader_1.Crc32();
    crc.update(data);
    return crc.digest();
}
function writeLocalStored(name, data) {
    const nameBytes = Buffer.from(name, "utf8");
    const header = Buffer.alloc(LOCAL_FIXED);
    header.writeUInt32LE(LOCAL_SIGNATURE, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(FLAG_UTF8_NAME, 6);
    header.writeUInt16LE(zip_reader_1.COMPRESSION_STORED, 8);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    return Buffer.concat([header, nameBytes, data]);
}
function writeCentral(entry) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const header = Buffer.alloc(CENTRAL_FIXED);
    header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    header.writeUInt16LE(entry.versionMadeBy, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(entry.flags, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(entry.modTime, 12);
    header.writeUInt16LE(entry.modDate, 14);
    header.writeUInt32LE(entry.crc32, 16);
    header.writeUInt32LE(entry.compressedSize, 20);
    header.writeUInt32LE(entry.uncompressedSize, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(entry.externalAttributes, 38);
    header.writeUInt32LE(entry.localHeaderOffset, 42);
    return Buffer.concat([header, nameBytes]);
}
function writeEocd(entryCount, centralSize, centralOffset, comment = Buffer.alloc(0)) {
    if (entryCount > U16_MAX || centralSize > U32_MAX || centralOffset > U32_MAX) {
        throw new zip_reader_1.ZipFormatError("Zip64 emit is out of scope for inventory writer v1");
    }
    if (comment.length > U16_MAX)
        throw new zip_reader_1.ZipFormatError("archive comment exceeds 65535 bytes");
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
    eocd.writeUInt16LE(entryCount, 8);
    eocd.writeUInt16LE(entryCount, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralOffset, 16);
    eocd.writeUInt16LE(comment.length, 20);
    return Buffer.concat([eocd, comment]);
}
/** Convert a JS Date to DOS file time (2-second resolution, 1980-2107 range). */
function dosTimeNow() {
    const d = new Date();
    const modTime = ((d.getSeconds() >> 1) & 0x1f) | ((d.getMinutes() & 0x3f) << 5) | ((d.getHours() & 0x1f) << 11);
    const modDate = (d.getDate() & 0x1f) | (((d.getMonth() + 1) & 0x0f) << 5) | (((d.getFullYear() - 1980) & 0x7f) << 9);
    return { modTime, modDate };
}
function buildZipBuffer(members) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const member of members) {
        const local = writeLocalStored(member.name, member.data);
        locals.push(local);
        centrals.push(writeCentral({
            name: member.name,
            flags: FLAG_UTF8_NAME,
            method: zip_reader_1.COMPRESSION_STORED,
            crc32: crc32(member.data),
            compressedSize: member.data.length,
            uncompressedSize: member.data.length,
            localHeaderOffset: offset,
            externalAttributes: (0o100644 << 16) >>> 0,
            versionMadeBy: (3 << 8),
            ...dosTimeNow(),
        }));
        offset += local.length;
    }
    const central = Buffer.concat(centrals);
    return Buffer.concat([...locals, central, writeEocd(members.length, central.length, offset)]);
}
function injectZipRootMeta(archivePath, yaml) {
    let directory;
    try {
        directory = (0, zip_reader_1.readZipCentralDirectory)(archivePath);
    }
    catch (err) {
        return { ok: false, hold: `archive.format_unreadable:${err.message}` };
    }
    const directoryHold = holdZipRewrite(directory);
    if (directoryHold)
        return { ok: false, hold: directoryHold };
    const yamlBytes = Buffer.from(yaml, "utf8");
    const locals = [];
    const centrals = [];
    let archiveComment;
    let offset = 0;
    let fd;
    try {
        fd = fs.openSync(archivePath, "r");
    }
    catch (err) {
        return { ok: false, hold: `archive.zip_copy_failed:${err.message}` };
    }
    try {
        // Kept members' central records are copied verbatim (name bytes, extra fields,
        // comments, attributes, version-needed); only the local-header offset moves.
        const records = new Map();
        const centralRecordOf = (entry) => {
            let record = records.get(entry);
            if (!record) {
                record = readCentralRecord(fd, entry);
                records.set(entry, record);
            }
            return record;
        };
        const recordHold = holdZipRewrite(directory, centralRecordOf);
        if (recordHold)
            return { ok: false, hold: recordHold };
        for (const entry of directory.entries) {
            if (rootMetaKind(entry.name) !== null)
                continue;
            const blob = copyLocalRecord(fd, entry);
            locals.push(blob);
            centrals.push(relocateCentralRecord(centralRecordOf(entry), offset));
            offset += blob.length;
        }
        const commentLength = directory.eocdCommentLength ?? 0;
        archiveComment = commentLength > 0 && directory.eocdCommentOffset !== undefined
            ? readExact(fd, commentLength, directory.eocdCommentOffset)
            : Buffer.alloc(0);
    }
    catch (err) {
        return { ok: false, hold: `archive.zip_copy_failed:${err.message}` };
    }
    finally {
        fs.closeSync(fd);
    }
    const metaLocal = writeLocalStored(".l9meta.yaml", yamlBytes);
    locals.push(metaLocal);
    centrals.push(writeCentral({
        name: ".l9meta.yaml",
        flags: FLAG_UTF8_NAME,
        method: zip_reader_1.COMPRESSION_STORED,
        crc32: crc32(yamlBytes),
        compressedSize: yamlBytes.length,
        uncompressedSize: yamlBytes.length,
        localHeaderOffset: offset,
        externalAttributes: (0o100644 << 16) >>> 0,
        versionMadeBy: (3 << 8),
        ...dosTimeNow(),
    }));
    offset += metaLocal.length;
    const central = Buffer.concat(centrals);
    try {
        return {
            ok: true,
            bytes: Buffer.concat([...locals, central, writeEocd(centrals.length, central.length, offset, archiveComment)]),
        };
    }
    catch (err) {
        return { ok: false, hold: `archive.zip_write_failed:${err.message}` };
    }
}
function peekZipRootMeta(archivePath) {
    let directory;
    try {
        directory = (0, zip_reader_1.readZipCentralDirectory)(archivePath);
    }
    catch {
        return null;
    }
    const entry = directory.entries.find((e) => rootMetaKind(e.name) === "canonical")
        ?? directory.entries.find((e) => rootMetaKind(e.name) === "legacy");
    if (!entry)
        return null;
    if (entry.encrypted)
        return null;
    if (entry.compressionMethod !== zip_reader_1.COMPRESSION_STORED && entry.compressionMethod !== zip_reader_1.COMPRESSION_DEFLATE)
        return null;
    const chunks = [];
    try {
        (0, zip_reader_1.streamZipMember)(archivePath, entry, { maxUncompressedBytes: 256 * 1024 }, (chunk) => {
            chunks.push(chunk);
        });
    }
    catch {
        return null;
    }
    return Buffer.concat(chunks).toString("utf8");
}
//# sourceMappingURL=zip_writer.js.map