// classify() (the coarse 8-type artifact classifier that gates injectability via
// PRIMITIVE_TAXONOMY) previously had no dedicated unit test — only exercised
// incidentally inside inject.test.ts/inject_body_preservation.test.ts for unrelated
// injection-mechanics assertions. That gap let a real classification bug ship: ADR
// documents under docs/decisions/**, which all share one template (Status/Date/
// Context/Decision/Consequences), scored 4 different, mutually-inconsistent, mostly
// wrong types (kernel/context/test) purely from incidental keyword collisions (e.g.
// "engine"/"runtime" → kernel, "test suite" → test) because no path-pattern signal
// existed for the ADR convention. These tests lock the fix and cover the classifier's
// three decision tiers (dot-convention, path-pattern, keyword-fallback) plus the
// genuine "unknown" floor.
import { classify } from "../src/classify";

describe("classify — dot-convention (highest priority, high confidence)", () => {
  it("l9.skill.foo.md → skill", () => {
    expect(classify("/repo/l9.skill.foo.md", "anything", "none").artifactType).toBe("skill");
  });
  it("Prompt-Foo.md → prompt", () => {
    expect(classify("/repo/Prompt-Foo.md", "anything", "none").artifactType).toBe("prompt");
  });
});

describe("classify — non-prose files always classify as source (low confidence)", () => {
  it("a .ts file is never routed through prose path/keyword taxonomy", () => {
    // Body deliberately full of doctrine/kernel/test keywords — must not leak into
    // artifact_type for a non-frontmatter extension (matches namespace.ts's identical
    // FRONTMATTER_EXTS guard for sharing_scope; see tests/namespace.test.ts).
    const r = classify("/repo/tools/consolidation/core/engine.ts", "kernel runtime engine test doctrine", "none");
    expect(r.artifactType).toBe("source");
    expect(r.confidence).toBe("low");
  });
});

describe("classify — path-pattern signals (high confidence, prose files only)", () => {
  it.each([
    ["/repo/skills/foo.md", "skill"],
    ["/repo/playbooks/foo.md", "playbook"],
    ["/repo/kernels/foo.md", "kernel"],
    ["/repo/contexts/foo.md", "context"],
    ["/repo/doctrines/foo.md", "doctrine"],
    ["/repo/tests/foo.md", "test"],
    ["/repo/scripts/foo.md", "script"],
    ["/repo/prompts/foo.md", "prompt"],
  ])("%s → %s", (p, expected) => {
    expect(classify(p, "irrelevant body text", "none").artifactType).toBe(expected);
  });

  // Regression: docs/decisions/NNN-*.md (ADR convention) must classify as doctrine via
  // path pattern, not fall through to fragile keyword-bag scoring.
  it("docs/decisions/*.md classifies as doctrine regardless of incidental body keywords", () => {
    const adrBody = [
      "# ADR-010: Use the TypeScript pipeline as the sole active engine",
      "## Status", "Accepted (retrospective)",
      "## Context",
      "Operating them as peer runtimes would create competing test suites and check gates.",
    ].join("\n");
    const r = classify("/repo/docs/decisions/010-example.md", adrBody, "none");
    expect(r.artifactType).toBe("doctrine");
    expect(r.confidence).toBe("high");
  });

  it("a generic /adr/ folder convention also classifies as doctrine", () => {
    expect(classify("/repo/adr/0001-example.md", "irrelevant", "none").artifactType).toBe("doctrine");
  });
});

describe("classify — keyword-bag fallback (no path pattern match)", () => {
  it("scores the best-matching type at medium confidence when >=2 keywords hit", () => {
    const r = classify("/repo/docs/notes.md", "This kernel document describes the runtime engine.", "none");
    expect(r.artifactType).toBe("kernel");
    expect(r.confidence).toBe("medium");
  });
  it("scores at low confidence when exactly 1 keyword hits", () => {
    const r = classify("/repo/docs/notes.md", "This document has some context worth reading.", "none");
    expect(r.artifactType).toBe("context");
    expect(r.confidence).toBe("low");
  });
  it("stays unknown when zero taxonomy keywords are present anywhere", () => {
    const r = classify("/repo/docs/notes.md", "Lorem ipsum dolor sit amet, consectetur adipiscing elit.", "none");
    expect(r.artifactType).toBe("unknown");
    expect(r.confidence).toBe("low");
  });
});
