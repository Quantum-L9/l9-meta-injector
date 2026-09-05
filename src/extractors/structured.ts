// extractors/structured.ts — extractors over machine-readable declarations.
//
// These read manifests, service specs, and contract files. They report the
// fields those files state, and nothing else: no normalization of a package
// name into a service name, no merging of two action lists, no judgement about
// whether a declared dependency is actually used.
import { AssertionDraft, Extractor, ExtractorFileInput } from "../interpretation";
import { basenameIs, declared, keyValue, spanRange, stripComment, toLines, unquote } from "./common";

// ───────────────────────────── manifest/v1 ─────────────────────────────

/** Dependency names worth reporting as a framework or server declaration. */
const FRAMEWORK_DEPENDENCIES = new Set([
  "fastapi",
  "django",
  "flask",
  "starlette",
  "express",
  "next",
  "nestjs",
  "axum",
  "actix-web",
  "rocket",
]);
const SERVER_DEPENDENCIES = new Set(["uvicorn", "gunicorn", "hypercorn", "daphne", "waitress"]);

function pyprojectAssertions(lines: string[]): AssertionDraft[] {
  const drafts: AssertionDraft[] = [];
  let section = "";
  let sawPoetry = false;
  let sawBuildBackend = false;

  lines.forEach((line, index) => {
    const bare = stripComment(line).trim();
    const sectionMatch = /^\[([^\]]+)\]$/.exec(bare);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (section === "tool.poetry") sawPoetry = true;
      return;
    }
    const pair = /^([A-Za-z0-9_.\-]+)\s*=\s*(.+)$/.exec(bare);
    if (!pair) return;
    const key = pair[1];
    const rawValue = pair[2].trim();
    const value = unquote(rawValue);

    if ((section === "tool.poetry" || section === "project") && key === "name") {
      drafts.push(declared("package.name", value, index, line));
      return;
    }
    if (section === "build-system" && key === "build-backend") {
      sawBuildBackend = true;
      // `poetry.core.masonry.api` names the packaging system in use.
      const system = value.split(".")[0];
      drafts.push(declared("package.build_backend", value, index, line));
      if (system) drafts.push(declared("package.packaging_system", system, index, line));
      return;
    }
    if (section.endsWith("dependencies") || section === "tool.poetry.dependencies") {
      if (key === "python") {
        drafts.push(declared("package.python_constraint", value, index, line));
        return;
      }
      const name = key.toLowerCase();
      drafts.push(declared("package.dependency", name, index, line, "medium"));
      if (FRAMEWORK_DEPENDENCIES.has(name)) {
        drafts.push(declared("package.framework", name, index, line));
      }
      if (SERVER_DEPENDENCIES.has(name)) {
        drafts.push(declared("package.server", name, index, line));
      }
    }
  });

  // `[tool.poetry]` alone is a packaging declaration even without a build-system.
  if (sawPoetry && !sawBuildBackend) {
    const index = lines.findIndex((line) => stripComment(line).trim() === "[tool.poetry]");
    if (index >= 0) drafts.push(declared("package.packaging_system", "poetry", index, lines[index]));
  }
  return drafts;
}

function packageJsonAssertions(lines: string[]): AssertionDraft[] {
  const drafts: AssertionDraft[] = [];
  let section = "";
  lines.forEach((line, index) => {
    const bare = stripComment(line);
    const sectionMatch = /^\s*"(dependencies|devDependencies|peerDependencies)"\s*:\s*\{/.exec(bare);
    if (sectionMatch) {
      section = sectionMatch[1];
      return;
    }
    if (/^\s*\}/.test(bare)) section = "";
    const entry = /^\s*"([^"]+)"\s*:\s*"([^"]*)"/.exec(bare);
    if (!entry) return;
    const [, key, value] = entry;
    if (section === "") {
      if (key === "name") drafts.push(declared("package.name", value, index, line));
      if (key === "version") drafts.push(declared("package.version", value, index, line));
      return;
    }
    if (section === "dependencies") {
      const name = key.toLowerCase();
      drafts.push(declared("package.dependency", name, index, line, "medium"));
      if (FRAMEWORK_DEPENDENCIES.has(name)) {
        drafts.push(declared("package.framework", name, index, line));
      }
      if (SERVER_DEPENDENCIES.has(name)) {
        drafts.push(declared("package.server", name, index, line));
      }
    }
  });
  return drafts;
}

function cargoAssertions(lines: string[]): AssertionDraft[] {
  const drafts: AssertionDraft[] = [];
  let section = "";
  lines.forEach((line, index) => {
    const bare = stripComment(line).trim();
    const sectionMatch = /^\[([^\]]+)\]$/.exec(bare);
    if (sectionMatch) {
      section = sectionMatch[1];
      return;
    }
    const pair = /^([A-Za-z0-9_.\-]+)\s*=\s*(.+)$/.exec(bare);
    if (!pair) return;
    const value = unquote(pair[2].trim());
    if (section === "package" && pair[1] === "name") {
      drafts.push(
        declared("package.name", value, index, line),
        declared("package.packaging_system", "cargo", index, line),
      );
    }
    if (section === "dependencies") {
      const name = pair[1].toLowerCase();
      drafts.push(declared("package.dependency", name, index, line, "medium"));
      if (FRAMEWORK_DEPENDENCIES.has(name)) {
        drafts.push(declared("package.framework", name, index, line));
      }
    }
  });
  return drafts;
}

