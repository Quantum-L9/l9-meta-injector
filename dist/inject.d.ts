import { NormalizedMeta, InjectionRecord } from "./schema";
export interface InjectOptions {
    dryRun: boolean;
    outDir: string;
    verbose: boolean;
    writeInjectLog: boolean;
}
export declare function injectFileAsync(filePath: string, meta: NormalizedMeta, opts: InjectOptions): Promise<InjectionRecord>;
export declare function injectFile(filePath: string, meta: NormalizedMeta, opts: InjectOptions): InjectionRecord;
