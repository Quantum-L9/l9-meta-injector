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
    /**
     * Parts not read because the container's decompression allowance was spent,
     * in the order they were asked for.
     */
    skippedForAllowance(): string[];
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
/** One internal relationship, resolved to the part it names. */
export interface OoxmlRelationship {
    id: string;
    type: string;
    /** The contained part name the target resolves to. */
    part: string;
}
/** The relationship part that describes `sourcePart`: `xl/workbook.xml` → `xl/_rels/workbook.xml.rels`. */
export declare function relationshipPartName(sourcePart: string): string;
/**
 * Resolve a relationship target against the directory of its source part.
 *
 * A target starting with `/` is package-absolute. `.` and `..` segments are
 * applied, and a `..` that would climb above the package root makes the target
 * unresolvable rather than clamped — clamping would turn an escape into some
 * other part that happens to exist. Null when the target is not a contained
 * part name.
 */
export declare function resolveRelationshipTarget(sourcePart: string, target: string): string | null;
/**
 * The internal relationships `sourcePart` declares, keyed by `Id`.
 *
 * Null when the source part has no relationship part, which a caller treats as
 * "nothing was declared" rather than as an empty declaration. An external
 * relationship is skipped — it is noted elsewhere and never followed — and a
 * target that escapes the container or names a part this container does not
 * hold is ignored with a diagnostic on the container. Nothing is read here but
 * the relationship part itself.
 */
export declare function readRelationships(container: OoxmlContainer, sourcePart: string, maxDepth: number): Map<string, OoxmlRelationship> | null;
/**
 * Note every external relationship the container declares, without following one.
 *
 * A `.rels` part with `TargetMode="External"` is how an Office document points at
 * a URL. Recording it makes the reference visible as evidence; fetching it would
 * make opening an old archive a network event.
 */
export declare function noteExternalRelationships(container: OoxmlContainer, budget: DecoderBudget): DecoderDiagnostic[];
