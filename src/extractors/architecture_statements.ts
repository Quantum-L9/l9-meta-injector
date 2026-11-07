// extractors/architecture_statements.ts — what a design document says it intends,
// assumes, is bound by, has not resolved, and has decided.
//
// A plan, a specification, a handoff note already states these things, and it
// states them in a form the author chose deliberately: `Objective:` at the top,
// a `## Constraints` section with a list under it, `Decision:` in front of a
// sentence, `Open question:` in front of another. This reader recognizes exactly
// those forms and nothing else. It does not decide that a paragraph *sounds* like
// a constraint, that a question mark makes an open question, or that a sentence
// in the imperative is a decision; a statement it cannot find a label for is a
// statement it does not emit.
//
// Everything it reads is an observed statement, not verified architecture. A
// `Decision:` line in a work-in-progress proposal is the document recording a
// decision, and this module records that the document recorded it. Whether the
// decision was ever accepted, superseded, or implemented is a question about the
// corpus, the ADR process and the code, none of which this reader can see.
//
// The reader runs over the normalized blocks a decoder already produced (ADR-043),
// so a Markdown file, a Word document and a slide deck are read by one
// implementation and cite the coordinate their own format has. It never opens a
// file itself. The forms it recognizes are four:
//
//   field_label        `Constraint: TransportPacket is the only wire format.`
//   label_list         `Constraints:` on its own, then the list items that follow
//   section_heading    `## Open Questions`, `## 3. Decisions (phase 1)`, a bold or
//                      numbered `**Constraints**` line, then the items and
//                      paragraphs under it
//   frontmatter_field  `decision: …` inside the leading `---` fences of a file
//
// A label whose shape is recognized but whose grammar is not — an empty
// `Constraints:` with nothing under it, a `## Decisions` section holding only a
// table — is reported as a coverage diagnostic, so an absence in the output can
// be told from a document that declared nothing. The exact supported-input
// definition, with every form and every refusal, is the coverage matrix in
// `docs/architecture-evidence-coverage.md`, and it is executed as a test.
import type { BlockKind, BlockLocator } from "../documents/decoder";
import { MAX_EXCERPT_LENGTH, boundExcerpt, looksSecret } from "../interpretation";
import { compareCodePoints } from "../ordering";
import type { DocumentBlockView } from "./document_blocks";
import { documentText, readLabelledLine, readTextUnit } from "./work_intelligence";

/** Identity of this reader. Bumped when the vocabulary or the grammar changes. */
export const ARCHITECTURE_STATEMENT_EXTRACTOR_ID = "architecture-statements/v1";
/**
 * 1.1.0 (coverage closure): a heading's leading section number and trailing
 * qualifier are not part of its label; a bold or numbered bare label on a line
 * of its own opens a section like a heading; the leading frontmatter fences of a
 * text file are read as `frontmatter_field` declarations; the lines that follow a
 * labelled field inside its block are its continuation, not separate members.
 * Statement identity does not include this version, so a statement these rules
 * read the same way keeps its evidence id.
 */
export const ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION = "1.1.0";

/** The five statement classes, in code-point order. Closed. */
export const ARCHITECTURE_STATEMENT_CLASSES = [
  "assumption",
  "constraint",
  "decision_statement",
  "intent",
  "open_question",
] as const;

export type ArchitectureStatementClass = (typeof ARCHITECTURE_STATEMENT_CLASSES)[number];

/**
 * Which written label names which class.
 *
 * Keys are the normalized label — emphasis removed, lowercased, as
 * `readLabelledLine` returns it and as a heading's text is normalized below.
 * The table is the whole vocabulary: a label not in it is not a statement of
 * any class, however suggestive. `Questions` alone is deliberately absent (a FAQ
 * heading is not a list of unresolved questions), and so are `Goal of this
 * section` and every other phrase that merely contains a vocabulary word.
 */
export const ARCHITECTURE_LABEL_VOCABULARY: Readonly<Record<string, ArchitectureStatementClass>> = {
  objective: "intent",
  objectives: "intent",
  goal: "intent",
  goals: "intent",
  intent: "intent",
  constraint: "constraint",
  constraints: "constraint",
  invariant: "constraint",
  invariants: "constraint",
  assumption: "assumption",
  assumptions: "assumption",
  "open question": "open_question",
  "open questions": "open_question",
  unresolved: "open_question",
  "unresolved question": "open_question",
  "unresolved questions": "open_question",
  decision: "decision_statement",
  decisions: "decision_statement",
};

