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
// injectable "context" floor for unscored prose (ADR-018).
import { classify, keywordHit } from "../src/classify";
import { PRIMITIVE_TAXONOMY } from "../src/schema";

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

  it("path /tests/ stays non-injectable test even when body has no keywords", () => {
    const r = classify("/repo/tests/foo.md", "plain body", "none");
    expect(r.artifactType).toBe("test");
    expect(PRIMITIVE_TAXONOMY.test.injectable).toBe(false);
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
  it("defaults to injectable context when zero taxonomy keywords are present", () => {
    const r = classify("/repo/docs/notes.md", "Lorem ipsum dolor sit amet, consectetur adipiscing elit.", "none");
    expect(r.artifactType).toBe("context");
    expect(r.confidence).toBe("low");
    expect(PRIMITIVE_TAXONOMY.context.injectable).toBe(true);
  });
});

describe("classify — ADR-018 word-boundary and non-injectable demotion", () => {
  it("keywordHit rejects substrings inside longer words", () => {
    expect(keywordHit("phases of testing validation", "test")).toBe(false);
    expect(keywordHit("comprehensive specification document", "spec")).toBe(false);
    expect(keywordHit("specific tooling ownership", "spec")).toBe(false);
    expect(keywordHit("specific tooling ownership", "tool")).toBe(false);
    expect(keywordHit("a test suite follows", "test")).toBe(true);
    expect(keywordHit("anthropic tool search", "tool")).toBe(true);
  });

  it("testing / specification / specific do not classify as test", () => {
    expect(classify("/repo/docs/evidence-report.md", "phases 3-6 (testing, validation, deployment)", "none").artifactType).not.toBe("test");
    expect(classify("/repo/docs/system.md", "create a comprehensive specification document that maps", "none").artifactType).not.toBe("test");
    expect(classify("/repo/docs/blueprint.md", "each with specific tooling, ownership", "none").artifactType).not.toBe("test");
  });

  it("tooling / Tool Search.md alone do not become script at score 1", () => {
    expect(classify("/repo/docs/notes.md", "layered tooling ownership", "none").artifactType).not.toBe("script");
    expect(classify("/repo/Tool Search/Anthropic Tool Search vs L9 Discovery.md", "comparison of discovery approaches", "none").artifactType).not.toBe("script");
  });

  it("ambiguous tool+script medium hit demotes away from non-injectable script", () => {
    const r = classify(
      "/repo/Tool Search/Anthropic Tool Search vs L9 Discovery.md",
      "Describe the tool with a natural language description of what it needs. Use a script when wiring packages.",
      "none",
    );
    expect(r.artifactType).not.toBe("script");
    expect(r.artifactType).not.toBe("test");
    expect(PRIMITIVE_TAXONOMY[r.artifactType]?.injectable).toBe(true);
  });

  it("single script mention demotes to injectable type", () => {
    const r = classify("/repo/docs/TEMPLATE.md", "write the final research prompt using a script instead of manually", "none");
    expect(r.artifactType).not.toBe("script");
    expect(PRIMITIVE_TAXONOMY[r.artifactType]?.injectable).toBe(true);
  });

  it("earned medium+ word-boundary test/script still classify when strong companions hit", () => {
    const testHit = classify("/repo/docs/notes.md", "This test fixture uses a mock for isolation.", "none");
    expect(testHit.artifactType).toBe("test");
    expect(testHit.confidence).toBe("medium");

    const scriptHit = classify("/repo/docs/notes.md", "A small utility helper script for operators.", "none");
    expect(scriptHit.artifactType).toBe("script");
    expect(scriptHit.confidence).toBe("medium");
  });

  it("test+spec alone (no strong companion) demotes; test+spec+fixture earns test", () => {
    expect(
      classify("/repo/docs/notes.md", "Cover the test and the spec carefully.", "none").artifactType,
    ).not.toBe("test");
    expect(
      classify("/repo/docs/notes.md", "Run the test with the spec and the fixture harness.", "none").artifactType,
    ).toBe("test");
  });
});
