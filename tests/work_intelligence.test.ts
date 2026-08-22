// work_intelligence.test.ts — what the text extractors will and will not claim.
//
// Half of these tests exist to hold a line rather than to prove a feature. An
// extractor that reads `Status: WIP` is easy; an extractor that reads it and
// still refuses to read "we drafted a complete guide" as a completed draft is the
// thing that makes the corpus worth trusting. The negative cases are therefore as
// load-bearing as the positive ones.
import { describe, expect, it } from "vitest";
import {
  documentStructureExtractor,
  workIntelligenceExtractor,
} from "../src/extractors/work_intelligence";
import type { AssertionDraft, Extractor } from "../src/interpretation";

function extract(extractor: Extractor, sourcePath: string, lines: string[]): AssertionDraft[] {
  return extractor.extract({
    subjectId: "artifact:test",
    sourcePath,
    content: `${lines.join("\n")}\n`,
    contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    pathExists: () => false,
  });
}

function objects(drafts: AssertionDraft[], predicate: string): string[] {
  return drafts.filter((draft) => draft.predicate === predicate).map((draft) => draft.object);
}

function structure(sourcePath: string, lines: string[]): AssertionDraft[] {
  return extract(documentStructureExtractor, sourcePath, lines);
}

function work(sourcePath: string, lines: string[]): AssertionDraft[] {
  return extract(workIntelligenceExtractor, sourcePath, lines);
}

describe("supported inputs", () => {
  it("claims the four text formats the profile reads and nothing else", () => {
    for (const claimed of ["a.md", "a.markdown", "a.txt", "a.rst", "docs/deep/a.md"]) {
      expect(workIntelligenceExtractor.matches(claimed), claimed).toBe(true);
      expect(documentStructureExtractor.matches(claimed), claimed).toBe(true);
    }
    // v1 adds no document-format extraction: these are observed by hash only.
    for (const refused of ["a.pdf", "a.docx", "a.pptx", "a.xlsx", "a.png", "a.ipynb", "a.py"]) {
      expect(workIntelligenceExtractor.matches(refused), refused).toBe(false);
      expect(documentStructureExtractor.matches(refused), refused).toBe(false);
    }
  });

  it("claims a virtual archive member by its member extension", () => {
    expect(workIntelligenceExtractor.matches("old.zip!/plans/world-model.md")).toBe(true);
    expect(workIntelligenceExtractor.matches("plans.md!/not-really")).toBe(false);
  });

  it("attaches its assertions to the artifact, never to the repository", () => {
    expect(workIntelligenceExtractor.subjectScope).toBe("artifact");
    expect(documentStructureExtractor.subjectScope).toBe("artifact");
  });
});

describe("titles", () => {
  it("reads a Markdown H1", () => {
    expect(objects(structure("a.md", ["# Corpus Plan", "", "body"]), "document.title"))
      .toEqual(["Corpus Plan"]);
  });

  it("reads a frontmatter title", () => {
    const drafts = structure("a.md", ["---", "title: Declared Title", "---", "", "body"]);
    expect(objects(drafts, "document.title")).toEqual(["Declared Title"]);
  });

  it("reads a plain-text Title field", () => {
    expect(objects(structure("a.txt", ["Title: Working Notes", "", "body"]), "document.title"))
      .toEqual(["Working Notes"]);
  });

  it("emits both titles when the two forms disagree", () => {
    const drafts = structure("a.md", ["---", "title: From Frontmatter", "---", "", "# From Heading"]);
    // Reconciliation is downstream. Choosing one here would erase the evidence
    // that the document contradicts itself.
    expect(objects(drafts, "document.title")).toEqual(["From Frontmatter", "From Heading"]);
  });

  it("emits no title when the document declares none", () => {
    expect(objects(structure("a.md", ["Some prose that mentions a title in passing."]), "document.title"))
      .toEqual([]);
  });

  it("reads headings with their level and exact line", () => {
    const drafts = structure("a.md", ["# Top", "", "## Second", "", "### Third"]);
    expect(objects(drafts, "document.heading")).toEqual(["H1: Top", "H2: Second", "H3: Third"]);
    const second = drafts.find((draft) => draft.object === "H2: Second");
    expect(second?.sourceRange).toEqual({ start_line: 3, end_line: 3 });
  });

  it("does not read a comment inside fenced code as a heading", () => {
    const drafts = structure("a.md", ["# Real", "", "```sh", "# not a heading", "```"]);
    expect(objects(drafts, "document.heading")).toEqual(["H1: Real"]);
  });
});

