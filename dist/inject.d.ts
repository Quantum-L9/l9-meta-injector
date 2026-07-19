import { NormalizedMeta, InjectionRecord } from "./schema";
import { MetricsCollector } from "./metrics";
export interface InjectOptions {
    dryRun: boolean;
    outDir: string;
    verbose: boolean;
    writeInjectLog: boolean;
}
export declare function injectFileAsync(filePath: string, meta: NormalizedMeta, opts: InjectOptions, metrics?: MetricsCollector): Promise<InjectionRecord>;
export declare function injectFile(filePath: string, meta: NormalizedMeta, opts: InjectOptions): InjectionRecord;
