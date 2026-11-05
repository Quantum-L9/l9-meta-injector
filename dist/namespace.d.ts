import { SharingScope } from "./schema";
export type { SharingScope } from "./schema";
export interface NamespaceResolution {
    namespace: string;
    sharingScope: SharingScope;
    primitiveFolder: string;
    idStem: string;
}
export interface NamespaceConfig {
    namespace: string;
    authority: string;
    nearDupThreshold: number;
    hashPrefixLength: number;
    outputDir: string;
    indexDir: string;
    namespaceGlobs?: Array<{
        glob: string;
        namespace: string;
    }>;
}
export type NamespaceInput = Pick<NamespaceConfig, "namespace" | "namespaceGlobs">;
export declare function toSnakeStem(filename: string): string;
export declare function resolveNamespace(filePath: string, cfg: NamespaceInput, typeHint?: string): NamespaceResolution;
export declare const TRACKED_IDENTITY_PREFIX: "l9.path/v2:";
/** Reject lone surrogates instead of silently replacing repository identity bytes. */
export declare function assertPortableRepositoryIdentity(repositoryId: string): void;
/** Canonical lossless byte decoder. Buffer's permissive base64 decoder is not validation. */
export declare function decodeTrackedPathBytes(encoded: string): Buffer;
/** Two independently encoded tuple components; '.' cannot occur in either base64url component. */
export declare function trackedPathIdentity(repositoryId: string, pathBytesBase64: string): string;
export declare function decodeTrackedPathIdentity(id: string): {
    repositoryId: string;
    pathBytesBase64: string;
};
/** Git path order is an unsigned raw-byte lexicographic total order, never locale/NFC order. */
export declare function compareTrackedPaths(left: {
    path_bytes_base64: string;
}, right: {
    path_bytes_base64: string;
}): number;