describe("declared status", () => {
  it("reads an explicit WIP", () => {
    expect(objects(work("a.md", ["Status: WIP"]), "work.status")).toEqual(["wip"]);
  });

  it("reads an explicit DRAFT through markdown emphasis", () => {
    expect(objects(work("a.md", ["**Status:** DRAFT"]), "work.status")).toEqual(["draft"]);
  });

  it("reads an explicit DONE and a decorated Complete", () => {
    expect(objects(work("a.md", ["State: done"]), "work.status")).toEqual(["done"]);
    expect(objects(work("a.md", ["Status: ✅ Complete"]), "work.status")).toEqual(["complete"]);
  });

  it("reads a frontmatter status and a leading admonition", () => {
    expect(objects(work("a.md", ["---", "status: blocked", "---", "", "body"]), "work.status"))
      .toEqual(["blocked"]);
    expect(objects(work("a.md", ["> **WIP**", "", "body"]), "work.status")).toEqual(["wip"]);
  });

  it("keeps both statuses when a document declares two", () => {
    const drafts = work("a.md", ["Status: WIP", "", "body", "", "Status: Complete"]);
    expect(objects(drafts, "work.status")).toEqual(["wip", "complete"]);
  });

  it("does not read an incidental use of the word draft as a status", () => {
    const drafts = work("a.md", [
      "# Weekly Sync",
      "",
      "We drafted a complete guide and the plan is basically done.",
      "This paragraph is still a draft in the loose sense.",
    ]);
    expect(objects(drafts, "work.status")).toEqual([]);
  });

  it("does not read an ordinary English title word as a status", () => {
    // "Complete Guide to Routing" is a title, not a completed document.
    expect(objects(work("a.md", ["# Complete Guide to Routing"]), "work.status")).toEqual([]);
    // A bracketed marker is a deliberate marker, and is read as one.
    expect(objects(work("a.md", ["# Routing Guide [DRAFT]"]), "work.status")).toEqual(["draft"]);
  });

  it("records a title marker with lower confidence than a status field", () => {
    const marker = work("a.md", ["# Routing Guide [DRAFT]"]).find((d) => d.predicate === "work.status");
    const field = work("a.md", ["Status: draft"]).find((d) => d.predicate === "work.status");
    expect(marker?.confidence).toBe("medium");
    expect(field?.confidence).toBe("high");
  });

  it("ignores a status value outside the declared vocabulary", () => {
    expect(objects(work("a.md", ["Status: mostly there"]), "work.status")).toEqual([]);
  });
});

describe("declared kind", () => {
  it("reads a roadmap named in an H1", () => {
    expect(objects(work("a.md", ["# Deployment Roadmap"]), "work.kind")).toEqual(["roadmap"]);
  });

  it("reads a plan declared in frontmatter", () => {
    const drafts = work("a.md", ["---", "kind: plan", "---", "", "body"]);
    expect(objects(drafts, "work.kind")).toEqual(["plan"]);
    expect(drafts.find((draft) => draft.predicate === "work.kind")?.confidence).toBe("high");
  });

  it("does not guess a kind from the body's theme", () => {
    const drafts = work("a.md", [
      "# Thursday",
      "",
      "We talked through the plan and the roadmap and roughly agreed a design.",
    ]);
    expect(objects(drafts, "work.kind")).toEqual([]);
  });

  it("reads a kind only where the title says what the document is", () => {
    // First or last word of the leading segment: those are the positions where a
    // kind word states what the document is rather than naming something in it.
    expect(objects(work("a.md", ["# Implementation Roadmap — 6-Phase Rollout"]), "work.kind"))
      .toEqual(["roadmap"]);
    expect(objects(work("a.md", ["# Plan for the migration"]), "work.kind")).toEqual(["plan"]);
    expect(objects(work("a.md", ["# L9 Conformance Checklist"]), "work.kind")).toEqual(["checklist"]);
    // Observed on a real repository: a research *agent* is not a piece of research.
    expect(objects(work("a.md", ["# L9 Perplexity Research Agent — Tech Debt Pipeline"]), "work.kind"))
      .toEqual([]);
    expect(objects(work("a.md", ["# The design review meeting notes template guide"]), "work.kind"))
      .toEqual([]);
  });
});

