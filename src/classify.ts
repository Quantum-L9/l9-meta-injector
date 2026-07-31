import * as path from "path";
import { ClassifyResult, ArtifactType, ArtifactFamily, HeaderConvention, ArtifactClassification } from "./schema";
import { FRONTMATTER_EXTS } from "./comment";
import { classifyArtifact } from "./artifact_class";

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
  // "decisions"/"adr" covers the standard Architecture Decision Record convention
  // (docs/decisions/NNN-title.md) — a governance artifact by structure, independent of
  // prose content. Without the path signal, ADRs fall through to keyword-bag scoring,
  // which is fragile: ADRs share the same template (Status/Date/Context/Decision/
  // Consequences), so a single incidental word (e.g. "test", "engine") can tip an ADR
  // into an unrelated, inconsistent type across a semantically-identical document set.
  { type: "doctrine",  keywords: ["doctrine", "governance", "policy", "principle", "standard"],pathPatterns: ["doctrines", "doctrine", "decisions", "decision", "adr"] },
  { type: "test",      keywords: ["test", "spec", "fixture", "mock"],                          pathPatterns: ["tests", "test", "__tests__"] },
  { type: "script",    keywords: ["script", "utility", "helper", "tool"],                      pathPatterns: ["scripts", "script"] },
  { type: "prompt",    keywords: [],                                                             pathPatterns: ["prompts", "prompt"] },
  { type: "skill",     keywords: ["skill", "capability", "function", "action", "operation"],   pathPatterns: ["skills", "skill"] },
];

/** Types that block pipeline injection — keyword-only assignment needs a high bar (ADR-018). */
const NON_INJECTABLE_TYPES = new Set<ArtifactType>(["test", "script"]);

/**
 * Strong companions for keyword-only `test`/`script`. Ambiguous tokens alone
 * (`test`/`spec`/`tool`/`script` in ordinary prose or filenames like "Tool Search")
 * are not enough at score 2 — need a strong hit or score ≥ 3 (ADR-018).
 */
const STRONG_NON_INJECTABLE_KEYWORDS: Record<"test" | "script", ReadonlySet<string>> = {
  test: new Set(["fixture", "mock"]),
  script: new Set(["utility", "helper"]),
};

/** Word-boundary match for ASCII taxonomy tokens on already-lowercased text. */
export function keywordHit(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:[^a-z0-9_]|$)`).test(text);
}

function scoreType(text: string, keywords: string[]): { score: number; hits: string[] } {
  const hits = keywords.filter((k) => keywordHit(text, k));
  return { score: hits.length, hits };
}

/**
 * Keyword-only test/script is accepted only when score ≥ 2 and either a strong
 * companion keyword hit or score ≥ 3 (avoids medium false positives like
 * filename "tool" + incidental "script").
 */
function acceptKeywordNonInjectable(type: "test" | "script", score: number, hits: string[]): boolean {
  if (score < 2) return false;
  if (score >= 3) return true;
  const strong = STRONG_NON_INJECTABLE_KEYWORDS[type];
  return hits.some((h) => strong.has(h));
}

function scoreBest(
  text: string,
  types: Array<{ type: ArtifactType; keywords: string[] }>,
): { best: ArtifactType; bestScore: number; hits: string[] } {
  let best: ArtifactType = "context";
  let bestScore = 0;
  let hits: string[] = [];
  for (const ts of types) {
    const scored = scoreType(text, ts.keywords);
    if (scored.score > bestScore) {
      best = ts.type;
      bestScore = scored.score;
      hits = scored.hits;
    }
  }
  return { best, bestScore, hits };
}

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

  // Non-prose files (code, config, markup, data) are "source" — injectable, but the
  // prose taxonomy (skill/kernel/test/script/…) and its keyword/path heuristics only
  // make sense for markdown/txt artifacts and must not be applied to code. (An explicit
  // dot-convention name like `foo.skill.ts` still wins above.)
  const ext = path.extname(filePath).toLowerCase();
  if (!FRONTMATTER_EXTS.has(ext)) {
    return { artifactType: "source", family: detectFamily(text), signals: extractSignals(text), confidence: "low" };
  }

  // --- markdown/txt only, below ---

  // Path segment
  for (const ts of TYPE_SIGNALS) {
    if (ts.pathPatterns.some((p) => norm.includes(`/${p}/`))) {
      return { artifactType: ts.type, family: detectFamily(text), signals: extractSignals(text), confidence: "high" };
    }
  }

  // Keyword scoring (prose taxonomy). Scanned markdown with no strong type signal
  // defaults to injectable "context" (ADR-018) — not "unknown".
  const { best: rawBest, bestScore, hits } = scoreBest(text, TYPE_SIGNALS);
  let best = rawBest;
  let score = bestScore;

  if (NON_INJECTABLE_TYPES.has(best) && (best === "test" || best === "script")) {
    if (!acceptKeywordNonInjectable(best, score, hits)) {
      // Demote weak/ambiguous non-injectable wins to the best injectable type, or context.
      const injectableTypes = TYPE_SIGNALS.filter((ts) => !NON_INJECTABLE_TYPES.has(ts.type));
      const next = scoreBest(text, injectableTypes);
      best = next.bestScore > 0 ? next.best : "context";
      score = next.bestScore > 0 ? next.bestScore : 0;
    }
  }

  if (score === 0) {
    best = "context";
  }

  const conf = score >= 2 ? "medium" : "low";
  return { artifactType: best, family: detectFamily(text), signals: extractSignals(text), confidence: conf };
}

/** A ClassifyResult augmented with the 17-class semantic classification. */
export interface ClassifyResultWithClass extends ClassifyResult {
  semantic: ArtifactClassification;
}

/**
 * Additive companion to {@link classify}: returns the exact same coarse
 * classification plus the fine-grained 17-class semantic classification.
 * `classify()` itself is left unchanged.
 */
export function classifyWithSemantics(
  filePath: string,
  body: string,
  hc: HeaderConvention
): ClassifyResultWithClass {
  return { ...classify(filePath, body, hc), semantic: classifyArtifact(filePath, body) };
}

function detectFamily(text: string): ArtifactFamily {
  for (const { family, keywords } of FAMILY_SIGNALS) {
    if (keywords.some((k) => keywordHit(text, k))) return family;
  }
  return "Unknown";
}

function extractSignals(text: string): string[] {
  const signals: string[] = [];
  for (const { keywords } of FAMILY_SIGNALS) {
    for (const k of keywords) {
      if (keywordHit(text, k) && !signals.includes(k)) signals.push(k);
    }
  }
  return signals.slice(0, 6);
}
