import { MetricsSnapshot } from "./metrics";
import { FieldDiff } from "./schema";
export interface SkillsPipelineConfig {
    root: string;
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
}
export interface SkillsPipelineResult {
    considered: number;
    changed: number;
    unchanged: number;
    files: SkillsFileResult[];
    metrics: MetricsSnapshot;
}
export declare function runSkillsPipelineAsync(config: SkillsPipelineConfig): Promise<SkillsPipelineResult>;
