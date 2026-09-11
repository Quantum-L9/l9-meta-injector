export type TarTypeFlag = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "L" | "K" | "x" | "g" | "S" | "\0";
export interface TarHeaderFields {
    name: string;
    content?: string | Buffer;
    type?: TarTypeFlag;
    linkName?: string;
    mode?: number;
    uid?: number;
    gid?: number;
    mtime?: number;
    declaredSize?: number;
}
/** One 512-byte ustar header plus padded data blocks. */
export declare function encodeTarEntry(spec: TarHeaderFields): Buffer;
/** A complete tar stream: entries followed by two zero blocks. */
export declare function encodeTarArchive(entries: TarHeaderFields[]): Buffer;
export declare function parseOctalField(raw: Buffer): number;
export declare function tarChecksum(header: Buffer): number;
export declare const TAR_BLOCK_SIZE = 512;
