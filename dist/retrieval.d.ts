import { ScanEntry } from "./schema";
import { OmitMatcher } from "./omit";
export interface FindFilesOptions {
    /** Extra omit patterns (gitignore-style). */
    omitPatterns?: string[];
    /** Optional omit-file path. */
    omitFile?: string;
    /**
     * When true (default), built-in SKILL.md protect applies.
     * Skills mode sets false so skill entrypoints are discoverable.
     */
    protectSkillMd?: boolean;
    /** Pre-built matcher; when set, other omit fields are ignored. */
    omit?: OmitMatcher;
}
export declare function findFiles(root: string, glob: string, opts?: FindFilesOptions): string[];
export declare function scanFiles(filePaths: string[]): ScanEntry[];
