import * as path from "path";
import { ClassifyResult, ArtifactType, ArtifactFamily, HeaderConvention } from "./schema";

const FAMILY_SIGNALS: Array<{ family: ArtifactFamily; keywords: string[] }> = [
  { family: "auditor",            keywords: ["audit", "review", "check", "validate", "lint", "scan"] },
  { family: "compiler",           keywords: ["compile", "build", "generate", "render", "produce"] },
  { family: "meta_kernel_forge",  keywords: ["meta", "kernel", "forge", "bootstrap", "scaffold"] },
  { family: "builder",            keywords: ["build", "construct", "create", "assemble", "install"] },
  { family: "planner",            keywords: ["plan", "schedule", "orchestrate", "coordinate", "roadmap"] },
  { family: "research",           keywords: ["research", "search", "find", "retrieve", "explore", "analyze"] },
  { family: "domain_agent",       keywords: ["agent", "domain", "dispatch", "route", "delegate"] },
  { family: "legal",              keywords: ["legal", "contract", "clause", "law", "compliance"] },
];

const TYPE_SIGNALS: Array<{ type: ArtifactType; keywords: string[]; pathPatterns: string[] }> = [
  { type: "playbook",  keywords: ["playbook", "workflow", "process", "procedure", "protocol"], pathPatterns: ["playbooks", "playbook"] },
  { type: "kernel",    keywords: ["kernel", "runtime", "executor", "sandbox", "engine"],       pathPatterns: ["kernels", "kernel"] },
  { type: "context",   keywords: ["context", "knowledge", "documentation", "reference"],       pathPatterns: ["contexts", "context"] },
  { type: "doctrine",  keywords: ["doctrine", "governance", "policy", "principle", "standard"],pathPatterns: ["doctrines", "doctrine"] },
  { type: "test",      keywords: ["test", "spec", "fixture", "mock"],                          pathPatterns: ["tests", "test", "__tests__"] },
  { type: "script",    keywords: ["script", "utility", "helper", "tool"],                      pathPatterns: ["scripts", "script"] },
  { type: "prompt",    keywords: [],                                                             pathPatterns: ["prompts", "prompt"] },
  { type: "skill",     keywords: ["skill", "capability", "function", "action", "operation"],   pathPatterns: ["skills", "skill"] },
];

export function classify(filePath: string, body: string, _hc: HeaderConvention): ClassifyResult {
  const fn = path.basename(filePath).toLowerCase();
  const norm = filePath.replace(/\\/g, "/").toLowerCase();
  const text = (fn + " " + body.slice(0, 800)).toLowerCase();

  // Dot-convention: l9.skill.foo.md → skill
  const dotMatch = fn.match(/\.(skill|playbook|kernel|context|prompt|doctrine|test|script)\./);
  if (dotMatch) {
    const t = dotMatch[1] as ArtifactType;
    return { artifactType: t, family: detectFamily(text), signals: extractSignals(text), confidence: "high" };
  }

  // Prompt-*.md
  if (/^prompt-/.test(fn)) return { artifactType: "prompt", family: detectFamily(text), signals: extractSignals(text), confidence: "high" };

  // Path segment
  for (const ts of TYPE_SIGNALS) {
    if (ts.pathPatterns.some((p) => norm.includes(`/${p}/`))) {
      return { artifactType: ts.type, family: detectFamily(text), signals: extractSignals(text), confidence: "high" };
    }
  }

  // Keyword scoring
  let best: ArtifactType = "unknown";
  let bestScore = 0;
  for (const ts of TYPE_SIGNALS) {
    const score = ts.keywords.filter((k) => text.includes(k)).length;
    if (score > bestScore) { best = ts.type; bestScore = score; }
  }
  const conf = bestScore >= 2 ? "medium" : "low";
  return { artifactType: best, family: detectFamily(text), signals: extractSignals(text), confidence: conf };
}

function detectFamily(text: string): ArtifactFamily {
  for (const { family, keywords } of FAMILY_SIGNALS) {
    if (keywords.some((k) => text.includes(k))) return family;
  }
  return "Unknown";
}

function extractSignals(text: string): string[] {
  const signals: string[] = [];
  for (const { keywords } of FAMILY_SIGNALS) {
    for (const k of keywords) {
      if (text.includes(k) && !signals.includes(k)) signals.push(k);
    }
  }
  return signals.slice(0, 6);
}
