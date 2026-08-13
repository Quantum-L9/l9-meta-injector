import { FieldDiff } from "./schema";
import { MetricsSnapshot } from "./metrics";
import type { AuthorityConflict } from "./operation_contracts";
export interface SkillsPipelineConfig {
    root: string;
    /** Caller-supplied writer-intent identifier (CLI/action parity with check/apply). */
    authority: string;
    dryRun: boolean;
    outDir: string;
    verbose: boolean;
    llmEnabled: boolean;
    llmBaseUrl?: string;
    llmApiKey?: string;
    llmModel?: string;
    llmAllowInsecure?: boolean;
    omitPatterns?: string[];
    omitFile?: string;
}
export interface SkillsFileResult {
    sourcePath: string;
    relativePath: string;
    changed: boolean;
    diffs: FieldDiff[];
    skippedReason?: string;
}
export interface SkillsPipelineResult {
    considered: number;
    changed: number;
    unchanged: number;
    files: SkillsFileResult[];
    metrics: MetricsSnapshot;
    /** True only when repository authority loaded and no writer conflicts were found. */
    authorityResolved: boolean;
    /** True only when the governed transaction committed at least one changed path. */
    repositoryMutated: boolean;
    /** Authority-scan conflicts; non-empty when the run failed closed. */
    authorityConflicts: AuthorityConflict[];
}
export declare function runSkillsPipelineAsync(config: SkillsPipelineConfig): Promise<SkillsPipelineResult>;
