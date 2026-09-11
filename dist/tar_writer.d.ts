import { TarMember } from "./tar_reader";
export declare function injectTarRootMeta(tarBytes: Buffer, yaml: string): {
    ok: true;
    bytes: Buffer;
} | {
    ok: false;
    hold: string;
};
export declare function injectGzipTarRootMeta(gzBytes: Buffer, yaml: string): {
    ok: true;
    bytes: Buffer;
} | {
    ok: false;
    hold: string;
};
export declare function buildTarArchive(members: Array<{
    name: string;
    content: string | Buffer;
}>): Buffer;
export declare function keptMembers(members: TarMember[]): TarMember[];
