export type InventoryRewriteKind = "zip" | "tar" | "tar.gz";
export declare function inventoryRewriteKind(fileName: string): InventoryRewriteKind | null;
export declare function peekArchiveRootMeta(abs: string): string | null;
export type ArchiveMemberResult = {
    rewritten: true;
} | {
    rewritten: false;
    hold: string;
};
export declare function upsertArchiveRootMeta(abs: string, yaml: string): ArchiveMemberResult;
export declare function isCanonicalMetaMemberName(name: string): boolean;
