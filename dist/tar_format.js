"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAR_BLOCK_SIZE = void 0;
exports.encodeTarEntry = encodeTarEntry;
exports.encodeTarArchive = encodeTarArchive;
exports.parseOctalField = parseOctalField;
exports.tarChecksum = tarChecksum;
// tar_format.ts — ustar header encoding for inventory TAR rewrite (ADR-049).
//
// Encoding is lifted from tests/helpers/tar_fixtures.ts. That helper stays a
// hostile-shape factory; this module is the production writer grammar.
const BLOCK = 512;
function octal(value, width) {
    return value.toString(8).padStart(width - 1, "0") + "\0";
}
function padToBlock(data) {
    const padding = (BLOCK - (data.length % BLOCK)) % BLOCK;
    return padding === 0 ? data : Buffer.concat([data, Buffer.alloc(padding)]);
}
/** One 512-byte ustar header plus padded data blocks. */
function encodeTarEntry(spec) {
    const data = Buffer.isBuffer(spec.content) ? spec.content : Buffer.from(spec.content ?? "", "utf8");
    const header = Buffer.alloc(BLOCK);
    header.write(spec.name, 0, 100, "utf8");
    header.write(octal(spec.mode ?? 0o644, 8), 100);
    header.write(octal(spec.uid ?? 0, 8), 108);
    header.write(octal(spec.gid ?? 0, 8), 116);
    header.write(octal(spec.declaredSize ?? data.length, 12), 124);
    header.write(octal(spec.mtime ?? 0, 12), 136);
    header.write("        ", 148);
    header.write(spec.type ?? "0", 156);
    if (spec.linkName !== undefined)
        header.write(spec.linkName, 157, 100, "utf8");
    header.write("ustar\0", 257);
    header.write("00", 263);
    let sum = 0;
    for (const byte of header)
        sum += byte;
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    return Buffer.concat([header, padToBlock(data)]);
}
/** A complete tar stream: entries followed by two zero blocks. */
function encodeTarArchive(entries) {
    return Buffer.concat([...entries.map(encodeTarEntry), Buffer.alloc(BLOCK * 2)]);
}
function parseOctalField(raw) {
    const text = raw.toString("utf8").replace(/\0/g, " ").trim();
    if (text === "")
        return 0;
    const value = Number.parseInt(text, 8);
    return Number.isFinite(value) ? value : Number.NaN;
}
function tarChecksum(header) {
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) {
        sum += i >= 148 && i < 156 ? 0x20 : header[i];
    }
    return sum;
}
exports.TAR_BLOCK_SIZE = BLOCK;
//# sourceMappingURL=tar_format.js.map