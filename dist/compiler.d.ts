import { InjectionRecord, PromptMeta, ExecutableRetrievalMeta } from "./schema";
export declare function buildDedupEntries(records: InjectionRecord[], prefixLen: number, bodies?: Map<string, string>): {
    id: string;
    sourcePath: string;
    contentHash: string;
    hashPrefix: string;
    family: import("./schema").ArtifactFamily;
    artifactType: import("./schema").ArtifactType;
    shingles: Set<string>;
}[];
export interface NearDuplicate {
    paths: [string, string];
    similarity: number;
}
export declare function buildDedupReport(entries: ReturnType<typeof buildDedupEntries>, threshold: number, _prefixLen: number): {
    generatedAt: string;
    totalScanned: number;
    auditorTwins: {
        paths: string[];
        contentHash: string;
    }[];
    nearDuplicates: NearDuplicate[];
    uniqueCount: number;
};
export declare function buildPromptLibraryIndex(records: InjectionRecord[]): PromptMeta[];
export declare function buildPrimitiveLibraryIndex(records: InjectionRecord[]): ExecutableRetrievalMeta[];
export declare function dedupReportToMarkdown(report: ReturnType<typeof buildDedupReport>): string;
