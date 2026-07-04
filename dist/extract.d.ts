import { ExtractedFields, HeaderConvention } from "./schema";
export declare function contentHash(text: string): string;
export declare function estimateTokens(text: string): number;
export declare function extract(body: string): ExtractedFields;
export declare function splitContent(raw: string): {
    frontMatter: string | null;
    body: string;
    headerConvention: HeaderConvention;
};
export declare function stripExistingFrontMatter(raw: string): string;
