// work_intelligence.test.ts — what the extractors read, and what they refuse to.
//
// The refusals matter as much as the readings: the value of this layer is that a
// status means the document wrote one down. Every "not captured" case below is a
// claim the corpus must never manufacture.
import {
  documentStructureExtractor,
  workIntelligenceExtractor,
} from "../src/extractors/work_intelligence";
import { AssertionDraft, Extractor } from "../src/interpretation";

const SUBJECT = "artifact:0000";

function run(extractor: Extractor, content: string, sourcePath = "doc.md"): AssertionDraft[] {
  return extractor.extract({
    subjectId: SUBJECT,
    sourcePath,
    content,
    contentHash: `sha256:${"0".repeat(64)}`,
    pathExists: () => false,
  });
}

function objectsFor(drafts: AssertionDraft[], predicate: string): string[] {
  return drafts.filter((draft) => draft.predicate === predicate).map((draft) => draft.object);
}

function structure(content: string, sourcePath?: string): AssertionDraft[] {
  return run(documentStructureExtractor, content, sourcePath);
}

function work(content: string, sourcePath?: string): AssertionDraft[] {
  return run(workIntelligenceExtractor, content, sourcePath);
}

describe("document structure", () => {
  it("reads a Markdown H1 as the title", () => {
    expect(objectsFor(structure("# Rollout Plan\n\nbody\n"), "document.title")).toEqual(["Rollout Plan"]);
  });

  it("reads a frontmatter title", () => {
    const drafts = structure("---\ntitle: Declared Title\n---\n\nbody\n");
    expect(objectsFor(drafts, "document.title")).toEqual(["Declared Title"]);
  });

  it("keeps punctuation inside a plain-text title intact", () => {
    expect(objectsFor(structure("Title: build_pipeline_v2 notes\n", "notes.txt"), "document.title"))
      .toEqual(["build_pipeline_v2 notes"]);
  });

  it("reads a plain-text Title: field", () => {
    expect(objectsFor(structure("Title: Notes On Cutover\n", "notes.txt"), "document.title"))
      .toEqual(["Notes On Cutover"]);
  });

  it("keeps both titles when the forms disagree", () => {
    const drafts = structure("---\ntitle: Frontmatter Name\n---\n\n# Heading Name\n");
    // Neither declaration is preferred: the contradiction is the finding.
    expect(objectsFor(drafts, "document.title").sort()).toEqual(["Frontmatter Name", "Heading Name"]);
  });

  it("emits no title when none is declared", () => {
    expect(objectsFor(structure("Some prose about a plan.\n"), "document.title")).toEqual([]);
  });

  it("captures every heading with its level and exact line", () => {
    const drafts = structure("# One\n\n## Two\n\n### Three\n");
    expect(objectsFor(drafts, "document.heading")).toEqual(["H1: One", "H2: Two", "H3: Three"]);
    const second = drafts.find((draft) => draft.object === "H2: Two");
    expect(second?.sourceRange).toEqual({ start_line: 3, end_line: 3 });
  });

  it("ignores headings inside fenced code", () => {
    const drafts = structure("# Real\n\n```\n# Not A Heading\n```\n");
    expect(objectsFor(drafts, "document.heading")).toEqual(["H1: Real"]);
  });

  it("does not read Markdown heading syntax in a .txt file", () => {
    expect(objectsFor(structure("# Not Markdown Here\n", "notes.txt"), "document.heading")).toEqual([]);
  });
});

describe("declared work status", () => {
  it("reads an explicit WIP label", () => {
    expect(objectsFor(work("Status: WIP\n"), "work.status")).toEqual(["wip"]);
  });

  it("reads a frontmatter status", () => {
    expect(objectsFor(work("---\nstatus: draft\n---\n\nbody\n"), "work.status")).toEqual(["draft"]);
  });

  it("reads a bolded State label", () => {
    expect(objectsFor(work("**State:** blocked\n"), "work.status")).toEqual(["blocked"]);
  });

  it("reads a leading admonition", () => {
    expect(objectsFor(work("> **DRAFT**\n\n# Thing\n"), "work.status")).toEqual(["draft"]);
  });

  it("reads a status marker in the title", () => {
    expect(objectsFor(work("# [WIP] Cutover\n"), "work.status")).toEqual(["wip"]);
  });

  it("keeps both statuses when a document contradicts itself", () => {
    const drafts = work("Status: WIP\n\nStatus: Complete\n");
    expect(objectsFor(drafts, "work.status")).toEqual(["wip", "complete"]);
  });

  it("does not turn the word draft in a sentence into a status", () => {
    expect(objectsFor(work("This is a draft of the argument, still in progress.\n"), "work.status")).toEqual([]);
  });

  it("does not invent a status from age, path, or an empty task list", () => {
    // No status label anywhere: a document with no open tasks is not "done".
    expect(objectsFor(work("# Old Notes\n\n- [x] shipped\n"), "work.status")).toEqual([]);
  });

  it("rejects a label whose value is not a known state", () => {
    expect(objectsFor(work("Status: mostly fine\n"), "work.status")).toEqual([]);
  });
});

describe("declared work kind", () => {
  it("reads a roadmap from the H1", () => {
    expect(objectsFor(work("# Deployment Roadmap\n"), "work.kind")).toEqual(["roadmap"]);
  });

  it("reads a plan from an explicit kind field", () => {
    expect(objectsFor(work("---\nkind: plan\n---\n\nbody\n"), "work.kind")).toEqual(["plan"]);
  });

  it("marks a title-derived kind as medium confidence", () => {
    const kind = work("# Migration Plan\n").find((draft) => draft.predicate === "work.kind");
    expect(kind?.confidence).toBe("medium");
  });

  it("marks a declared kind field as high confidence", () => {
    const kind = work("---\ntype: research\n---\n\nbody\n").find((draft) => draft.predicate === "work.kind");
    expect(kind?.confidence).toBe("high");
  });

  it("does not guess a kind from the body theme", () => {
    expect(objectsFor(work("# Tuesday\n\nWe should plan the roadmap for the design.\n"), "work.kind")).toEqual([]);
  });
});

