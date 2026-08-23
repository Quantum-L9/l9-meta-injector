import { ZipCentralEntry } from "../zip_reader";
import { DecoderBudget, DecoderDiagnostic } from "./decoder";
/** An OOXML container, opened and bounded, with its parts addressable by name. */
export interface OoxmlContainer {
    entries: Map<string, ZipCentralEntry>;
    diagnostics: DecoderDiagnostic[];
    /** Read one part as text, or null when it is absent or refused. */
    readPart(name: string): string | null;
    /** Part names present, in code-point order. */
    partNames(): string[];
}
export declare class OoxmlError extends Error {
    readonly code: "encrypted" | "malformed" | "budget";
    constructor(code: "encrypted" | "malformed" | "budget", message: string);
}
/**
 * Whether a stored part name is one this reader will touch.
 *
 * Office writes plain relative paths like `word/document.xml`. Anything else —
 * absolute, drive-qualified, backslashed, or containing a `..` segment — is a
 * container trying to address something outside itself.
 */
export declare function isSafePartName(name: string): boolean;
/**
 * Open an OOXML container with every bound the decoder budget declares.
 *
 * Encryption is detected before anything else: an encrypted Office file is a
 * valid ZIP holding an `EncryptedPackage` stream, so it parses happily and yields
 * nothing readable. Reporting that as an empty document would be exactly the
 * "empty success" this layer exists to prevent.
 */
export declare function openOoxml(archivePath: string, budget: DecoderBudget): OoxmlContainer;
/**
 * Note every external relationship the container declares, without following one.
 *
 * A `.rels` part with `TargetMode="External"` is how an Office document points at
 * a URL. Recording it makes the reference visible as evidence; fetching it would
 * make opening an old archive a network event.
 */
export declare function noteExternalRelationships(container: OoxmlContainer, budget: DecoderBudget): DecoderDiagnostic[];
