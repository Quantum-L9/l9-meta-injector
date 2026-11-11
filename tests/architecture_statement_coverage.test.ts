// architecture_statement_coverage.test.ts — the coverage matrix is what the reader does.
//
// `docs/architecture-statement-coverage.json` is the published, exact statement of
// what `architecture-statements/v1` reads: every supported form, every form it
// reports instead of reading, and every form it deliberately leaves alone, each
// with the complete set of records and diagnostics a real file of that form
// produces. This suite runs every case through the real corpus scan and refuses
// any difference, so the matrix cannot drift from the reader in either direction.
//
// It then checks every record's coordinate against the file it cites: the words
// of the declared text must occur, contiguously, in the source lines a
// `line_span` locator names, or in the block a Word locator names.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHITECTURE_EVIDENCE_PROFILE_VERSION } from "../src/corpus_architecture_evidence";
import {
  ARCHITECTURE_STATEMENT_EXTRACTOR_ID,
  ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION,
  readArchitectureStatements,
} from "../src/extractors/architecture_statements";
import {
  containsWords,
  loadCoverageMatrix,
  observeCase,
  wordsOf,
} from "./helpers/architecture_coverage";

const REPO = path.resolve(__dirname, "..");
const matrix = loadCoverageMatrix(REPO);

describe("the architecture-statement coverage matrix", () => {
  it("is bound to the reader and profile versions it describes", () => {
    expect(matrix.schema).toBe("l9.architecture-statement-coverage/v1");
    expect(matrix.extractor_id).toBe(ARCHITECTURE_STATEMENT_EXTRACTOR_ID);
    expect(matrix.extractor_version).toBe(ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION);
    expect(matrix.profile_version).toBe(ARCHITECTURE_EVIDENCE_PROFILE_VERSION);
    const ids = matrix.cases.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("states, for every case, a verdict the observation can support", () => {
    for (const testCase of matrix.cases) {
      expect(["supported", "unsupported", "excluded"]).toContain(testCase.status);
      if (testCase.status === "supported")
        expect(testCase.expect.records.length, testCase.id).toBeGreaterThan(0);
      if (testCase.status === "unsupported")
        expect(testCase.expect.diagnostics.length, testCase.id).toBeGreaterThan(0);
    }
  });

  it("covers every coverage diagnostic the reader can raise", () => {
    const source = fs.readFileSync(
      path.join(REPO, "src", "extractors", "architecture_statements.ts"),
      "utf8",
    );
    const raised = new Set(source.match(/architecture_evidence\.[a-z_]+/g) ?? []);
    const covered = new Set(matrix.cases.flatMap((testCase) => testCase.expect.diagnostics));
    for (const code of raised) expect(covered.has(code), `${code} has no coverage case`).toBe(true);
  });

  it("is rendered in the coverage document, case by case", () => {
    const document = fs.readFileSync(
      path.join(REPO, "docs", "architecture-statement-coverage.md"),
      "utf8",
    );
    for (const testCase of matrix.cases)
      expect(document, testCase.id).toContain(`| ${testCase.id} |`);
  });

  for (const testCase of matrix.cases) {
    it(`${testCase.id} ${testCase.status}: ${testCase.title}`, async () => {
      const { observation, records, root, cleanup } = await observeCase(testCase);
      try {
        expect(observation).toEqual(testCase.expect);
        for (const record of records) {
          // A truncated quotation ends inside a word; that partial word is not in the source.
          const declared = wordsOf(record.declared_text).slice(
            0,
            record.declared_text_truncated ? -1 : undefined,
          );
          const locator = record.structured_locator as {
            kind: string;
            line_start?: number;
            line_end?: number;
          };
          if (locator.kind === "line_span") {
            const lines = fs
              .readFileSync(path.join(root, record.source_path), "utf8")
              .split(/\r\n|\r|\n/);
            const cited = lines
              .slice((locator.line_start as number) - 1, locator.line_end as number)
              .join("\n");
            expect(
              containsWords(wordsOf(cited), declared),
              `${record.declared_text} not at ${JSON.stringify(locator)}`,
            ).toBe(true);
            // The span is exact: its first line carries the statement or the label
            // that declared it (a block-scalar value starts on its key's line), and
            // its last line carries statement words.
            const first = wordsOf(
              (lines[(locator.line_start as number) - 1] as string).toLowerCase(),
            );
            const last = wordsOf(lines[(locator.line_end as number) - 1] as string);
            const opening = [
              ...declared.map((word) => word.toLowerCase()),
              ...wordsOf(record.recognition.label),
            ];
            expect(
              first.some((word) => opening.includes(word)),
              "first cited line",
            ).toBe(true);
            expect(
              last.some((word) => declared.includes(word)),
              "last cited line",
            ).toBe(true);
          } else {
            const spec = testCase.docx;
            expect(spec).toBeDefined();
            const blockTexts = [
              spec?.title ?? "",
              ...(spec?.headings ?? []),
              ...(spec?.paragraphs ?? []),
              ...(spec?.listItems ?? []),
            ];
            expect(
              blockTexts.some((text) => containsWords(wordsOf(text), declared)),
              `${record.declared_text} is in no single block of the document`,
            ).toBe(true);
            expect(containsWords(wordsOf(record.bounded_excerpt), declared)).toBe(true);
          }
        }
      } finally {
        cleanup();
      }
    });
  }
});

// Review of #147 (Copilot, two medium findings): the frontmatter bound must equal
// the work reader's, and a code span is delimited by equal backtick runs, not by
// an odd count. Both are read through the real block reader.
describe("frontmatter bound and code spans agree with the readers they mirror", () => {
  const paragraph = (lines: string[], start = 1) => ({
    block_id: `block:${start}`,
    kind: "paragraph" as const,
    text: lines.join("\n"),
    locator: { kind: "line_span" as const, line_start: start, line_end: start + lines.length - 1 },
  });

  /** Frontmatter whose closing delimiter sits on `closeLine` (1-based). */
  function frontmatter(closeLine: number): string[] {
    const filler = Array.from({ length: closeLine - 3 }, (_unused, index) => `key${index}: value`);
    return ["---", "objective: Ship it # owner: platform", ...filler, "---"];
  }

  it("reads frontmatter closed on the last line the work reader allows (200)", () => {
    const lines = frontmatter(200);
    expect(lines).toHaveLength(200);
    const reading = readArchitectureStatements([paragraph(lines)]);
    // Read as YAML: the trailing comment is not part of the value.
    expect(reading.statements.map((statement) => statement.declared_text)).toEqual(["Ship it"]);
  });

  it("treats an opener closed past the bound (201) as not frontmatter, as the work reader does", () => {
    // Not frontmatter, the block is a paragraph underlined by `---`: a CommonMark
    // setext heading, which declares nothing.
    const reading = readArchitectureStatements([paragraph(frontmatter(201))]);
    expect(reading.statements).toEqual([]);
  });

  it("does not read a label inside a double-backtick code span", () => {
    const reading = readArchitectureStatements([
      paragraph(["``Decision:`` is read by a second pass."]),
    ]);
    expect(reading.statements).toEqual([]);
  });

  it("reads a label that follows a closed code span on the same line", () => {
    const reading = readArchitectureStatements([paragraph(["Decision: keep ``a`b`` literal"])]);
    expect(reading.statements.map((statement) => statement.declared_text)).toEqual([
      "keep ``a`b`` literal",
    ]);
  });
});