describe("tasks", () => {
  it("reads an unchecked checkbox as an open task", () => {
    expect(objects(work("a.md", ["- [ ] wire the thing"]), "work.task.open"))
      .toEqual(["wire the thing"]);
  });

  it("reads a checked checkbox as a completed task", () => {
    expect(objects(work("a.md", ["- [x] read the spec", "* [X] file the report"]), "work.task.completed"))
      .toEqual(["read the spec", "file the report"]);
  });

  it("reads an explicit TODO line", () => {
    expect(objects(work("a.md", ["TODO: file the report"]), "work.task.open"))
      .toEqual(["file the report"]);
  });

  it("does not read the word TODO inside a sentence as a task", () => {
    const drafts = work("a.md", [
      "The TODO list is long and every TODO in it is stale.",
      "Nothing here is a TODO: not really, anyway.",
    ]);
    // The second line does contain `TODO:` but not at the start of the line, so
    // it is prose about a TODO rather than a declared one.
    expect(objects(drafts, "work.task.open")).toEqual([]);
  });

  it("does not read a task inside fenced code", () => {
    expect(objects(work("a.md", ["```", "- [ ] example only", "```"]), "work.task.open")).toEqual([]);
  });

  it("cites the exact line of each task", () => {
    const drafts = work("a.md", ["intro", "", "- [ ] first", "- [ ] second"]);
    expect(drafts.filter((d) => d.predicate === "work.task.open").map((d) => d.sourceRange))
      .toEqual([{ start_line: 3, end_line: 3 }, { start_line: 4, end_line: 4 }]);
  });
});

describe("milestones", () => {
  it("reads a labelled milestone with and without a number", () => {
    expect(objects(work("a.md", ["Milestone: ship the reader"]), "work.milestone"))
      .toEqual(["ship the reader"]);
    expect(objects(work("a.md", ["Milestone 3: prove the consumer"]), "work.milestone"))
      .toEqual(["prove the consumer"]);
  });

  it("reads bullets under an explicit Milestones heading", () => {
    const drafts = work("a.md", [
      "# Roadmap",
      "",
      "## Milestones",
      "",
      "- first stage",
      "- [ ] second stage",
      "",
      "## Notes",
      "",
      "- not a milestone",
    ]);
    expect(objects(drafts, "work.milestone")).toEqual(["first stage", "second stage"]);
  });
});

describe("declared relations", () => {
  it("reads every prefix the profile recognizes", () => {
    const drafts = work("a.md", [
      "Depends on: alpha.md",
      "Depends upon: beta.md",
      "Requires: gamma.md",
      "Blocked by: the review",
      "Reference: one.md",
      "References: two.md",
      "See also: three.md",
      "Related: four.md",
      "Supersedes: old.md",
      "Replaces: older.md",
      "Superseded by: new.md",
      "Replaced by: newer.md",
    ]);
    expect(objects(drafts, "work.depends_on")).toEqual(["alpha.md", "beta.md", "gamma.md"]);
    expect(objects(drafts, "work.blocked_by")).toEqual(["the review"]);
    expect(objects(drafts, "work.references")).toEqual(["one.md", "two.md", "three.md", "four.md"]);
    expect(objects(drafts, "work.supersedes")).toEqual(["old.md", "older.md"]);
    expect(objects(drafts, "work.superseded_by")).toEqual(["new.md", "newer.md"]);
  });

  it("normalizes a declared target without interpreting it", () => {
    const drafts = work("a.md", [
      "Depends on: [the plan](docs/plan.md)",
      "Requires: `docs/other.md`",
      "Related: <https://example.invalid/x>",
    ]);
    expect(objects(drafts, "work.depends_on")).toEqual(["docs/plan.md", "docs/other.md"]);
    expect(objects(drafts, "work.references")).toEqual(["https://example.invalid/x"]);
  });

  it("does not read a sentence containing a colon as a declaration", () => {
    const drafts = work("a.md", [
      "See https://example.invalid/a: the trailing text is part of the sentence.",
      "Note that this requires: nothing in particular.",
    ]);
    expect(objects(drafts, "work.references")).toEqual([]);
    expect(objects(drafts, "work.depends_on")).toEqual([]);
  });
});

