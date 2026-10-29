import { ZipCentralEntry, ZipDirectory } from "./zip_reader";
/** Root-meta identity is the admission identity (archive_preflight owns the rule). */
export declare function rootMetaKind(name: string): "canonical" | "legacy" | null;
/**
 * Why a rewrite must not run, or null.
 *
 * With `centralRecordOf`, kept members' original central records are also checked:
 * a record whose local-header offset field is the Zip64 placeholder keeps the real
 * offset in its Zip64 extra, which patching the fixed field cannot relocate, so it
 * holds as Zip64 (ADR-049: Zip64 archives hold until a writer can emit Zip64).
 */
export declare function holdZipRewrite(directory: ZipDirectory, centralRecordOf?: (entry: ZipCentralEntry) => Buffer): string | null;
export declare function buildZipBuffer(members: Array<{
    name: string;
    data: Buffer;
}>): Buffer;
export declare function injectZipRootMeta(archivePath: string, yaml: string): {
    ok: true;
    bytes: Buffer;
} | {
    ok: false;
    hold: string;
};
export declare function peekZipRootMeta(archivePath: string): string | null;