describe("tasks", () => {
  it("reads an unchecked checkbox as an open task", () => {
    expect(objectsFor(work("- [ ] wire the adapter\n"), "work.task.open")).toEqual(["wire the adapter"]);
  });

  it("reads a checked checkbox as a completed task", () => {
    expect(objectsFor(work("- [x] wire the adapter\n"), "work.task.completed")).toEqual(["wire the adapter"]);
  });

  it("reads a TODO: line as an open task", () => {
    expect(objectsFor(work("TODO: rotate the key\n"), "work.task.open")).toEqual(["rotate the key"]);
  });

  it("does not turn the word TODO inside a paragraph into a task", () => {
    expect(objectsFor(work("There is a TODO somewhere in the handler.\n"), "work.task.open")).toEqual([]);
  });

  it("ignores checkbox syntax inside fenced code", () => {
    expect(objectsFor(work("```\n- [ ] example syntax\n```\n"), "work.task.open")).toEqual([]);
  });

  it("cites the exact line of each task", () => {
    const drafts = work("# Plan\n\n- [ ] first\n- [ ] second\n");
    const second = drafts.find((draft) => draft.object === "second");
    expect(second?.sourceRange).toEqual({ start_line: 4, end_line: 4 });
  });
});

describe("milestones", () => {
  it("reads a labelled milestone", () => {
    expect(objectsFor(work("Milestone: private beta\n"), "work.milestone")).toEqual(["private beta"]);
  });

  it("reads a numbered milestone", () => {
    expect(objectsFor(work("Milestone 2: general availability\n"), "work.milestone")).toEqual(["general availability"]);
  });

  it("reads bullets under a Milestones heading", () => {
    const drafts = work("## Milestones\n\n- alpha\n- beta\n\n## Other\n\n- not a milestone\n");
    expect(objectsFor(drafts, "work.milestone")).toEqual(["alpha", "beta"]);
  });
});

describe("declared relationships", () => {
  it.each([
    ["Depends on: packet schema", "work.depends_on", "packet schema"],
    ["Requires: the adapter", "work.depends_on", "the adapter"],
    ["Blocked by: review", "work.blocked_by", "review"],
    ["References: docs/architecture.md", "work.references", "docs/architecture.md"],
    ["See also: notes.txt", "work.references", "notes.txt"],
    ["Supersedes: old-plan.md", "work.supersedes", "old-plan.md"],
    ["Superseded by: new-plan.md", "work.superseded_by", "new-plan.md"],
    ["Replaced by: new-plan.md", "work.superseded_by", "new-plan.md"],
  ])("reads %s", (line, predicate, object) => {
    expect(objectsFor(work(`${line}\n`), predicate)).toEqual([object]);
  });

  it("keeps punctuation inside a declared target intact", () => {
    // Found on a real repository: stripping emphasis markers globally turned
    // `l9_constellation_topology_nuclear_coding_contract` into an identifier
    // that exists nowhere. Only wrapping markers may be removed.
    expect(objectsFor(work("Supersedes: l9_constellation_topology_nuclear_coding_contract v4.0.0\n"), "work.supersedes"))
      .toEqual(["l9_constellation_topology_nuclear_coding_contract v4.0.0"]);
  });

  it("still strips emphasis that wraps a declared target", () => {
    expect(objectsFor(work("- **Supersedes:** [ADR-0020](0020-delegate-planning.md) in part\n"), "work.supersedes"))
      .toEqual(["[ADR-0020](0020-delegate-planning.md) in part"]);
  });

  it("does not read Superseded by as a supersedes claim", () => {
    // The labels share a prefix; reading the shorter one first would reverse
    // the direction of the relationship.
    const drafts = work("Superseded by: new-plan.md\n");
    expect(objectsFor(drafts, "work.supersedes")).toEqual([]);
  });
});

describe("evidence discipline", () => {
  it("attaches source authority and declared class to every assertion", () => {
    const drafts = work("---\nstatus: wip\n---\n\n# Plan\n\n- [ ] task\n");
    expect(drafts.length).toBeGreaterThan(0);
    for (const item of drafts) {
      expect(item.authority).toBe("source");
      expect(item.evidenceClass).toBe("declared");
      expect(item.sourceRange.start_line).toBeGreaterThan(0);
      expect(item.evidenceExcerpt.length).toBeGreaterThan(0);
    }
  });

  it("claims the text extensions it can read and no others", () => {
    for (const good of ["a.md", "a.markdown", "a.txt", "a.rst"]) {
      expect(workIntelligenceExtractor.matches(good)).toBe(true);
      expect(documentStructureExtractor.matches(good)).toBe(true);
    }
    for (const bad of ["a.pdf", "a.docx", "a.png", "a.py"]) {
      expect(workIntelligenceExtractor.matches(bad)).toBe(false);
    }
  });

  it("is artifact-scoped, so its claims describe the file and not the repository", () => {
    expect(workIntelligenceExtractor.subjectScope).toBe("artifact");
    expect(documentStructureExtractor.subjectScope).toBe("artifact");
  });

  it("returns the same drafts for the same bytes", () => {
    const content = "---\nstatus: wip\ntitle: Plan\n---\n\n# Plan\n\n- [ ] one\n- [x] two\n\nDepends on: x\n";
    expect(work(content)).toEqual(work(content));
  });
});
