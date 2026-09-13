export interface TarMember {
    name: string;
    type: string;
    size: number;
    content: Buffer;
    /** Header plus padded data, for byte-faithful rewrite of admitted members. */
    rawRecord: Buffer;
}
export type TarReadResult = {
    ok: true;
    members: TarMember[];
} | {
    ok: false;
    hold: string;
};
export declare function readTarArchive(bytes: Buffer): TarReadResult;
export declare function peekTarRootMeta(bytes: Buffer): Buffer | null;
export declare function rootMetaKind(name: string): "canonical" | "legacy" | null;
