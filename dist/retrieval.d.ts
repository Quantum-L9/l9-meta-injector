import { ScanEntry } from "./schema";
export declare function findFiles(root: string, glob: string): string[];
export declare function scanFiles(filePaths: string[]): ScanEntry[];
