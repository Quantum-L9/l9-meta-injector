import { runPipelineAsync } from "l9-meta-injector";
import type { PipelineConfig, PipelineResult, NormalizedMeta, MetaV3Record } from "l9-meta-injector";

const config: PipelineConfig = {
  root: "./input",
  glob: "**/*.md",
  dryRun: true,
  outDir: "./out",
  namespace: "consumer",
  authority: "consumer.types",
  nearDupThreshold: 0.9,
  hashPrefixLength: 16,
  indexDir: "./index",
  verbose: false,
  llmEnabled: false,
  normalizeFilenames: false,
};

const execute = async (): Promise<PipelineResult> => runPipelineAsync(config);
const metaId = (value: NormalizedMeta): string => value.id;
const v3Source = (value: MetaV3Record): string => value.sourcePath;
void execute;
void metaId;
void v3Source;
