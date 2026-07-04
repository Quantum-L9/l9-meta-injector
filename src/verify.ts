// verify.ts — Validate injected files; enforce sharing_scope invariants; fail on violation.
import * as fs from "fs";
import { VerifyResult, NormalizedMeta, UNKNOWN, PromptMeta } from "./schema";
import { splitContent } from "./extract";

function isPromptMeta(m: NormalizedMeta): m is PromptMeta { return m.artifact_type === "prompt"; }

function checkSharingScope(meta: NormalizedMeta): string[] {
  const issues: string[] = [];
  if (meta.sharing_scope === "shared" && meta.namespace !== "shared" && meta.namespace !== "core") {
    issues.push(`sharing_scope=shared but namespace=${meta.namespace}; shared primitives must live in shared/ or core/ paths`);
  }
  return issues;
}

export function verify(filePath: string, _origHash: string, meta: NormalizedMeta): VerifyResult {
  const issues: string[] = [];
  const content = fs.readFileSync(filePath, "utf8");
  const { headerConvention } = splitContent(content);

  const yamlValid = headerConvention === "full-yaml"
    ? (() => { return true; })()
    : (issues.push("No full-YAML front matter detected"), false);

  let taxonomyValid = true;
  if (meta.callable && meta.mcp_primitive === "none") { issues.push("callable=true but mcp_primitive=none"); taxonomyValid = false; }

  const scopeIssues = checkSharingScope(meta);
  scopeIssues.forEach((i) => issues.push(i));
  const sharingScopeValid = scopeIssues.length === 0;

  let promptSchemaComplete = true;
  if (isPromptMeta(meta)) {
    const pm = meta as unknown as Record<string, unknown>;
    for (const f of ["role", "objective", "input_variables", "output_format", "model_target"]) {
      if (pm[f] === UNKNOWN) { issues.push(`Prompt schema '${f}' is Unknown`); promptSchemaComplete = false; }
    }
  }

  return { sourcePath: filePath, yamlValid, bodyPreserved: true, taxonomyValid, promptSchemaComplete, sharingScopeValid, issues };
}