describe("hostile input", () => {
  // These documents come out of archives this package does not control, so a
  // pattern that degrades super-linearly on a crafted line is a denial of
  // service, not a style problem. Each case below measured in seconds — or in
  // hours, extrapolated — before the patterns were rewritten to be linear.
  // Sized so a quadratic pattern fails and a linear one passes with room to
  // spare. The interpretation size limit is 512 KiB, so a single line of this
  // length is well within what a document from an archive can carry.
  const BUDGET_MS = 2000;
  const HOSTILE_LENGTH = 120000;

  function within(budget: number, run: () => void): number {
    const started = Date.now();
    run();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(budget);
    return elapsed;
  }

  it("strips a long emphasis run without exponential backtracking", () => {
    // An ambiguous `(?:\*\*|__|\*|_)+` alternation doubled per character:
    // 30 asterisks took 40ms, and 50 would have taken hours.
    const line = `Depends on: ${"*".repeat(60)}x`;
    within(BUDGET_MS, () => work("a.md", [line]));
  });

  it("strips a long emphasis run without quadratic rescanning either", () => {
    // The first version of the test above used sixty characters, which is enough
    // to catch an exponential pattern and nowhere near enough to catch a
    // quadratic one: `[*_]+$` replaced the exponential alternation and still cost
    // eleven seconds at a hundred thousand characters, because `replace` retries
    // at every start position. Two orders of magnitude is the point of this case.
    const line = `Depends on: ${"*".repeat(HOSTILE_LENGTH)}x`;
    within(BUDGET_MS, () => work("a.md", [line]));
  });

  it("trims a long non-alphanumeric run around a status without stalling", () => {
    const line = `Status: ${"!".repeat(HOSTILE_LENGTH)}wip${"!".repeat(HOSTILE_LENGTH)}`;
    within(BUDGET_MS, () => {
      expect(objects(work("a.md", [line]), "work.status")).toEqual(["wip"]);
    });
  });

  it("trims a long closing hash run on a heading without stalling", () => {
    const line = `# Heading ${"#".repeat(HOSTILE_LENGTH)}`;
    within(BUDGET_MS, () => {
      expect(objects(structure("a.md", [line]), "document.heading")).toEqual(["H1: Heading"]);
    });
  });

  it("reads a heading whose trailing run is ambiguous without stalling", () => {
    // Measured at 26 seconds for this shape at 5,000 characters.
    const line = `# ${" ".repeat(HOSTILE_LENGTH / 2)}${"#".repeat(20)}${" ".repeat(HOSTILE_LENGTH / 2)}x`;
    within(BUDGET_MS, () => structure("a.md", [line]));
  });

  it("reads a title carrying a long whitespace run without stalling", () => {
    const line = `# Roadmap${" ".repeat(HOSTILE_LENGTH)}tail`;
    within(BUDGET_MS, () => work("a.md", [line]));
  });

  it("reads a frontmatter block with no colon on a long line without stalling", () => {
    const lines = ["---", `${"a".repeat(HOSTILE_LENGTH / 2)}${" ".repeat(HOSTILE_LENGTH / 2)}`, "status: wip", "---", "", "body"];
    within(BUDGET_MS, () => {
      expect(objects(work("a.md", lines), "work.status")).toEqual(["wip"]);
    });
  });

  it("still reads every construct correctly on ordinary input", () => {
    // The rewrite is only worth anything if it did not change what is read.
    expect(objects(structure("a.md", ["# Heading ###"]), "document.heading")).toEqual(["H1: Heading"]);
    expect(objects(structure("a.md", ["#  Spaced  Out  "]), "document.title")).toEqual(["Spaced Out"]);
    expect(objects(work("a.md", ["Depends on: **plan.md**"]), "work.depends_on")).toEqual(["plan.md"]);
    expect(objects(work("a.md", ["---", "status : wip", "---", "", "x"]), "work.status")).toEqual(["wip"]);
  });
});

describe("evidence", () => {
  it("cites the source line as the excerpt of every assertion", () => {
    const lines = ["---", "status: wip", "---", "", "# Plan", "", "- [ ] a task"];
    for (const draft of [...work("a.md", lines), ...structure("a.md", lines)]) {
      expect(lines[draft.sourceRange.start_line - 1]).toContain(draft.evidenceExcerpt.slice(0, 8));
      expect(draft.authority).toBe("source");
    }
  });
});
