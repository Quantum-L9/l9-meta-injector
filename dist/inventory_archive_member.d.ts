import { LocalArchivePolicy } from "./local_archive_policy";
export type BoundedInflateResult = {
    ok: true;
    bytes: Buffer;
} | {
    ok: false;
    hold: string;
};
/**
 * Streaming gzip inflation with budget enforcement.
 *
 * Returns the inflated buffer if it fits within the policy's maxTotalUncompressedBytesPerArchive.
 * Aborts and returns a hold if the budget would be exceeded, preventing decompression bombs.
 */
export declare function boundedGunzip(compressed: Buffer, policy?: LocalArchivePolicy): Promise<BoundedInflateResult>;
/**
 * Synchronous wrapper for bounded gzip inflation.
 * Uses a post-inflation check since zlib.gunzipSync must complete before we know the size.
 */
export declare function boundedGunzipSync(compressed: Buffer, policy?: LocalArchivePolicy): BoundedInflateResult;
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
