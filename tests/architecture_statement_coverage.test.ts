// architecture_statement_coverage.test.ts — the coverage matrix, executed.
//
// `docs/architecture-evidence-coverage.md` states which written forms the
// architecture-statement reader recognizes, which it refuses, and what each one
// yields. A table nobody runs drifts from the code it describes, so every row
// here is a fixture: the supported forms are read through the real scan from
// real files and their coordinates are checked against those files, and the
// unsupported forms are asserted to yield nothing but their diagnostic.
//
// Identity is the other half. A statement these rules read the same way as the
// previous reader must keep its evidence id, so the id is shown to be a function
// of the record's own fields and of nothing versioned.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  ARCHITECTURE_EVIDENCE_PROFILE_VERSION,
  architectureEvidenceProfileHash,
} from "../src/corpus_architecture_evidence";
import type { ArchitectureEvidenceRecord } from "../src/corpus_architecture_evidence";
import { runCorpusScan } from "../src/corpus_scan";
import type { CorpusScanResult } from "../src/corpus_scan";
import {
  ARCHITECTURE_STATEMENT_EXTRACTOR_ID,
  ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION,
  architecturePseudoHeadingLabel,
  architectureStatementLocator,
  readArchitectureStatements,
} from "../src/extractors/architecture_statements";
import { stableId } from "../src/repository_model";
import { writeDocx } from "./helpers/document_fixtures";

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-arch-coverage-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function write(root: string, relative: string, contents: string): void {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents, "utf8");
}

const L = (start: number, end: number) => ({ kind: "line_span" as const, line_start: start, line_end: end });

/**
 * One Markdown document carrying every supported form once, each at a known
 * line, so a record's coordinate can be checked by number and by content.
 */
const MATRIX = [
  /*  1 */ "---",
  /*  2 */ "type: proposal",
  /*  3 */ "status: wip",
  /*  4 */ "decision: Frontmatter decisions are read too.",
  /*  5 */ "---",
  /*  6 */ "# Coverage Matrix",
  /*  7 */ "",
  /*  8 */ "Objective: One field label on one line.",
  /*  9 */ "",
  /* 10 */ "Assumption: A field label whose statement",
  /* 11 */ "continues on the next soft-wrapped line.",
  /* 12 */ "",
  /* 13 */ "Constraints:",
  /* 14 */ "- The first item of a colon-opened list.",
  /* 15 */ "- The second item of a colon-opened list.",
  /* 16 */ "",
  /* 17 */ "## 2. Open Questions (v2)",
  /* 18 */ "",
  /* 19 */ "- A numbered, qualified heading still names its section?",
  /* 20 */ "",
  /* 21 */ "A paragraph under that heading is one statement too.",
  /* 22 */ "",
  /* 23 */ "**Decisions**",
  /* 24 */ "",
  /* 25 */ "- A bold bare label opens a section like a heading.",
  /* 26 */ "",
  /* 27 */ "3.1 Invariants",
  /* 28 */ "",
  /* 29 */ "- A numbered bare label opens a section like a heading.",
  /* 30 */ "",
  /* 31 */ "## Decisions — phase 2",
  /* 32 */ "",
  /* 33 */ "| decision | owner |",
  /* 34 */ "| --- | --- |",
  /* 35 */ "| a table is not a statement | mel |",
  /* 36 */ "",
  /* 37 */ "Owner: mel",
  /* 38 */ "",
  /* 39 */ "## Questions",
  /* 40 */ "",
  /* 41 */ "- A bare Questions heading is not in the vocabulary.",
  /* 42 */ "",
  /* 43 */ "Unresolved:",
  /* 44 */ "",
  /* 45 */ "## Goals",
  /* 46 */ "",
  /* 47 */ "```",
  /* 48 */ "Decision: inside a fence, never read",
  /* 49 */ "```",
  /* 50 */ "",
].join("\n");

