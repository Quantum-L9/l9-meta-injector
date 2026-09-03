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
exports.ZIP_CONTAINER_DOCUMENT_EXTENSIONS = exports.ARCHIVE_SIGNATURE_PROBE_BYTES = exports.ARCHIVE_EXTENSIONS = exports.KNOWN_UNEXPANDABLE_ARCHIVE_EXTENSIONS = exports.EXPANDABLE_ARCHIVE_EXTENSIONS = void 0;
exports.archiveExtensionOf = archiveExtensionOf;
exports.isExpandableArchivePath = isExpandableArchivePath;
exports.isKnownUnexpandableArchivePath = isKnownUnexpandableArchivePath;
exports.isArchivePath = isArchivePath;
exports.sniffArchiveSignature = sniffArchiveSignature;
exports.signatureContradictsName = signatureContradictsName;
// archive_formats.ts — the one place that says what this package treats as an archive.
//
// Three modules used to carry their own archive-extension lists: the strategy
// resolver's binary set, the inventory classifier's archive set, and the local
// source acquirer's "known but not expanded" set. They disagreed — `.zst`, `.lz4`,
// `.cab` and `.iso` were diagnosed as archives by acquisition and classified as
// `unknown` by the inventory record in the same observation — so the record and
// the diagnostic about it told two different stories. One owner ends that.
//
// Extension and byte signature are deliberately two separate questions. The
// extension decides which reader, if any, may open a file (v1 expands ZIP only;
// every other archive format is hashed, diagnosed and never opened — ADR-036).
// The signature is a bounded prefix read that lets a file whose bytes look like
// an archive be *reported* as one even when its name says otherwise, so that an
// extensionless tarball or a `.txt` that is really a gzip stream receives an
// explicit disposition instead of silently passing as an ordinary binary file.
// A signature never grants expansion: nothing is opened on the strength of it.
const path = __importStar(require("node:path"));
/** Archive extensions the canonical ZIP reader expands (v1: zip only). */
exports.EXPANDABLE_ARCHIVE_EXTENSIONS = new Set([".zip"]);
/**
 * Archive extensions this package recognizes but never opens.
 *
 * Every one of these is classified as an archive, hashed, and reported through
 * `archive.format_not_expanded`. TAR and every compressed tarball spelling sit
 * here: there is no TAR reader in v1, and no external tool is consulted.
 */
exports.KNOWN_UNEXPANDABLE_ARCHIVE_EXTENSIONS = new Set([
    ".tar", ".tgz", ".tbz", ".tbz2", ".txz", ".tzst",
    ".gz", ".bz2", ".xz", ".zst", ".lz4",
    ".7z", ".rar", ".jar", ".war", ".cab", ".iso",
]);
/** Every extension this package classifies as an archive, expandable or not. */
exports.ARCHIVE_EXTENSIONS = new Set([
    ...exports.EXPANDABLE_ARCHIVE_EXTENSIONS,
    ...exports.KNOWN_UNEXPANDABLE_ARCHIVE_EXTENSIONS,
]);
/** Lower-cased extension of a path or member name, as `path.extname` reports it. */
function archiveExtensionOf(name) {
    return path.extname(name).toLowerCase();
}
function isExpandableArchivePath(name) {
    return exports.EXPANDABLE_ARCHIVE_EXTENSIONS.has(archiveExtensionOf(name));
}
function isKnownUnexpandableArchivePath(name) {
    return exports.KNOWN_UNEXPANDABLE_ARCHIVE_EXTENSIONS.has(archiveExtensionOf(name));
}
function isArchivePath(name) {
    return exports.ARCHIVE_EXTENSIONS.has(archiveExtensionOf(name));
}
/** Prefix length the signature probe needs: the ustar magic sits at offset 257. */
exports.ARCHIVE_SIGNATURE_PROBE_BYTES = 512;
const USTAR_OFFSET = 257;
/**
 * Identify an archive container from its leading bytes, or null.
 *
 * Only unambiguous magic is recognized. A pre-POSIX (v7) tar carries no magic
 * at all and is not detected; that is a documented limit, not a guess. ZIP is
 * recognized by its local-header, empty-archive or spanning signature.
 */
function sniffArchiveSignature(prefix) {
    const at = (offset, bytes) => prefix.length >= offset + bytes.length
        && bytes.every((byte, index) => prefix[offset + index] === byte);
    if (at(0, [0x50, 0x4b, 0x03, 0x04]) || at(0, [0x50, 0x4b, 0x05, 0x06]) || at(0, [0x50, 0x4b, 0x07, 0x08]))
        return "zip";
    if (at(0, [0x1f, 0x8b]))
        return "gzip";
    if (at(0, [0x42, 0x5a, 0x68]) && prefix.length > 3 && prefix[3] >= 0x31 && prefix[3] <= 0x39)
        return "bzip2";
    if (at(0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))
        return "xz";
    if (at(0, [0x28, 0xb5, 0x2f, 0xfd]))
        return "zstd";
    if (at(0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
        return "7z";
    if (at(0, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]))
        return "rar";
    // "ustar\0" (POSIX) or "ustar " (GNU) at the magic offset.
    if (at(USTAR_OFFSET, [0x75, 0x73, 0x74, 0x61, 0x72]) && prefix.length > USTAR_OFFSET + 5
        && (prefix[USTAR_OFFSET + 5] === 0x00 || prefix[USTAR_OFFSET + 5] === 0x20))
        return "tar";
    return null;
}
/**
 * Extensions whose files are ZIP containers by format and are read by their own
 * document decoders rather than as archives. A ZIP signature on one of these is
 * the expected shape of the document, not a disguised archive.
 */
exports.ZIP_CONTAINER_DOCUMENT_EXTENSIONS = new Set([
    ".docx", ".xlsx", ".pptx", ".docm", ".xlsm", ".pptm", ".odt", ".ods", ".odp", ".epub",
]);
/**
 * Whether a signature found under `name` is worth reporting: the file's name
 * did not already declare it an archive, and it is not a document container
 * whose ZIP framing is its normal format.
 */
function signatureContradictsName(name, signature) {
    const extension = archiveExtensionOf(name);
    if (exports.ARCHIVE_EXTENSIONS.has(extension))
        return false;
    if (signature === "zip" && exports.ZIP_CONTAINER_DOCUMENT_EXTENSIONS.has(extension))
        return false;
    return true;
}
//# sourceMappingURL=archive_formats.js.map