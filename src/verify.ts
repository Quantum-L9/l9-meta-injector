// verify.ts — Validate injected files; enforce sharing_scope invariants; fail on violation.
import * as fs from "fs";
import { VerifyResult, NormalizedMeta, UNKNOWN, PromptMeta } from "./schema";
import { splitContent, contentHash, stripExistingFrontMatter } from "./extract";
import { StrategySpec, resolveStrategy, hasInjectedBlock, stripInjectedBlock, sidecarPathFor } from "./comment";

// Recover the clean body from an injected file, mirroring how inject.ts derived
// cleanBody per strategy, so the hash lines up with the recorded originalBodyHash.
function recoverBody(content: string, spec: StrategySpec): string {
  if (spec.strategy === "yaml-frontmatter") return stripExistingFrontMatter(content);
  if (spec.strategy === "line-comment" || spec.strategy === "block-comment") {
    return stripInjectedBlock(content, spec);
  }
  return content; // sidecar: the file body is left untouched by injection
}

// A metadata header is valid if it is present in whatever form the file's strategy
// dictates: YAML frontmatter, a comment-wrapped block, or a sidecar file.
function metaHeaderValid(filePath: string, content: string, issues: string[]): boolean {
  const spec = resolveStrategy(filePath, content);
  if (spec.strategy === "yaml-frontmatter") {
    if (splitContent(content).headerConvention === "full-yaml") return true;
    issues.push("No full-YAML front matter detected");
    return false;
  }
  if (spec.strategy === "line-comment" || spec.strategy === "block-comment") {
    if (hasInjectedBlock(content, spec)) return true;
    issues.push("No l9:meta comment block detected");
    return false;
  }
  // sidecar
  const sidecar = sidecarPathFor(filePath);
  if (fs.existsSync(sidecar) && fs.readFileSync(sidecar, "utf8").trim().length > 0) return true;
  issues.push("No l9meta sidecar file detected");
  return false;
}

function isPromptMeta(m: NormalizedMeta): m is PromptMeta { return m.artifact_type === "prompt"; }

function checkSharingScope(meta: NormalizedMeta): string[] {
  const issues: string[] = [];
  if (meta.sharing_scope === "shared" && meta.namespace !== "shared" && meta.namespace !== "core") {
    issues.push(`sharing_scope=shared but namespace=${meta.namespace}; shared primitives must live in shared/ or core/ paths`);
  }
  return issues;
}

export function verify(filePath: string, origHash: string, meta: NormalizedMeta): VerifyResult {
  const issues: string[] = [];
  const content = fs.readFileSync(filePath, "utf8");
  const spec = resolveStrategy(filePath, content);
  const yamlValid = metaHeaderValid(filePath, content, issues);

  // Body preservation: re-derive the clean body from disk and compare its hash to
  // the body hash captured before injection. A mismatch means injection altered
  // the body — a hard failure, not a silent pass.
  let bodyPreserved = true;
  if (origHash) {
    bodyPreserved = contentHash(recoverBody(content, spec)) === origHash;
    if (!bodyPreserved) issues.push("Body content changed during injection (hash mismatch)");
  }

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

  return { sourcePath: filePath, yamlValid, bodyPreserved, taxonomyValid, promptSchemaComplete, sharingScopeValid, issues };
}