async function scanMatrix(): Promise<{ root: string; result: CorpusScanResult; records: ArchitectureEvidenceRecord[] }> {
  const root = path.join(tmp(), "Matrix");
  fs.mkdirSync(root);
  write(root, "matrix.md", MATRIX);
  writeDocx(path.join(root, "spec.docx"), {
    title: "Numbered Specification",
    headings: ["3. Invariants (transport)"],
    paragraphs: ["Every packet change uses derive().", "Decision: Gate is the only routing authority."],
  });
  const result = await runCorpusScan({ roots: [{ path: root, name: "Matrix" }], producerVersion: "test", architectureEvidence: true });
  const records = result.architectureEvidence?.records ?? [];
  return { root, result, records };
}

function lines(root: string, record: ArchitectureEvidenceRecord): string[] {
  const locator = record.structured_locator as { line_start: number; line_end: number };
  const all = fs.readFileSync(path.join(root, record.source_path), "utf8").split("\n");
  return all.slice(locator.line_start - 1, locator.line_end);
}

describe("supported forms — one record each, at the cited coordinate", () => {
  it("reads every supported form from a real file and cites the lines that hold it", async () => {
    const { root, records } = await scanMatrix();
    const markdown = records.filter((record) => record.source_path === "matrix.md");
    const rows = markdown
      .map((record) => ({
        form: record.recognition.form,
        label: record.recognition.label,
        cls: record.statement_class,
        text: record.declared_text,
        start: (record.structured_locator as { line_start: number }).line_start,
        end: (record.structured_locator as { line_end: number }).line_end,
        units: record.unit_count,
      }))
      .sort((a, b) => a.start - b.start);
    expect(rows).toEqual([
      { form: "frontmatter_field", label: "decision", cls: "decision_statement", text: "Frontmatter decisions are read too.", start: 4, end: 4, units: 1 },
      { form: "field_label", label: "objective", cls: "intent", text: "One field label on one line.", start: 8, end: 8, units: 1 },
      { form: "field_label", label: "assumption", cls: "assumption", text: "A field label whose statement continues on the next soft-wrapped line.", start: 10, end: 11, units: 2 },
      { form: "label_list", label: "constraints", cls: "constraint", text: "The first item of a colon-opened list.", start: 14, end: 14, units: 1 },
      { form: "label_list", label: "constraints", cls: "constraint", text: "The second item of a colon-opened list.", start: 15, end: 15, units: 1 },
      { form: "section_heading", label: "open questions", cls: "open_question", text: "A numbered, qualified heading still names its section?", start: 19, end: 19, units: 1 },
      { form: "section_heading", label: "open questions", cls: "open_question", text: "A paragraph under that heading is one statement too.", start: 21, end: 21, units: 1 },
      { form: "section_heading", label: "decisions", cls: "decision_statement", text: "A bold bare label opens a section like a heading.", start: 25, end: 25, units: 1 },
      { form: "section_heading", label: "invariants", cls: "constraint", text: "A numbered bare label opens a section like a heading.", start: 29, end: 29, units: 1 },
    ]);
    // Every cited span holds the excerpt, read back from the file by line number.
    for (const record of markdown) {
      const cited = lines(root, record).join("\n").replace(/\s+/g, " ").trim();
      expect(cited).toContain(record.bounded_excerpt.replace(/^- /, ""));
      expect(cited).toContain(record.declared_text.split(" ")[0] as string);
    }
  });

  it("reads a numbered, qualified heading in a Word document at its block", async () => {
    const { records } = await scanMatrix();
    const docx = records.filter((record) => record.source_path === "spec.docx");
    expect(docx.map((record) => [record.statement_class, record.recognition.form, record.recognition.label, record.declared_text]).sort()).toEqual([
      ["constraint", "section_heading", "invariants", "Every packet change uses derive()."],
      ["decision_statement", "field_label", "decision", "Gate is the only routing authority."],
    ]);
    for (const record of docx) {
      expect(record.structured_locator.kind).toBe("docx_block");
      expect(record.unit_count).toBe(1);
      // A paragraph under a section is one whole-block statement (no unit offset);
      // a labelled field inside a block starts on its own line.
      expect(record.unit_index).toBe(record.recognition.form === "field_label" ? 0 : null);
    }
  });
});

