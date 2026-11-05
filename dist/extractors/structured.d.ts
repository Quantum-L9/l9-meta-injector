import { Extractor } from "../interpretation";
export declare const manifestExtractor: Extractor;
/**
 * Literal `$ref` targets of a machine-readable API contract (ADR-082).
 *
 * An in-document pointer (`#/components/...`) references nothing outside the
 * file and is not reported. A relative file reference resolves only to an
 * observed path; a URL is reported as written. None of these is a runtime edge:
 * a contract that references a schema file says where its definitions live,
 * not which service calls which.
 */
export declare const contractReferenceExtractor: Extractor;
export declare const serviceSpecExtractor: Extractor;
export declare const contractInvariantsExtractor: Extractor;
