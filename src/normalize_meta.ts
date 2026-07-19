// normalize_meta.ts — Build NormalizedMeta header (pure, no IO)
import * as path from "path";
import {
  ClassifyResult, ExtractedFields, ExecutableRetrievalMeta, PromptMeta, DoctrineMeta,
  ArtifactMeta, NormalizedMeta, UNKNOWN, PRIMITIVE_TAXONOMY, McpPrimitive,
} from "./schema";
import { contentHash, estimateTokens } from "./extract";
import { resolveNamespace, NamespaceConfig } from "./namespace";

function slugTitle(fp: string): string {
  return path.basename(fp, path.extname(fp)).replace(/[-_.]/g, " ").replace(/^Prompt /i, "").trim();
}

function yamlScalar(v: unknown): string {
  if (v === null || v === undefined) return '""';
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (s === "") return '""';
  if (/[:#{}\[\],&*?|<>=!%@`\n'"\\]/.test(s) || s.trim() !== s || s === "true" || s === "false")
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return s;
}

export function serializeToYamlFrontMatter(meta: NormalizedMeta): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${k}: []`);
      else { lines.push(`${k}:`); v.forEach((i) => lines.push(`  - ${yamlScalar(i)}`)); }
    } else lines.push(`${k}: ${yamlScalar(v)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

export function buildMeta(
  filePath: string, originalBody: string, ef: ExtractedFields, cr: ClassifyResult,
  nsCfg: NamespaceConfig, authority: string, now: string
): NormalizedMeta {
  const tax = PRIMITIVE_TAXONOMY[cr.artifactType] ?? PRIMITIVE_TAXONOMY["unknown"];
  const { namespace, sharingScope, idStem } = resolveNamespace(filePath, nsCfg, cr.artifactType);

  const base = {
    id: idStem, title: slugTitle(filePath), artifact_type: cr.artifactType,
    mcp_primitive: tax.mcpPrimitive as McpPrimitive, callable: tax.callable,
    retrievable: tax.injectable, injectable: tax.injectable,
    namespace, sharing_scope: sharingScope,
    source_path: filePath, content_hash: contentHash(originalBody),
    token_cost_estimate: estimateTokens(originalBody), authority,
    created_or_detected_at: now,
  };

  if (cr.artifactType === "doctrine") return { ...base, governs: UNKNOWN, decision_drivers: UNKNOWN, applies_to_domains: UNKNOWN } as DoctrineMeta;
  if (cr.artifactType === "test" || cr.artifactType === "script" || cr.artifactType === "source") return { ...base, owner: UNKNOWN } as ArtifactMeta;

  const exec: ExecutableRetrievalMeta = {
    ...base, family: cr.family, description: UNKNOWN,
    activation_signals: cr.signals.length > 0 ? cr.signals : UNKNOWN,
    input_contract: UNKNOWN, output_contract: UNKNOWN,
    validation_gates: ef.validationGates, stop_conditions: ef.stopConditions,
  };

  if (cr.artifactType === "prompt") {
    return { ...exec, role: ef.role, objective: ef.objective, input_variables: ef.inputVariables,
      output_format: ef.outputFormat, model_target: ef.modelTarget, constraints: ef.constraints, phase_model: ef.phaseModel } as PromptMeta;
  }
  return exec;
}
