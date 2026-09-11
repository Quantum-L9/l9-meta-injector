export declare const L9_COMMENT_PREFIX = "L9:";
export interface DarwinSearchInput {
    fileName: string;
    kind: string;
    harvestedTitle?: string | null;
    harvestedTags?: string[];
}
export declare function versionTokenFromFileName(fileName: string): string | null;
export declare function buildFinderComment(input: DarwinSearchInput): string;
export declare function buildFinderTags(input: DarwinSearchInput): string[];
export declare function isInventoryFinderComment(value: string | null): boolean;
export interface HarvestedDarwinSearch {
    comment: string | null;
    tags: string[];
}
/** Read current Finder Comment/Tags before any rewrite that replaces the inode. */
export declare function harvestDarwinSearch(abs: string): HarvestedDarwinSearch;
export declare function projectDarwinSearch(abs: string, input: DarwinSearchInput, prior?: HarvestedDarwinSearch): string | null;
