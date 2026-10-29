import { VerifyResult, NormalizedMeta } from "./schema";
export declare function verify(filePath: string, origHash: string, meta: NormalizedMeta, options?: {
    semanticallyBound?: boolean;
    /**
     * Skip the two checks that read written bytes — header presence and body-hash
     * preservation — and run only the meta-derived checks (taxonomy, sharing scope,
     * prompt schema). For a dry-run record whose planned bytes were never written the
     * file on disk is the pre-injection state, so those checks would report the
     * absence of a header that is only *about* to be added (RC-015). Both are then
     * reported as passing: neither was evaluated against anything written.
     */
    skipWrittenBytesChecks?: boolean;
}): VerifyResult;
