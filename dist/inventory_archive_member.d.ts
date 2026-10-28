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
/**
 * Upsert the archive's root `.l9meta.yaml` member. Every outcome is a result:
 * admission holds, codec holds, and filesystem failures while reading or
 * replacing the archive (`archive.rewrite_io_failed:<errno>`) all return
 * `{ rewritten: false, hold }` so the caller records them on the archive's own
 * record and the inventory walk continues (RC-056).
 */
export declare function upsertArchiveRootMeta(abs: string, yaml: string): ArchiveMemberResult;
export declare function isCanonicalMetaMemberName(name: string): boolean;
