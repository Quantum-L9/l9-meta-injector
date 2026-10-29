import { LocalArchivePolicy } from "./local_archive_policy";
export type BoundedInflateResult = {
    ok: true;
    bytes: Buffer;
} | {
    ok: false;
    hold: string;
};
/**
 * Bounded gzip inflation. Output above the policy's
 * maxTotalUncompressedBytesPerArchive is refused while inflating; output exactly
 * at the budget is accepted. Always settles.
 */
export declare function boundedGunzip(compressed: Buffer, policy?: LocalArchivePolicy): Promise<BoundedInflateResult>;
/** Synchronous bounded gzip inflation; same verdicts as `boundedGunzip`. */
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
