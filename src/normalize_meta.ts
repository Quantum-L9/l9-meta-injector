// normalize_meta.ts - Build NormalizedMeta header as a pure transform.
import * as path from "node:path";
import {
  ClassifyResult, ExtractedFields, ExecutableRetrievalMeta, PromptMeta, DoctrineMeta,
  ArtifactMeta, NormalizedMeta, UNKNOWN, PRIMITIVE_TAXONOMY, McpPrimitive,
} from "./schema";
import { contentHash, estimateTokens } from "./extract";
import { resolveNamespace, NamespaceConfig } from "./namespace";
import { serializeYamlObject, yamlScalar } from "./yaml_serialize";

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function stableSourcePath(filePath: string, sourceRoot?: string): string {
  if (sourceRoot !== undefined) {
    const root = path.resolve(sourceRoot);
    const absolute = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
    const relative = path.relative(root, absolute);
    if (relative === "") return ".";
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`metadata source path escapes repository root: ${filePath}`);
    }
    return toPosix(relative);
  }
  if (path.isAbsolute(filePath)) return path.basename(filePath);
  const normalized = toPosix(path.normalize(filePath)).replace(/^\.\//, "");
  return normalized || ".";
}

function slugTitle(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).replace(/[-_.]/g, " ").replace(/^Prompt /i, "").trim();
}

export { yamlScalar };

export function serializeToYamlFrontMatter(meta: NormalizedMeta): string {
  return serializeYamlObject(meta as unknown as Record<string, unknown>);
}

export function buildMeta(
  filePath: string,
  originalBody: string,
  ef: ExtractedFields,
  cr: ClassifyResult,
  nsCfg: NamespaceConfig,
  authority: string,
  detectedAt: string,
  sourceRoot?: string,
): NormalizedMeta {
  const sourcePath = stableSourcePath(filePath, sourceRoot);
  const tax = PRIMITIVE_TAXONOMY[cr.artifactType] ?? PRIMITIVE_TAXONOMY["unknown"];
  const { namespace, sharingScope, idStem } = resolveNamespace(sourcePath, nsCfg, cr.artifactType);
  const timestamp = detectedAt.trim() || UNKNOWN;

  const base = {
    id: idStem,
    title: slugTitle(sourcePath),
    artifact_type: cr.artifactType,
    mcp_primitive: tax.mcpPrimitive as McpPrimitive,
    callable: tax.callable,
    retrievable: tax.injectable,
    injectable: tax.injectable,
    namespace,
    sharing_scope: sharingScope,
    source_path: sourcePath,
    content_hash: contentHash(originalBody),
    token_cost_estimate: estimateTokens(originalBody),
    authority,
    created_or_detected_at: timestamp,
  };

  if (cr.artifactType === "doctrine") {
    return { ...base, governs: UNKNOWN, decision_drivers: UNKNOWN, applies_to_domains: UNKNOWN } as DoctrineMeta;
  }
  if (cr.artifactType === "test" || cr.artifactType === "script" || cr.artifactType === "source") {
    return { ...base, owner: UNKNOWN } as ArtifactMeta;
  }

  const executable: ExecutableRetrievalMeta = {
    ...base,
    family: cr.family,
    description: UNKNOWN,
    activation_signals: cr.signals.length > 0 ? cr.signals : UNKNOWN,
    input_contract: UNKNOWN,
    output_contract: UNKNOWN,
    validation_gates: ef.validationGates,
    stop_conditions: ef.stopConditions,
  };

  if (cr.artifactType === "prompt") {
    return {
      ...executable,
      role: ef.role,
      objective: ef.objective,
      input_variables: ef.inputVariables,
      output_format: ef.outputFormat,
      model_target: ef.modelTarget,
      constraints: ef.constraints,
      phase_model: ef.phaseModel,
    } as PromptMeta;
  }
  return executable;
}