export const manifestExtractor: Extractor = {
  id: "manifest/v1",
  version: "1.0.0",
  matches(sourcePath) {
    return (
      basenameIs(sourcePath, "pyproject.toml") ||
      basenameIs(sourcePath, "package.json") ||
      basenameIs(sourcePath, "Cargo.toml")
    );
  },
  extract(input: ExtractorFileInput) {
    const lines = toLines(input.content);
    if (basenameIs(input.sourcePath, "pyproject.toml")) return pyprojectAssertions(lines);
    if (basenameIs(input.sourcePath, "package.json")) return packageJsonAssertions(lines);
    return cargoAssertions(lines);
  },
};

// ───────────────────────────── service-spec/v1 ─────────────────────────────

export const serviceSpecExtractor: Extractor = {
  id: "service-spec/v1",
  version: "1.0.0",
  matches(sourcePath) {
    return basenameIs(sourcePath, "spec.yaml") || basenameIs(sourcePath, "spec.yml");
  },
  extract(input: ExtractorFileInput) {
    const drafts: AssertionDraft[] = [];
    const lines = toLines(input.content);
    let block: "service" | "actions" | null = null;

    lines.forEach((line, index) => {
      const pair = keyValue(line);
      if (!pair) return;
      if (pair.indent === 0) {
        if (pair.key === "service") block = "service";
        else if (pair.key === "actions") block = "actions";
        else block = null;
        return;
      }
      if (block === "service") {
        if (pair.key === "name" && pair.value) {
          drafts.push(declared("service.name", pair.value, index, line));
        }
        if (pair.key === "version" && pair.value) {
          drafts.push(declared("service.version", pair.value, index, line));
        }
        return;
      }
      if (block === "actions" && pair.key === "name" && pair.value) {
        // A list item under `actions:` names one action the spec declares.
        if (/^\s*-\s+/.test(stripComment(line))) {
          drafts.push(declared("service.action", pair.value, index, line));
        }
      }
    });
    return drafts;
  },
};

// ─────────────────────── contract-invariants/v1 ───────────────────────

/**
 * Invariant vocabulary this profile recognizes.
 *
 * Each entry names a canonical predicate object and the phrases that evidence
 * it. The extractor reports only that the contract file states the invariant —
 * never that the repository upholds it.
 */
const INVARIANT_RULES: { object: string; patterns: RegExp[] }[] = [
  {
    object: "gate-compatible-ingress",
    patterns: [
      /\bgate[- ]compatible\b/i,
      /\bthrough\s+(?:the\s+)?gate\b/i,
      /\bgate\s+ingress\b/i,
      /\benters?\s+through\s+gate\b/i,
    ],
  },
  {
    object: "tenant-context-immutable",
    patterns: [/\btenant[_ ]context\b[^.\n]*\bimmutable\b/i, /\bimmutable\b[^.\n]*\btenant\b/i],
  },
  {
    object: "packets-derived-not-mutated",
    patterns: [
      /\bderivation\b[^.\n]*\b(?:not|never)\b[^.\n]*\bmutat/i,
      /\bderived?\b[^.\n]*\brather\s+than\b[^.\n]*\bmutat/i,
      /\bderived?,?\s+(?:not|never)\s+mutat/i,
      /\bnever\s+mutat/i,
    ],
  },
  {
    object: "replay-is-explicit",
    patterns: [/\breplay\b[^.\n]*\bexplicit\b/i, /\bexplicit\b[^.\n]*\breplay\b/i],
  },
  {
    object: "lineage-is-reconstructable",
    patterns: [
      /\blineage\b[^.\n]*\breconstruct/i,
      /\breconstruct\w*\b[^.\n]*\blineage\b/i,
      /\blineage\b[^.\n]*\btraceable\b/i,
    ],
  },
];

export const contractInvariantsExtractor: Extractor = {
  id: "contract-invariants/v1",
  version: "1.0.0",
  matches(sourcePath) {
    return /^contracts\/.+\.(ya?ml|md)$/.test(sourcePath);
  },
  extract(input: ExtractorFileInput) {
    const drafts: AssertionDraft[] = [];
    const lines = toLines(input.content);
    // One assertion per invariant per file: the first line that evidences it.
    const claimed = new Set<string>();
    lines.forEach((line, index) => {
      for (const rule of INVARIANT_RULES) {
        if (claimed.has(rule.object)) continue;
        if (rule.patterns.some((pattern) => pattern.test(line))) {
          claimed.add(rule.object);
          drafts.push(declared("contract.invariant", rule.object, index, line));
        }
      }
    });
    if (drafts.length > 0) {
      drafts.push({
        predicate: "contract.declares_invariants",
        object: input.sourcePath,
        sourceRange: spanRange(0, Math.max(0, lines.length - 1)),
        evidenceExcerpt: `contract file stating ${drafts.length} recognized invariant(s)`,
        evidenceClass: "declared",
        authority: "source",
        confidence: "high",
      });
    }
    return drafts;
  },
};
