import { VerifyResult, NormalizedMeta } from "./schema";
export declare function verify(filePath: string, origHash: string, meta: NormalizedMeta, options?: {
    semanticallyBound?: boolean;
}): VerifyResult;