describe("unsupported forms — nothing emitted, a diagnostic where a declaration was opened", () => {
  it("refuses the table, the foreign label, the bare Questions heading, the empty label, and the fenced code", async () => {
    const { result, records } = await scanMatrix();
    const texts = records.map((record) => record.declared_text);
    expect(texts.some((text) => text.includes("|"))).toBe(false);
    expect(texts.some((text) => text.includes("Questions heading"))).toBe(false);
    expect(texts.some((text) => text.includes("inside a fence"))).toBe(false);
    expect(texts.some((text) => text.startsWith("Owner"))).toBe(false);
    const diagnostics = (result.architectureEvidence?.manifest.diagnostics ?? [])
      .filter((diagnostic) => diagnostic.source_path === "matrix.md")
      .map((diagnostic) => diagnostic.code)
      .sort();
    expect(diagnostics).toEqual([
      "architecture_evidence.empty_declaration", // Unresolved: with nothing under it
      "architecture_evidence.labelled_member_skipped", // Owner: mel under ## Decisions — phase 2
      "architecture_evidence.section_without_items", // ## Decisions — phase 2 held only a table and a foreign label
      "architecture_evidence.section_without_items", // ## Goals held only a fence
      "architecture_evidence.unsupported_member_block", // the table
    ]);
  });

  it("does not read a plain `Label:` line as a heading, a thematic break as frontmatter, or a mid-file --- block as fences", () => {
    expect(architecturePseudoHeadingLabel("Constraints:")).toBeNull();
    expect(architecturePseudoHeadingLabel("**Constraints**")).toBe("constraints");
    expect(architecturePseudoHeadingLabel("2.1 Open Questions:")).toBe("open questions");
    expect(architecturePseudoHeadingLabel("**Open Questions** for review")).toBeNull();
    expect(architecturePseudoHeadingLabel("3. Summary")).toBeNull();
    // A `---` block that is not the file's first block is a thematic break with
    // body text beside it: the labelled line is an ordinary field label (as it
    // was in 1.0.0), never a frontmatter field, and the break is not its
    // continuation.
    const reading = readArchitectureStatements([
      { block_id: "b1", kind: "paragraph", text: "Intro.", locator: L(1, 1) },
      { block_id: "b2", kind: "paragraph", text: "---\ndecision: not frontmatter\n---", locator: L(3, 5) },
    ]);
    expect(reading.statements.map((statement) => [statement.recognition.form, statement.declared_text, statement.unit_index, statement.unit_count]))
      .toEqual([["field_label", "not frontmatter", 1, 1]]);
  });
});

describe("identity and versions", () => {
  it("derives a statement's evidence id from its own fields and from no version", async () => {
    const { records } = await scanMatrix();
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.evidence_id).toBe(stableId("architecture_evidence", {
        artifact_id: record.artifact_id,
        block_id: record.block_id,
        declared_text: record.declared_text,
        extractor_id: ARCHITECTURE_STATEMENT_EXTRACTOR_ID,
        recognition_form: record.recognition.form,
        statement_class: record.statement_class,
        unit_index: record.unit_index,
      }));
      expect(record.extractor_version).toBe(ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION);
      expect(record.profile_version).toBe(ARCHITECTURE_EVIDENCE_PROFILE_VERSION);
    }
    expect(ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION).toBe("1.1.0");
    expect(ARCHITECTURE_EVIDENCE_PROFILE_VERSION).toBe("1.2.0");
    expect(architectureEvidenceProfileHash()).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("widens a line_span locator over a continuation and never past the block", () => {
    const block = { block_id: "b", kind: "paragraph" as const, text: "a\nb\nc", locator: L(10, 12) };
    expect(architectureStatementLocator(block, 1, 2)).toEqual(L(11, 12));
    expect(architectureStatementLocator(block, 2, 5)).toEqual(L(12, 12));
    expect(architectureStatementLocator(block, null, 3)).toEqual(L(10, 12));
    const docx = { block_id: "d", kind: "paragraph" as const, text: "a\nb", locator: { kind: "docx_block" as const, block_index: 4, part: "word/document.xml" } };
    expect(architectureStatementLocator(docx, 1, 2)).toEqual(docx.locator);
  });
});
