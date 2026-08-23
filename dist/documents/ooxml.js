"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OoxmlError = void 0;
exports.isSafePartName = isSafePartName;
exports.openOoxml = openOoxml;
exports.noteExternalRelationships = noteExternalRelationships;
// ooxml.ts — the container Word, PowerPoint and Excel files actually are.
//
// A `.docx` is a ZIP of XML parts. That is convenient and it is also the reason
// these formats need the same defences an archive needs: an OOXML file can be a
// zip bomb, can declare a part path that escapes the container, can hold symlink
// entries, and can name external relationships pointing anywhere on the network.
//
// So this module reuses the archive reader the corpus already trusts — the one
// with runtime-enforced uncompressed ceilings rather than declared-size checks —
// and adds the OOXML-specific refusals on top:
//
//   - a part path that is absolute, contains `..`, or is not a plain relative
//     name is refused rather than normalized into something safe-looking;
//   - a symlink or special entry is refused: an Office part is a file;
//   - external relationships are recorded as diagnostics and never fetched;
//   - macro parts are noted and never executed.
const zip_reader_1 = require("../zip_reader");
const xml_1 = require("./xml");
class OoxmlError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "OoxmlError";
        this.code = code;
    }
}
exports.OoxmlError = OoxmlError;
/**
 * Whether a stored part name is one this reader will touch.
 *
 * Office writes plain relative paths like `word/document.xml`. Anything else —
 * absolute, drive-qualified, backslashed, or containing a `..` segment — is a
 * container trying to address something outside itself.
 */
function isSafePartName(name) {
    if (name.length === 0 || name.length > 512)
        return false;
    if (name.startsWith("/") || name.startsWith("\\"))
        return false;
    if (/^[A-Za-z]:/.test(name))
        return false;
    if (name.includes("\\"))
        return false;
    return !name.split("/").some((segment) => segment === ".." || segment === "." || segment === "");
}
/** Macro-bearing parts. Recorded so an operator knows, never executed. */
const MACRO_PARTS = /(vbaProject\.bin|vbaData\.xml|\/macros?\/)/i;
/**
 * Open an OOXML container with every bound the decoder budget declares.
 *
 * Encryption is detected before anything else: an encrypted Office file is a
 * valid ZIP holding an `EncryptedPackage` stream, so it parses happily and yields
 * nothing readable. Reporting that as an empty document would be exactly the
 * "empty success" this layer exists to prevent.
 */
function openOoxml(archivePath, budget) {
    let directory;
    try {
        directory = (0, zip_reader_1.readZipCentralDirectory)(archivePath);
    }
    catch (error) {
        if (error instanceof zip_reader_1.ZipFormatError) {
            throw new OoxmlError("malformed", `container is not a readable ZIP: ${error.message}`);
        }
        throw error;
    }
    if (directory.entries.length > budget.maxContainerEntries) {
        throw new OoxmlError("budget", `container declares ${directory.entries.length} entries, above the ceiling of ${budget.maxContainerEntries}`);
    }
    const diagnostics = [];
    const entries = new Map();
    let encrypted = false;
    for (const entry of directory.entries) {
        if (entry.encrypted) {
            encrypted = true;
            continue;
        }
        if (entry.kind === "directory")
            continue;
        if (entry.kind === "symlink" || entry.kind === "special") {
            diagnostics.push({
                code: "decoder.malformed",
                severity: "warning",
                message: `container entry '${entry.name}' is a ${entry.kind} and was refused; Office parts are plain files`,
                part: entry.name,
            });
            continue;
        }
        if (!isSafePartName(entry.name)) {
            diagnostics.push({
                code: "decoder.malformed",
                severity: "warning",
                message: `container entry '${entry.name}' does not name a contained part and was refused`,
                part: entry.name,
            });
            continue;
        }
        if (MACRO_PARTS.test(entry.name)) {
            diagnostics.push({
                code: "decoder.macro_present_not_executed",
                severity: "info",
                message: `container holds a macro part '${entry.name}'; it was neither read nor executed`,
                part: entry.name,
            });
            continue;
        }
        entries.set(entry.name, entry);
    }
    // `EncryptedPackage` is how a password-protected Office file stores itself.
    if (encrypted || entries.has("EncryptedPackage")) {
        throw new OoxmlError("encrypted", "container is encrypted; no part can be read without a credential this package will not ask for");
    }
    if (entries.size === 0) {
        throw new OoxmlError("malformed", "container holds no readable parts");
    }
    const readPart = (name) => {
        const entry = entries.get(name);
        if (entry === undefined)
            return null;
        // The declared ratio is checked before decompressing, and the ceiling is
        // then enforced by the decompressor itself, so an entry that lies about its
        // uncompressed size still cannot produce more than the ceiling.
        if (entry.compressedSize > 0) {
            const ratio = entry.uncompressedSize / entry.compressedSize;
            if (ratio > budget.maxCompressionRatio) {
                diagnostics.push({
                    code: "decoder.budget_exceeded",
                    severity: "warning",
                    message: `part '${name}' declares a compression ratio of ${Math.round(ratio)}:1, above the `
                        + `${budget.maxCompressionRatio}:1 ceiling, and was not expanded`,
                    part: name,
                });
                return null;
            }
        }
        const chunks = [];
        try {
            (0, zip_reader_1.streamZipMember)(archivePath, entry, { maxUncompressedBytes: budget.maxPartBytes }, (chunk) => {
                chunks.push(Buffer.from(chunk));
            });
        }
        catch (error) {
            const budgeted = error instanceof zip_reader_1.ZipBudgetExceededError;
            diagnostics.push({
                code: budgeted ? "decoder.budget_exceeded" : "decoder.malformed",
                severity: "warning",
                message: `part '${name}' could not be read: ${error instanceof Error ? error.message : String(error)}`,
                part: name,
            });
            return null;
        }
        return Buffer.concat(chunks).toString("utf8");
    };
    return {
        entries,
        diagnostics,
        readPart,
        partNames: () => [...entries.keys()].sort(),
    };
}
/**
 * Note every external relationship the container declares, without following one.
 *
 * A `.rels` part with `TargetMode="External"` is how an Office document points at
 * a URL. Recording it makes the reference visible as evidence; fetching it would
 * make opening an old archive a network event.
 */
function noteExternalRelationships(container, budget) {
    const notes = [];
    for (const name of container.partNames()) {
        if (!name.endsWith(".rels"))
            continue;
        const xml = container.readPart(name);
        if (xml === null)
            continue;
        try {
            (0, xml_1.parseXml)(xml, budget.maxDepth, (event) => {
                if (event.type !== "open" || event.name !== "Relationship")
                    return;
                if (event.attributes.TargetMode !== "External")
                    return;
                const target = event.attributes.Target ?? "";
                notes.push({
                    code: "decoder.external_reference_not_followed",
                    severity: "info",
                    message: `document declares an external relationship to '${target}'; it was recorded and not fetched`,
                    part: name,
                });
            });
        }
        catch (error) {
            if (!(error instanceof xml_1.XmlError))
                throw error;
            notes.push({
                code: "decoder.malformed",
                severity: "warning",
                message: `relationship part '${name}' could not be parsed: ${error.message}`,
                part: name,
            });
        }
    }
    return notes;
}
//# sourceMappingURL=ooxml.js.map