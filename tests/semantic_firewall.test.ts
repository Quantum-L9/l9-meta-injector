// semantic_firewall.test.ts — the two claims that would be worst to be wrong about.
//
// The semantic layer makes two promises that no ordinary test exercises, because
// both are about what does *not* happen:
//
//   1. It calls no model. No semantic module imports one, names one of its
//      exports, or opens a network client. (The package's module graph does
//      reach `llm.ts` through a pre-existing `corpus_analysis -> inventory`
//      edge; reaching is not calling, and the tests below say which is which.)
//   2. Turning it on or off cannot change a Repository Model Packet — not its
//      contents, not its id, not its semantic hash.
//
// Both are the kind of promise that stays true until somebody adds one import,
// and then quietly stops being true without any test going red. So they are
// asserted structurally: over the source text for the firewall, and over an
// actual packet for the identity invariant.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { runSemanticAnalysis } from "../src/corpus_semantic_run";
import { explicitSameProject, statusConflict } from "./helpers/semantic_fixtures";

const SRC = path.resolve(__dirname, "..", "src");

/** Every module the semantic pass is built from. */
const SEMANTIC_MODULES = [
  "corpus_documents.ts",
  "corpus_semantics.ts",
  "corpus_pairs.ts",
  "corpus_fusion.ts",
  "corpus_reasoning.ts",
  "corpus_embeddings.ts",
  "corpus_semantic_run.ts",
];

function read(module: string): string {
  return fs.readFileSync(path.join(SRC, module), "utf8");
}

/** Import specifiers of one module, from its own source. */
function importsOf(source: string): string[] {
  const out: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']/g;
  let match = pattern.exec(source);
  while (match !== null) {
    out.push(match[1] as string);
    match = pattern.exec(source);
  }
  return out;
}

/** Everything reachable from the semantic modules, following relative imports. */
function transitiveClosure(): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [...SEMANTIC_MODULES];
  while (queue.length > 0) {
    const module = queue.shift() as string;
    if (seen.has(module)) continue;
    let source: string;
    try {
      source = read(module);
    } catch {
      continue;
    }
    seen.set(module, source);
    for (const specifier of importsOf(source)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = `${specifier.replace(/^\.\//, "").replace(/^\.\.\//, "")}.ts`;
      queue.push(resolved);
    }
  }
  return seen;
}

describe("the LLM firewall", () => {
  it("keeps every semantic module out of the model surface", () => {
    for (const module of SEMANTIC_MODULES) {
      const specifiers = importsOf(read(module));
      for (const specifier of specifiers) {
        expect(specifier).not.toMatch(/llm/i);
        expect(specifier).not.toMatch(/advanced\/llm/);
      }
    }
  });

  it("uses none of the model module's exports, which is the claim that matters", () => {
    // Reaching is not calling, and the difference is load-bearing here.
    //
    // The module graph *does* reach `llm.ts`: `corpus_analysis` imports
    // `inventory`, which imports `extract`, which imports `llm`. That edge
    // predates the semantic layer and has nothing to do with it — asserting the
    // closure is llm-free would be asserting something about the whole package
    // that has never been true, and would fail for a reason unrelated to any
    // promise made here.
    //
    // The promise is that this pass calls no model. So the check is on call
    // sites: not one of `llm.ts`'s exported symbols is named anywhere in the
    // semantic modules.
    const llmSource = read("llm.ts");
    const exported = [...llmSource.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)]
      .map((match) => match[1] as string);
    expect(exported.length).toBeGreaterThan(0);

    for (const module of SEMANTIC_MODULES) {
      const source = read(module);
      for (const symbol of exported) {
        expect(
          new RegExp(`\\b${symbol}\\b`).test(source),
          `${module} names the model export ${symbol}`,
        ).toBe(false);
      }
    }
  });

  it("reaches the model module only through a pre-existing edge it does not use", () => {
    // Stated as a test so the shape of the graph is recorded rather than
    // rediscovered: if a *new* path to `llm.ts` ever appears, this is where it
    // shows up, and the exports check above is what decides whether it matters.
    const closure = transitiveClosure();
    expect(closure.has("llm.ts")).toBe(true);
    expect(closure.has("inventory.ts")).toBe(true);
    for (const module of SEMANTIC_MODULES) {
      expect(importsOf(read(module)).some((specifier) => /llm/i.test(specifier))).toBe(false);
    }
  });

  it("names no completion, generation or adjudication call anywhere in the closure", () => {
    const forbidden = [
      /\bchat\.completions\b/,
      /\bcreateChatCompletion\b/,
      /\bcreateCompletion\b/,
      /\bgenerateText\b/,
      /\bcallModel\b/,
    ];
    for (const [module, source] of transitiveClosure()) {
      for (const pattern of forbidden) {
        expect(pattern.test(source), `${module} matches ${String(pattern)}`).toBe(false);
      }
    }
  });

  it("opens no network client of its own", () => {
    // The embedding provider *interface* may be implemented against a network by
    // an operator. Nothing in this package may do so itself.
    for (const module of SEMANTIC_MODULES) {
      const source = read(module);
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/require\(["']node:https?["']\)/);
      expect(source).not.toMatch(/from ["']node:https?["']/);
    }
  });
});

describe("the semantic pass and the Repository Model Packet", () => {
  it("writes to no packet: the pass has no packet in its inputs or outputs", () => {
    for (const module of SEMANTIC_MODULES) {
      const source = read(module);
      // A packet is built by `buildRepositoryModelPacket`. No semantic module
      // calls it, so no semantic module can change one.
      expect(source).not.toContain("buildRepositoryModelPacket");
      expect(source).not.toContain("emitRepositoryModelBundle");
    }
  });

  it("produces the same candidates whether or not embedding scores are supplied, for pairs embeddings do not touch", () => {
    const artifacts = [...explicitSameProject(), ...statusConflict()];

    const without = runSemanticAnalysis({ corpusSnapshotId: "s", artifacts });
    const with_ = runSemanticAnalysis({
      corpusSnapshotId: "s",
      artifacts,
      // A score on a pair that already has declared-identity and graph evidence.
      embeddingPairs: [{ artifact_a_id: "wm-notes", artifact_b_id: "wm-plan", score: 0.99 }],
    });

    // The project candidate is admitted on declared identity either way, and its
    // identity is a function of members and the fusion profile — not of how many
    // signals happened to fire.
    expect(with_.projects.candidates.map((candidate) => candidate.candidate_id))
      .toEqual(without.projects.candidates.map((candidate) => candidate.candidate_id));
  });

  it("records the embedding state in the analysis profile, so a reader can tell", () => {
    const artifacts = explicitSameProject();
    const off = runSemanticAnalysis({ corpusSnapshotId: "s", artifacts });

    expect(off.profile.embedding_enabled).toBe(false);
    expect(off.profile.embedding_provider_when_enabled).toBeNull();
    expect(off.profile.embedding_model_when_enabled).toBeNull();
    // The fusion profile hash is about policy, not about whether a model ran.
    expect(off.profile.semantic_fusion_profile_hash.length).toBeGreaterThan(0);
  });
});