/** How a statement was recognized. Recorded on every statement. */
export type ArchitectureRecognitionForm =
  | "field_label"
  | "label_list"
  | "section_heading"
  | "frontmatter_field";

/**
 * Longest statement text kept verbatim. The excerpt is bounded separately by
 * `MAX_EXCERPT_LENGTH`; the declared text may be a whole paragraph and is given
 * more room, but a document cannot turn the evidence file into a copy of itself.
 */
export const MAX_STATEMENT_TEXT_LENGTH = 1024;

/** Coverage diagnostics one document may raise before the rest are summarized. */
export const MAX_ARCHITECTURE_DIAGNOSTICS_PER_DOCUMENT = 8;

/**
 * Block kinds whose text is read for statements.
 *
 * `code` is never read, for the reason the work readers give: an example in a
 * fence is not a declaration. `table` is not read either: a table's text is a
 * row rendering, and a row that happens to begin `Decision | ...` is a column
 * header rather than a statement. A table under a labelled section is reported
 * as unsupported instead of guessed at.
 */
const READABLE_BLOCK_KINDS: ReadonlySet<BlockKind> = new Set(["paragraph", "list_item", "note", "cell"]);
const TITULAR_BLOCK_KINDS: ReadonlySet<BlockKind> = new Set(["title", "heading"]);

/** One recognized statement, before identity and evidence plumbing is attached. */
export interface ArchitectureStatementDraft {
  statement_class: ArchitectureStatementClass;
  /** The statement as the document wrote it, normalized as a quotation and bounded. */
  declared_text: string;
  /** True when `declared_text` was cut at `MAX_STATEMENT_TEXT_LENGTH`. */
  declared_text_truncated: boolean;
  /** The unit of text the statement was read from, bounded. */
  bounded_excerpt: string;
  recognition: { form: ArchitectureRecognitionForm; label: string };
  block: DocumentBlockView;
  /**
   * Which line of the block's text the statement starts on (0-based), or null
   * when the statement is the whole block. Stated separately from the locator
   * because most locators have no finer coordinate than the block, and a unit
   * offset is checkable against the block's text wherever it came from.
   */
  unit_index: number | null;
  /** How many of the block's lines the statement spans, from `unit_index`. */
  unit_count: number;
}

export interface ArchitectureCoverageDiagnostic {
  code: string;
  severity: "info" | "warning";
  message: string;
  block_id: string;
}

export interface ArchitectureStatementReading {
  statements: ArchitectureStatementDraft[];
  diagnostics: ArchitectureCoverageDiagnostic[];
  /** Diagnostics raised beyond the per-document bound, so the count is still stated. */
  diagnostics_omitted: number;
}

/** A unit of text, as the block-signal reader splits one: CRLF, LF or lone CR. */
function unitsOf(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/**
 * A leading section number: `3.`, `2.1`, `4)`, `1.2.3.` — digits and dots, one
 * optional closing mark, then whitespace. Anchored and linear.
 */
const SECTION_NUMBER = /^\d+(?:\.\d+)*[.)]?\s+/;

/**
 * Where a heading stops naming its section and starts qualifying it: an opening
 * parenthesis, an em or en dash, a spaced hyphen, or a colon. `Open Questions
 * (v2)`, `Decisions — phase 1` and `Constraints: transport` all name their
 * section first. The qualifier is not read and does not change the class.
 */
