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
    promptGlob: string;
    namespaceGlobs?: Array<{
        glob: string;
        namespace: string;
    }>;
}
export declare function toSnakeStem(filename: string): string;
export declare function resolveNamespace(filePath: string, cfg: NamespaceConfig, typeHint?: string): NamespaceResolution;
