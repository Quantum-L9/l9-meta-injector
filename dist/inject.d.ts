import { NormalizedMeta, InjectionRecord } from "./schema";
import { MetricsCollector } from "./metrics";
export interface InjectOptions {
    dryRun: boolean;
    outDir: string;
    verbose: boolean;
    writeInjectLog: boolean;
    /** When false, dry-run returns an in-memory plan without creating diff files. */
    writeDryRunDiff?: boolean;
    /**
     * When false, write incoming meta as-is. Inventory already harvested and
     * applied derive-or-Unknown precedence; reconcile would resurrect the
     * placeholders that pass just discarded.
     */
    reconcileExisting?: boolean;
}
/**
 * Body bytes that identity hashes describe: the file with the L9 managed
 * carrier removed. Frontmatter uses the body after the fences; comment
 * strategies use `stripInjectedBlock`; sidecar and skip-binary use the raw
 * text. An unsafe frontmatter document is returned unchanged so inventory
 * can still hash it; `injectFile` refuses that case separately.
 */
export declare function managedCarrierFreeBody(filePath: string, raw: string): string;
export declare function injectFileAsync(filePath: string, meta: NormalizedMeta, opts: InjectOptions, metrics?: MetricsCollector): Promise<InjectionRecord>;
export declare function injectFile(filePath: string, meta: NormalizedMeta, opts: InjectOptions): InjectionRecord;
