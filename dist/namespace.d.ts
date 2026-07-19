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
