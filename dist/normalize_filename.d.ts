export interface NormalizeFilenameResult {
    originalPath: string;
    normalizedName: string;
    normalizedPath: string;
    changed: boolean;
    sidecarPath: string;
}
export declare function toSnakeCase(s: string): string;
export declare function normalizeFilename(filePath: string): NormalizeFilenameResult;
export interface NormalizeFilenameOptions {
    dryRun: boolean;
    verbose: boolean;
}
export declare function normalizeFilenameWithLog(filePath: string, opts: NormalizeFilenameOptions): NormalizeFilenameResult;
export declare function normalizeFilenames(filePaths: string[], opts: NormalizeFilenameOptions): NormalizeFilenameResult[];
