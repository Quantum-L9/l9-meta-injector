// assist.ts — LLM assist for prose-origin fields only.
// Rule: if a field has structured grammar (YAML frontmatter, heading list), parse it.
// If it lives in prose, seed with regex, let LLM finish — but only when seed fails "good" predicate.
import { UNKNOWN } from "./schema";
import { getAdapter } from "./llm";

export interface AssistConfig {
  enabled: boolean;
  proseFields: Array<"description" | "activation_signals" | "input_contract" | "output_contract">;
}

export const DEFAULT_ASSIST_CONFIG: AssistConfig = {
  enabled: false,
  proseFields: ["description", "activation_signals"],
};

// "good" predicate: value is non-Unknown, non-empty, >=8 meaningful word tokens
export function isGoodValue(v: unknown): boolean {
  if (v === UNKNOWN || v === null || v === undefined) return false;
  if (typeof v === "string") {
    const t = v.trim();
    return t !== "" && t !== UNKNOWN && t.split(/\s+/).length >= 8;
  }
  if (Array.isArray(v)) return v.length > 0 && v.every((i) => i !== UNKNOWN && String(i).trim() !== "");
  return false;
}

// Fields that live in prose → seed with regex, LLM finishes
export const PROSE_ORIGIN_FIELDS = new Set([
  "description", "intent", "activation_signals", "input_contract", "output_contract",
]);

// Fields that live in structured grammar → parse only, never LLM
export const GRAMMAR_ORIGIN_FIELDS = new Set([
  "role", "objective", "constraints", "validation_gates", "stop_conditions",
  "phase_model", "input_variables", "output_format", "model_target",
  "id", "title", "artifact_type", "mcp_primitive", "callable", "namespace", "sharing_scope",
]);

export async function assistField(
  fieldName: string, seedValue: unknown, body: string, config: AssistConfig
): Promise<unknown> {
  if (!config.enabled) return seedValue;
  if (isGoodValue(seedValue)) return seedValue;
  const adapter = getAdapter();
  if (!adapter.classify) return seedValue;
  const result = await adapter.classify(buildFieldPrompt(fieldName, body));
  if (!result || result.trim() === "" || result.trim() === UNKNOWN) return seedValue;
  return result.trim();
}

function buildFieldPrompt(fieldName: string, body: string): string {
  const b = body.length > 1200 ? body.slice(0, 1200) + "\n[truncated]" : body;
  switch (fieldName) {
    case "description": return `Write a single sentence (≤20 words) describing what this artifact does. Body:\n${b}\nDescription:`;
    case "activation_signals": return `List 3-6 short trigger phrases (comma-separated) for this artifact. Body:\n${b}\nSignals:`;
    case "input_contract": return `Describe inputs this artifact expects in ≤15 words. Body:\n${b}\nInput contract:`;
    case "output_contract": return `Describe outputs this artifact produces in ≤15 words. Body:\n${b}\nOutput contract:`;
    default: return `Extract the ${fieldName} from this text in ≤20 words:\n${b}\n${fieldName}:`;
  }
}