const HEADING_QUALIFIER = /\s*(?:\(|—|–|\s-\s|:).*$/u;

/** A heading's text as a vocabulary key: quoted, numbering and qualifier dropped, lowercased. */
function headingLabel(text: string): string {
  return documentText(text)
    .replace(SECTION_NUMBER, "")
    .replace(HEADING_QUALIFIER, "")
    .toLowerCase()
    .trim();
}

/** The class a heading names, or null when the heading is not in the vocabulary. */
export function architectureHeadingClass(text: string): ArchitectureStatementClass | null {
  const firstLine = unitsOf(text).find((line) => line.trim().length > 0);
  if (firstLine === undefined) return null;
  return ARCHITECTURE_LABEL_VOCABULARY[headingLabel(firstLine)] ?? null;
}

const isEmphasisMark = (character: string): boolean => character === "*" || character === "_";

/**
 * A line that is a heading written without `#`: a bare vocabulary label wrapped
 * in emphasis (`**Constraints**`) or carrying a section number (`2.1 Open
 * Questions`), with nothing else on the line but an optional trailing colon.
 *
 * A plain `Constraints:` is deliberately not one: that shape has always opened a
 * list of the items that follow it (`label_list`), and reading it as a section
 * would change what it means and which statements it owns.
 */
export function architecturePseudoHeadingLabel(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  const emphasized = isEmphasisMark(trimmed[0] as string) && isEmphasisMark(trimmed[trimmed.length - 1] as string);
  const numbered = SECTION_NUMBER.test(trimmed);
  if (!emphasized && !numbered) return null;
  const label = documentText(trimmed).replace(SECTION_NUMBER, "").replace(/\s*:\s*$/, "").toLowerCase().trim();
  return label in ARCHITECTURE_LABEL_VOCABULARY ? label : null;
}

/** A labelled line whose label is in the vocabulary, with its class and value. */
export function architectureLabelOf(
  line: string,
): { label: string; statementClass: ArchitectureStatementClass; value: string } | null {
  const labelled = readLabelledLine(line);
  if (labelled === null) return null;
  const statementClass = ARCHITECTURE_LABEL_VOCABULARY[labelled.label];
  if (statementClass === undefined) return null;
  return { label: labelled.label, statementClass, value: labelled.value };
}

/**
 * True for a unit the work-intelligence vocabulary already claims.
 *
 * `Status: blocked`, `- [ ] ship it`, `Depends on: core` under a `## Constraints`
 * heading are declarations of work state, read by the work extractors and cited
 * there. Reading them again as constraints would file one line under two
 * predicates. The two vocabularies are disjoint, so the question is asked only
 * for a unit the architecture vocabulary did not claim.
 */
function isWorkSignalUnit(line: string): boolean {
  return readTextUnit(line, { admonitionsAllowed: false, listMarkerImplied: true }) !== null;
}

/**
 * True for a unit shaped like a Markdown table row.
 *
 * The text decoder has no table construct for Markdown, so a pipe table arrives
 * as a paragraph whose every line opens with `|`. Its first row is a header and
 * its rows are cells; neither is a sentence the document declared, and under a
 * `## Decisions` heading the whole block would otherwise be quoted as one
 * decision. Tables are reported as unsupported instead, in either format.
 */
function isTableRow(line: string): boolean {
  return /^\s*\|/.test(line);
}

/**
 * A thematic break: three or more of one of `-`, `*`, `_`, optionally spaced,
 * and nothing else. Not text, so never a continuation and never a member.
 */
function isThematicBreak(line: string): boolean {
  return /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

/** True when every content line of a block is a table row. */
function isTableShaped(units: readonly string[]): boolean {
  const content = units.filter((unit) => unit.trim().length > 0);
  return content.length > 0 && content.every(isTableRow);
}

/**
 * True for a unit of the `Label: value` shape with a label this reader does not
 * know.
 *
 * `Owner: mel` or `Type: specification` under a `## Constraints` heading is a
 * declaration under its own label, and what that label means is not something
 * this reader can decide. Skipped, and counted, rather than quoted as a
 * constraint it was never written to be. The architecture and work vocabularies
 * are tested before this question is asked, so neither is affected by it.
 */
function isForeignLabelledUnit(line: string): boolean {
  return readLabelledLine(line) !== null;
}

/**
 * The closing fence of a leading frontmatter block, or -1.
 *
 * The text decoder has no frontmatter construct: a file's `---` fences and the
 * fields between them arrive as the first paragraph block, at line 1. That is
 * the only shape this reader treats as frontmatter — a block elsewhere whose
 * first line is `---` is a thematic break, not metadata.
 */
function frontmatterClose(block: DocumentBlockView, units: readonly string[]): number {
  if (block.locator.kind !== "line_span" || block.locator.line_start !== 1) return -1;
  if (units.length < 2 || units[0]?.trim() !== "---") return -1;
  for (let index = 1; index < units.length; index += 1) {
    const fence = units[index]?.trim();
    if (fence === "---" || fence === "...") return index;
  }
  return -1;
}

/** Cut a quotation at the statement bound, saying so. */
function boundStatementText(value: string): { text: string; truncated: boolean } {
  if (value.length <= MAX_STATEMENT_TEXT_LENGTH) return { text: value, truncated: false };
  return { text: `${value.slice(0, MAX_STATEMENT_TEXT_LENGTH - 1)}…`, truncated: true };
}

interface OpenDeclaration {
  statementClass: ArchitectureStatementClass;
  label: string;
  members: number;
  block: DocumentBlockView;
}

/** A labelled field whose continuation lines are still being collected. */
interface OpenField {
  statementClass: ArchitectureStatementClass;
  label: string;
  parts: string[];
  excerpt: string;
  first: number;
  last: number;
}

/** The recognizer's working state while it walks one document's blocks. */
class StatementReader {
  readonly statements: ArchitectureStatementDraft[] = [];
  private readonly raised: ArchitectureCoverageDiagnostic[] = [];
  /** An open `## Constraints`-style section, until the next titular or code block. */
  private section: OpenDeclaration | null = null;
  /** An open `Constraints:` label waiting for the list items that follow it. */
  private pendingList: OpenDeclaration | null = null;

  constructor(private readonly blocks: readonly DocumentBlockView[]) {}

  read(): ArchitectureStatementReading {
    for (const block of this.blocks) this.readBlock(block);
    this.closePendingList();
    this.closeSection();
    const bounded = this.raised.slice(0, MAX_ARCHITECTURE_DIAGNOSTICS_PER_DOCUMENT);
    return {
      statements: this.statements,
      diagnostics: bounded,
      diagnostics_omitted: this.raised.length - bounded.length,
    };
  }

  private diagnostic(code: string, severity: "info" | "warning", message: string, block: DocumentBlockView): void {
    this.raised.push({ code, severity, message, block_id: block.block_id });
  }

  private emit(
    statementClass: ArchitectureStatementClass,
    rawText: string,
    excerpt: string,
    form: ArchitectureRecognitionForm,
    label: string,
    block: DocumentBlockView,
    unitIndex: number | null,
    unitCount: number,
  ): boolean {
    const quoted = documentText(rawText);
    if (quoted.length === 0) return false;
    const boundedExcerpt = boundExcerpt(excerpt);
    // A refusal rather than a redaction, as every other reader in this package
    // does it: a redacted excerpt is no longer evidence of anything.
    if (looksSecret(boundedExcerpt) || looksSecret(quoted)) {
      this.diagnostic(
        "architecture_evidence.secret_value_suppressed",
        "warning",
        `a ${statementClass} declaration was dropped because its text resembled a credential`,
        block,
      );
      return false;
    }
    const { text, truncated } = boundStatementText(quoted);
    if (truncated) {
      this.diagnostic(
        "architecture_evidence.statement_truncated",
        "info",
        `a ${statementClass} declaration longer than ${MAX_STATEMENT_TEXT_LENGTH} characters was cut; the bounded excerpt and the coordinate still identify it`,
        block,
      );
    }
    this.statements.push({
      statement_class: statementClass,
      declared_text: text,
      declared_text_truncated: truncated,
      bounded_excerpt: boundedExcerpt,
      recognition: { form, label },
      block,
      unit_index: unitIndex,
      unit_count: Math.max(1, unitCount),
    });
    return true;
  }

  private closePendingList(): void {
    const pending = this.pendingList;
    if (pending === null) return;
    this.pendingList = null;
    if (pending.members === 0) {
      this.diagnostic(
        "architecture_evidence.empty_declaration",
        "warning",
        `'${pending.label}:' declares a ${pending.statementClass} list and nothing follows it that this reader can attribute to it`,
        pending.block,
      );
    }
  }

  private closeSection(): void {
    const section = this.section;
    if (section === null) return;
    this.section = null;
    if (section.members === 0) {
      this.diagnostic(
        "architecture_evidence.section_without_items",
        "warning",
        `the '${section.label}' section declares ${section.statementClass} statements and holds no item or paragraph this reader can attribute to it`,
        section.block,
      );
    }
  }

  private openSection(statementClass: ArchitectureStatementClass, label: string, block: DocumentBlockView): void {
    this.closePendingList();
    this.closeSection();
    this.section = { statementClass, label, members: 0, block };
  }

  private readBlock(block: DocumentBlockView): void {
    if (TITULAR_BLOCK_KINDS.has(block.kind)) {
      // Any heading ends what came before it, whether or not it opens a section.
      this.closePendingList();
      this.closeSection();
      const statementClass = architectureHeadingClass(block.text);
      if (statementClass !== null) {
        const firstLine = unitsOf(block.text).find((line) => line.trim().length > 0) ?? block.text;
        this.section = { statementClass, label: headingLabel(firstLine), members: 0, block };
      }
      return;
    }
    if (block.kind === "code") {
      this.closePendingList();
      this.closeSection();
      return;
    }
    const units = unitsOf(block.text);
    if (!READABLE_BLOCK_KINDS.has(block.kind) || isTableShaped(units)) {
      // A table (or any kind this reader does not open) under a labelled section
      // is a construct outside the grammar: reported, never interpreted.
      if (this.pendingList !== null || this.section !== null) {
        const owner = this.pendingList ?? this.section;
        const shape = isTableShaped(units) ? "table-shaped" : block.kind;
        this.diagnostic(
          "architecture_evidence.unsupported_member_block",
          "info",
          `a ${shape} block under the '${owner?.label}' ${owner?.statementClass} declaration was not read; this reader attributes list items and paragraphs only`,
          block,
        );
      }
      this.closePendingList();
      return;
    }

    // The file's leading frontmatter: its fields are declarations, its fences
    // are not, and nothing in it belongs to a section or a list.
    const fenceClose = frontmatterClose(block, units);
    if (fenceClose >= 0) {
      this.readFrontmatter(block, units, fenceClose);
      this.readBody(block, units, fenceClose + 1);
      return;
    }

    // A heading written without `#`: a single bold or numbered bare label.
    const content = units.filter((unit) => unit.trim().length > 0);
    if (block.kind === "paragraph" && content.length === 1) {
      const label = architecturePseudoHeadingLabel(content[0] as string);
      if (label !== null) {
        this.openSection(ARCHITECTURE_LABEL_VOCABULARY[label] as ArchitectureStatementClass, label, block);
        return;
      }
    }

    this.readBody(block, units, 0);
  }

  /** `key: value` lines between the fences whose key is in the vocabulary. */
  private readFrontmatter(block: DocumentBlockView, units: readonly string[], fenceClose: number): void {
    for (let index = 1; index < fenceClose; index += 1) {
      const unit = units[index] as string;
      const hit = architectureLabelOf(unit);
      if (hit === null || hit.value.length === 0) continue;
      this.emit(hit.statementClass, hit.value, unit, "frontmatter_field", hit.label, block, index, 1);
    }
  }

  /** The block's body from `start`: labelled units, list members, section members. */
  private readBody(block: DocumentBlockView, units: readonly string[], start: number): void {
    const body = units.slice(start);
    if (body.every((unit) => unit.trim().length === 0)) return;
    const labelled = body.map((unit) => architectureLabelOf(unit));
    if (labelled.some((hit) => hit !== null)) {
      this.closePendingList();
      this.readLabelledBlock(block, units, start, labelled);
      return;
    }

    // A pending `Label:` list takes the list items that follow it and ends at the
    // first block that is not one — the shape `milestoneSectionBullets` reads.
    if (this.pendingList !== null) {
      if (block.kind === "list_item") {
        this.readMembers(block, units, start, this.pendingList.statementClass, "label_list", this.pendingList.label, this.pendingList);
        return;
      }
      this.closePendingList();
    }

    if (this.section !== null) {
      const section = this.section;
      // A whole paragraph under `## Constraints` is one constraint; a list item is
      // one; each is quoted as the document wrote it. A unit the work vocabulary
      // claims is skipped, so `Status: blocked` under a section is not a constraint.
      if (block.kind === "list_item" || block.kind === "cell") {
        this.readMembers(block, units, start, section.statementClass, "section_heading", section.label, section);
        return;
      }
      const kept = body.filter((unit) => unit.trim().length > 0 && !isThematicBreak(unit) && !this.skipsMember(unit, section, block));
      if (kept.length > 0) {
        const unitIndex = start === 0 ? null : start;
        if (this.emit(section.statementClass, kept.join("\n"), kept[0] as string, "section_heading", section.label, block, unitIndex, body.length)) {
          section.members += 1;
        }
      }
    }
  }

  /**
   * True for a unit that is not attributed to the open declaration: one the work
   * vocabulary claims, or one declared under a label this reader does not know.
   * The second case is counted, so a reader of the manifest can see what a
   * section held that was not quoted.
   */
  private skipsMember(
    unit: string,
    owner: { statementClass: ArchitectureStatementClass; label: string },
    block: DocumentBlockView,
  ): boolean {
    if (isWorkSignalUnit(unit)) return true;
    if (!isForeignLabelledUnit(unit)) return false;
    this.diagnostic(
      "architecture_evidence.labelled_member_skipped",
      "info",
      `a 'label: value' line under the '${owner.label}' ${owner.statementClass} declaration carries a label this reader does not know and was not quoted as a statement`,
      block,
    );
    return true;
  }

  /** Items read one unit at a time, each attributed to the open declaration. */
  private readMembers(
    block: DocumentBlockView,
    units: readonly string[],
    start: number,
    statementClass: ArchitectureStatementClass,
    form: ArchitectureRecognitionForm,
    label: string,
    owner: { members: number },
  ): void {
    for (let index = start; index < units.length; index += 1) {
      const unit = units[index] as string;
      if (unit.trim().length === 0 || isThematicBreak(unit) || this.skipsMember(unit, { statementClass, label }, block)) continue;
      if (this.emit(statementClass, unit, unit, form, label, block, index, 1)) owner.members += 1;
    }
  }

  /**
   * A block holding at least one vocabulary label, read unit by unit.
   *
   * `Objective: ship it` is a statement on its own line, and the lines that
   * follow it inside the same block — a Markdown paragraph's soft-wrapped
   * continuation, a Word paragraph's line breaks — are the rest of that
   * statement, not separate members. `Constraints:` with nothing after the
   * colon opens a list: the units after it in the same block belong to it, and
   * if there are none, the list items that follow the block do. A unit that is
   * none of these belongs to the open heading section if there is one, and to
   * nothing otherwise: a label on line three does not reach back to claim lines
   * one and two.
   */
  private readLabelledBlock(
    block: DocumentBlockView,
    units: readonly string[],
    start: number,
    labelled: readonly ({ label: string; statementClass: ArchitectureStatementClass; value: string } | null)[],
  ): void {
    let open: { statementClass: ArchitectureStatementClass; label: string; members: number } | null = null;
    let field: OpenField | null = null;
    const flushField = (): void => {
      if (field === null) return;
      this.emit(field.statementClass, field.parts.join(" "), field.excerpt, "field_label", field.label, block, field.first, field.last - field.first + 1);
      field = null;
    };
    const closeOpen = (): void => {
      if (open !== null && open.members === 0) {
        this.diagnostic(
          "architecture_evidence.empty_declaration",
          "warning",
          `'${open.label}:' declares a ${open.statementClass} list and nothing follows it that this reader can attribute to it`,
          block,
        );
      }
      open = null;
    };
    for (let index = start; index < units.length; index += 1) {
      const unit = units[index] as string;
      const hit = labelled[index - start] ?? null;
      if (hit !== null) {
        flushField();
        closeOpen();
        if (hit.value.length > 0) {
          field = { statementClass: hit.statementClass, label: hit.label, parts: [hit.value], excerpt: unit, first: index, last: index };
        } else {
          open = { statementClass: hit.statementClass, label: hit.label, members: 0 };
        }
        continue;
      }
      if (unit.trim().length === 0) continue;
      if (isWorkSignalUnit(unit) || isTableRow(unit) || isThematicBreak(unit)) {
        flushField();
        continue;
      }
      if (isForeignLabelledUnit(unit)) {
        flushField();
        const owner = open ?? this.section;
        if (owner !== null) this.skipsMember(unit, owner, block);
        continue;
      }
      if (field !== null) {
        // Continuation of the labelled statement above it.
        field.parts.push(unit);
        field.last = index;
        continue;
      }
      if (open !== null) {
        if (this.emit(open.statementClass, unit, unit, "label_list", open.label, block, index, 1)) open.members += 1;
        continue;
      }
      if (this.section !== null) {
        if (this.emit(this.section.statementClass, unit, unit, "section_heading", this.section.label, block, index, 1)) {
          this.section.members += 1;
        }
      }
    }
    flushField();
    if (open !== null && (open as { members: number }).members === 0) {
      // Nothing in this block followed the label; the list items after it may.
      const pending = open as { statementClass: ArchitectureStatementClass; label: string };
      this.pendingList = { statementClass: pending.statementClass, label: pending.label, members: 0, block };
    }
  }
}

/**
 * Read every architectural statement a document's blocks explicitly declare.
 *
 * Deterministic over the block sequence; never throws on malformed content; never
 * reads a file. Statements are returned in reading order, so a caller that wants
 * a total order sorts them on the identity it attaches.
 */
export function readArchitectureStatements(
  blocks: readonly DocumentBlockView[],
): ArchitectureStatementReading {
  return new StatementReader(blocks).read();
}

/**
 * The coordinate a statement cites.
 *
 * A `line_span` block maps its text lines onto source lines one to one — the
 * text decoder joins the lines of a paragraph with `\n` and starts the span at
 * the first of them — so a statement starting on unit *k* of the block and
 * spanning *n* units cites lines `line_start + k` to `line_start + k + n - 1`,
 * never past the block's own end. Every other locator kind has no coordinate
 * finer than the block, and the block's own locator is cited verbatim; the unit
 * offset and count are carried beside it rather than converted into a line
 * number the format does not have.
 */
export function architectureStatementLocator(
  block: DocumentBlockView,
  unitIndex: number | null,
  unitCount = 1,
): BlockLocator {
  const locator = block.locator;
  if (locator.kind === "line_span" && unitIndex !== null) {
    const start = locator.line_start + unitIndex;
    if (start <= locator.line_end) {
      return { kind: "line_span", line_start: start, line_end: Math.min(start + Math.max(1, unitCount) - 1, locator.line_end) };
    }
  }
  return locator;
}

/**
 * The reader's identity, for the profile hash.
 *
 * Everything that changes what this reader recognizes is in here: the vocabulary,
 * the forms, the block kinds it opens, the bounds. A caller hashing it binds the
 * rules a run applied, which is what makes two runs comparable.
 */
export function architectureStatementRules(): Record<string, unknown> {
  return {
    extractor_id: ARCHITECTURE_STATEMENT_EXTRACTOR_ID,
    extractor_version: ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION,
    statement_classes: [...ARCHITECTURE_STATEMENT_CLASSES],
    recognition_forms: ["field_label", "frontmatter_field", "label_list", "section_heading"],
    vocabulary: Object.keys(ARCHITECTURE_LABEL_VOCABULARY)
      .sort(compareCodePoints)
      .map((label) => [label, ARCHITECTURE_LABEL_VOCABULARY[label]]),
    readable_block_kinds: [...READABLE_BLOCK_KINDS].sort(compareCodePoints),
    section_delimiters: ["code", "heading", "title"],
    heading_section_numbers_ignored: true,
    heading_qualifiers_ignored: ["(", "—", "–", " - ", ":"],
    pseudo_headings: ["emphasized bare label", "numbered bare label"],
    frontmatter_fields: "leading `---` fences of a line_span block at line 1",
    field_continuation_lines: true,
    work_vocabulary_excluded: true,
    foreign_labelled_members_excluded: true,
    table_shaped_blocks_excluded: true,
    max_statement_text_length: MAX_STATEMENT_TEXT_LENGTH,
    max_excerpt_length: MAX_EXCERPT_LENGTH,
    max_diagnostics_per_document: MAX_ARCHITECTURE_DIAGNOSTICS_PER_DOCUMENT,
  };
}
