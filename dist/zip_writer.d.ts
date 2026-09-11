import { ZipDirectory } from "./zip_reader";
export declare function rootMetaKind(name: string): "canonical" | "legacy" | null;
export declare function holdZipRewrite(directory: ZipDirectory): string | null;
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
