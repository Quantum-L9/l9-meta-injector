"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTarArchive = readTarArchive;
exports.peekTarRootMeta = peekTarRootMeta;
exports.rootMetaKind = rootMetaKind;
// tar_reader.ts — bounded ustar reader for inventory harvest and rewrite admit (ADR-049).
// Observation expansion does not use this module (ADR-036 / ADR-046).
const tar_format_1 = require("./tar_format");
const REGULAR = new Set(["0", "\0", ""]);
const DIRECTORY = new Set(["5"]);
const HOSTILE_TYPES = new Set(["1", "2", "3", "4", "6", "7", "L", "K", "x", "g", "S"]);
function readName(header) {
    const raw = header.subarray(0, 100);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
}
function readTarArchive(bytes) {
    if (bytes.length < tar_format_1.TAR_BLOCK_SIZE * 2)
        return { ok: false, hold: "archive.tar_truncated" };
    const members = [];
    let offset = 0;
    let trailingZero = 0;
    while (offset + tar_format_1.TAR_BLOCK_SIZE <= bytes.length) {
        const header = bytes.subarray(offset, offset + tar_format_1.TAR_BLOCK_SIZE);
        if (header.every((b) => b === 0)) {
            trailingZero += 1;
            offset += tar_format_1.TAR_BLOCK_SIZE;
            if (trailingZero >= 2) {
                if (offset < bytes.length && bytes.subarray(offset).some((b) => b !== 0)) {
                    return { ok: false, hold: "archive.tar_trailing_bytes" };
                }
                return { ok: true, members };
            }
            continue;
        }
        if (trailingZero > 0)
            return { ok: false, hold: "archive.tar_concatenated" };
        const stored = (0, tar_format_1.parseOctalField)(header.subarray(148, 156));
        if (!Number.isFinite(stored) || stored !== (0, tar_format_1.tarChecksum)(header)) {
            return { ok: false, hold: "archive.tar_bad_checksum" };
        }
        const size = (0, tar_format_1.parseOctalField)(header.subarray(124, 136));
        if (!Number.isFinite(size) || size < 0)
            return { ok: false, hold: "archive.tar_size_invalid" };
        const padded = Math.ceil(size / tar_format_1.TAR_BLOCK_SIZE) * tar_format_1.TAR_BLOCK_SIZE;
        if (offset + tar_format_1.TAR_BLOCK_SIZE + padded > bytes.length)
            return { ok: false, hold: "archive.tar_truncated" };
        const type = String.fromCharCode(header[156] ?? 0);
        if (HOSTILE_TYPES.has(type))
            return { ok: false, hold: `archive.tar_type_${type === "S" ? "sparse" : type}` };
        if (!REGULAR.has(type) && !DIRECTORY.has(type))
            return { ok: false, hold: "archive.entry_kind_unknown" };
        const content = bytes.subarray(offset + tar_format_1.TAR_BLOCK_SIZE, offset + tar_format_1.TAR_BLOCK_SIZE + size);
        const rawRecord = bytes.subarray(offset, offset + tar_format_1.TAR_BLOCK_SIZE + padded);
        members.push({ name: readName(header), type, size, content: Buffer.from(content), rawRecord: Buffer.from(rawRecord) });
        offset += tar_format_1.TAR_BLOCK_SIZE + padded;
    }
    return { ok: false, hold: "archive.tar_truncated" };
}
function peekTarRootMeta(bytes) {
    const read = readTarArchive(bytes);
    if (!read.ok)
        return null;
    const canonical = read.members.find((m) => rootMetaKind(m.name) === "canonical");
    if (canonical)
        return canonical.content;
    const legacy = read.members.find((m) => rootMetaKind(m.name) === "legacy");
    return legacy ? legacy.content : null;
}
function rootMetaKind(name) {
    const normalized = name.replace(/\\/g, "/").replace(/^\.\//, "");
    if (normalized === ".l9meta.yaml")
        return "canonical";
    if (normalized === "l9meta.yaml")
        return "legacy";
    return null;
}
//# sourceMappingURL=tar_reader.js.map