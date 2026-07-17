// extract.ts — Structured-grammar extraction: AST/regex for code, frontmatter for .md
// Rule: parse what has grammar; for prose fields return UNKNOWN (assist.ts fills those).
import * as crypto from "crypto";
import { ExtractedFields, UNKNOWN, Unknown, HeaderConvention } from "./schema";
import { getAdapter } from "./llm";

export function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function estimateTokens(text: string): number {
  return getAdapter().estimateTokens(text);
}

function extractList(body: string, heading: RegExp): string[] | Unknown {
  const m = body.match(heading);
  if (!m || m.index === undefined) return UNKNOWN;
  const start = m.index + m[0].length;
  const nextHeading = /\n## /;
  const nextMatch = body.slice(start).match(nextHeading);
  const section = nextMatch ? body.slice(start, start + (nextMatch.index ?? body.length)) : body.slice(start);
  const items = section.match(/^[-*]\s+.+/gm)?.map((l) => l.replace(/^[-*]\s+/, "").trim()) ?? [];
  return items.length > 0 ? items : UNKNOWN;
}

function extractScalar(body: string, patterns: RegExp[]): string | Unknown {
  for (const p of patterns) {
    const m = body.match(p);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return UNKNOWN;
}

// Regex-seed patterns for prose sections.
// Prose fields NOT extracted here — assist.ts handles description/activation_signals/contracts.
export function extract(body: string): ExtractedFields {
  return {
    role: extractScalar(body, [/^##\s+Role[ \t]*\n+([^\n#]+)/m, /\*\*Role\*\*:?\s*([^\n]+)/]),
    objective: extractScalar(body, [/^##\s+Objective[ \t]*\n+([^\n#]+)/m, /\*\*Objective\*\*:?\s*([^\n]+)/]),
    constraints: extractList(body, /^##\s+Constraints?\s*$/m),
    validationGates: extractList(body, /^##\s+Validation Gates?\s*$/m),
    stopConditions: extractList(body, /^##\s+Stop Conditions?\s*$/m),
    phaseModel: extractList(body, /^##\s+(Phase Model|Phases)\s*$/m),
    inputVariables: extractList(body, /^##\s+Input Variables?\s*$/m),
    outputFormat: extractScalar(body, [/^##\s+Output Format[ \t]*\n+([^\n#]+)/m, /\*\*Output Format\*\*:?\s*([^\n]+)/]),
    modelTarget: extractScalar(body, [/^##\s+Model[ _-]?Target[ \t]*\n+([^\n#]+)/mi, /model[_-]?target:?\s*([^\n,]+)/i, /\*\*Model Target\*\*:?\s*([^\n]+)/]),
  };
}

export function splitContent(raw: string): { frontMatter: string | null; body: string; headerConvention: HeaderConvention } {
  if (raw.startsWith("---\n") || raw.startsWith("---\r\n")) {
    const end = raw.indexOf("\n---", 4);
    if (end !== -1) {
      const fm = raw.slice(0, end + 4);
      const rest = raw.slice(end + 4).replace(/^\n/, "");
      return { frontMatter: fm, body: rest, headerConvention: "full-yaml" };
    }
  }
  if (/^[a-zA-Z_]+:\s+.+/m.test(raw.slice(0, 300))) return { frontMatter: null, body: raw, headerConvention: "bare-yaml" };
  if (/\|.+\|.+\|/.test(raw.slice(0, 500))) return { frontMatter: null, body: raw, headerConvention: "prose-table" };
  return { frontMatter: null, body: raw, headerConvention: "none" };
}

export function stripExistingFrontMatter(raw: string): string {
  if (raw.startsWith("---\n") || raw.startsWith("---\r\n")) {
    const end = raw.indexOf("\n---", 4);
    // Strip ALL blank lines between the closing `---` and the body. buildInjection
    // writes `frontmatter + "\n\n" + body`, so recovering the body must consume the
    // full blank separator (not just one newline) or the round-tripped body hash
    // drifts by a leading "\n" on first injection — reporting bodyPreserved=false
    // for a body that was in fact preserved.
    if (end !== -1) return raw.slice(end + 4).replace(/^\n+/, "");
  }
  return raw;
}
