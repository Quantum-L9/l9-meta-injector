import { InjectionRecord, PromptMeta, ExecutableRetrievalMeta } from "./schema";
export declare function buildDedupEntries(records: InjectionRecord[], prefixLen: number): {
    id: string;
    sourcePath: string;
    contentHash: string;
    hashPrefix: string;
    family: import("./schema").ArtifactFamily;
    artifactType: import("./schema").ArtifactType;
}[];
export declare function buildDedupReport(entries: ReturnType<typeof buildDedupEntries>, _threshold: number, _prefixLen: number): {
    generatedAt: string;
    totalScanned: number;
    auditorTwins: {
        paths: string[];
        contentHash: string;
    }[];
    nearDuplicates: never[];
    uniqueCount: number;
};
export declare function buildPromptLibraryIndex(records: InjectionRecord[]): PromptMeta[];
export declare function buildPrimitiveLibraryIndex(records: InjectionRecord[]): ExecutableRetrievalMeta[];
export declare function dedupReportToMarkdown(report: ReturnType<typeof buildDedupReport>): string;
