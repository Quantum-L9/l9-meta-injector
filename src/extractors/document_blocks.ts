// extractors/document_blocks.ts — work signals read out of a decoded document.
//
// The work-intelligence vocabulary was written against lines, because the files
// it was written for have lines. A Word document does not. Neither does a slide,
// a worksheet, a notebook cell or a PDF page. Decoding those into blocks made
// their text available to the corpus; it did not make their *statements*
// available, because the extractors that recognize a statement could not cite
// where one came from.
//
// That is what this module supplies. The rules are not reimplemented here — they
// are imported from `./work_intelligence`, so `Status: blocked` means the same
// thing in a `.docx` as in the `.md` beside it. What is new is the coordinate:
// every assertion below cites the block it was read from, by block id and by the
// structured locator that block's own format has. A slide assertion says slide 4,
// shape 2. A worksheet assertion says Sheet1!B7. None of them says a line number,
// because none of these documents has one, and a plausible line number would be
// worse than no evidence at all: it looks checkable and is not.
//
// The output type is therefore deliberately *not* `InterpretedAssertion`. That
// type's evidence is a line span, and it is what the Repository Model packet
// projection carries. Widening it so a docx block could be squeezed in would push
// a locator no downstream consumer understands into a contract that promises line
// spans. These assertions stay in the corpus layer — readiness, semantics,
// coverage, `document-signals.json` — until a downstream contract says it can
// read a structured locator.
import { BlockKind, BlockLocator } from "../documents/decoder";
import { boundExcerpt, looksSecret } from "../interpretation";
import { compareCodePoints } from "../ordering";
import { semanticHash, stableId } from "../repository_model";
import {
  LEADING_ADMONITION_UNITS,
  documentText,
  isMilestoneSectionHeading,
  readTextUnit,
  readTitleMarkers,
} from "./work_intelligence";

/** Identity of the block-signal policy. Bumped when these rules change. */
export const DOCUMENT_BLOCK_PROFILE_ID = "meta-injector-document-block-signals";
export const DOCUMENT_BLOCK_PROFILE_VERSION = "1.0.0";
/** The single extractor this profile runs, named in every assertion it produces. */
export const DOCUMENT_BLOCK_EXTRACTOR_ID = "document-block-work-intelligence/v1";

/**
 * Blocks whose text is never read for statements.
 *
 * `code` mirrors the fenced-code exclusion the Markdown reader already applies: a
 * shell transcript containing `# deploy` is not a heading and `- [ ] item` inside
 * an example is not a task.
 *
 * `title` and `heading` are excluded from *statement* reading — not from the
 * module — for the same reason `labelSignal` refuses an ATX heading: a section
 * called "Status: Blocked" names a section. Titles are read separately below,
 * for the markers a title legitimately carries.
 */
const UNREAD_BLOCK_KINDS: ReadonlySet<BlockKind> = new Set(["code", "title", "heading"]);

/** Block kinds that carry a document's own name or structure. */
const TITULAR_BLOCK_KINDS: ReadonlySet<BlockKind> = new Set(["title", "heading"]);

/** One block, as this reader needs it. */
export interface DocumentBlockView {
  block_id: string;
  kind: BlockKind;
  text: string;
  locator: BlockLocator;
}

/** Where a claim was read from, in the coordinate system its format has. */
export interface DocumentBlockEvidence {
  normalized_document_id: string | null;
  decoder_id: string;
  decoder_version: string;
  block_id: string;
  block_kind: BlockKind;
  /** The block's own locator, verbatim. Its `kind` says which shape it is. */
  locator: BlockLocator;
}

/**
 * A claim a decoded document makes about itself, with block-bound evidence.
 *
 * The field set is the one a reader needs to go back to the source and check:
 * which artifact, which exact bytes, which decoding of them, which block inside
 * that decoding, and what the block said.
 */
export interface DocumentBlockAssertion {
  assertion_id: string;
  /** The artifact this document was decoded from. */
  subject_id: string;
  predicate: string;
  object: string;
  /** Root-relative POSIX path, possibly an `archive.zip!/member` locator. */
  source_path: string;
  /** Hash of the *source bytes*, not of the decoded text. */
  source_content_hash: string | null;
  format: string;
  evidence: DocumentBlockEvidence;
  evidence_excerpt: string;
  evidence_class: "declared" | "observed";
  authority: "source";
  confidence: "low" | "medium" | "high";
  extractor_id: string;
}

export interface ReadDocumentBlocksInput {
  /** Repository-model artifact id these assertions are filed against. */
  subjectId: string;
  sourcePath: string;
  sourceContentHash: string | null;
  normalizedDocumentId: string | null;
  decoderId: string;
  decoderVersion: string;
  format: string;
  blocks: readonly DocumentBlockView[];
}

/**
 * Hash of the rules this pass applies.
 *
 * A caller that caches block signals keys them on this, so a change to the
 * vocabulary invalidates what the previous vocabulary produced rather than
 * serving it under the new profile's name.
 */
export function documentBlockProfileHash(): string {
  return semanticHash({
    id: DOCUMENT_BLOCK_PROFILE_ID,
    version: DOCUMENT_BLOCK_PROFILE_VERSION,
    extractor_id: DOCUMENT_BLOCK_EXTRACTOR_ID,
    evidence: "block_locator",
    ordering: "code-point",
    unread_block_kinds: [...UNREAD_BLOCK_KINDS].sort(compareCodePoints),
    leading_admonition_units: LEADING_ADMONITION_UNITS,
  });
}

/** Split a block's text into the units a reader is offered, in order. */
function unitsOf(text: string): string[] {
  return text.split(/\r?\n/);
}

/** The first line of a block that has any content, or null when it has none. */
function firstContentLine(text: string): string | null {
  for (const line of unitsOf(text)) {
    if (line.trim().length > 0) return line;
  }
  return null;
}

/** A draft assertion, before identity and evidence plumbing is attached. */
interface BlockDraft {
  predicate: string;
  object: string;
  excerpt: string;
  evidenceClass: "declared" | "observed";
  confidence: "low" | "medium" | "high";
  block: DocumentBlockView;
}

/** The checkbox marker a milestone may be written with, and is not part of. */
const MILESTONE_CHECKBOX = /^\s*\[[ xX]\]\s*/;

/** Every milestone one list-item block declares. */
function milestonesInBlock(block: DocumentBlockView): BlockDraft[] {
  const drafts: BlockDraft[] = [];
  for (const line of unitsOf(block.text)) {
    // A milestone written as a checklist item is still a milestone; the checkbox
    // marker is task syntax rather than part of the milestone.
    const text = documentText(line.replace(MILESTONE_CHECKBOX, ""));
    if (text.length === 0) continue;
    drafts.push({
      predicate: "work.milestone",
      object: text,
      excerpt: line,
      evidenceClass: "observed",
      confidence: "high",
      block,
    });
  }
  return drafts;
}

/** The list-item blocks belonging to the section a titular block opened. */
function milestoneSectionMembers(
  blocks: readonly DocumentBlockView[],
  opener: number,
): DocumentBlockView[] {
  const members: DocumentBlockView[] = [];
  for (let index = opener + 1; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.kind !== "list_item") break;
    members.push(block);
  }
  return members;
}

/**
 * Milestones declared as a list under a `Milestones` heading.
 *
 * The Markdown reader recognizes the same shape and stops the section at the next
 * heading; here the section stops at the first block after the list that is not
 * another list item, which is the block-shaped statement of the same rule.
 */
function milestoneSectionDrafts(blocks: readonly DocumentBlockView[]): BlockDraft[] {
  const drafts: BlockDraft[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const opener = blocks[index];
    if (!TITULAR_BLOCK_KINDS.has(opener.kind)) continue;
    if (!isMilestoneSectionHeading(opener.text)) continue;
    for (const member of milestoneSectionMembers(blocks, index)) {
      drafts.push(...milestonesInBlock(member));
    }
  }
  return drafts;
}

/**
 * What the document's titular blocks say.
 *
 * The first titular block is the document's name; the rest are its structure. A
 * deck has a title slide and then section slides, and a Word document has a Title
 * style and then Heading styles, so the same rule reads both correctly.
 *
 * `document.heading` carries the heading text alone, where the Markdown reader
 * prefixes it with the heading level. A block has no level to report: the decoder
 * knows the paragraph used a Heading style, not which one, and writing `H1:` in
 * front of it would be a second fabricated coordinate.
 *
 * Status and kind markers are read from every titular block rather than only the
 * first. A slide titled `Q3 Roadmap` is the deck declaring it holds a roadmap,
 * and that is the statement scenario 2 of the contract asks to be found. The
 * confidence stays `medium`, exactly as it is for a Markdown title: a name is a
 * name first and a claim about the document second.
 */
/** What one titular block declares: its text, and any marker that text carries. */
function titularBlockDrafts(
  block: DocumentBlockView,
  line: string,
  text: string,
  isName: boolean,
): BlockDraft[] {
  const drafts: BlockDraft[] = [{
    predicate: isName ? "document.title" : "document.heading",
    object: text,
    excerpt: line,
    evidenceClass: isName ? "declared" : "observed",
    confidence: "high",
    block,
  }];
  if (block.kind !== "title") return drafts;
  for (const marker of readTitleMarkers(text, line)) {
    drafts.push({
      predicate: marker.predicate,
      object: marker.object,
      excerpt: marker.excerpt,
      evidenceClass: marker.evidenceClass,
      confidence: marker.confidence,
      block,
    });
  }
  return drafts;
}

function titularDrafts(blocks: readonly DocumentBlockView[]): BlockDraft[] {
  const drafts: BlockDraft[] = [];
  let named: boolean = false;
  for (const block of blocks) {
    if (!TITULAR_BLOCK_KINDS.has(block.kind)) continue;
    const line = firstContentLine(block.text);
    if (line === null) continue;
    const text = documentText(line);
    if (text.length === 0) continue;
    const isName = block.kind === "title" && !named;
    if (isName) named = true;
    drafts.push(...titularBlockDrafts(block, line, text, isName));
  }
  return drafts;
}

/** Statements read line by line out of the blocks that carry body text. */
function statementDrafts(blocks: readonly DocumentBlockView[]): BlockDraft[] {
  const drafts: BlockDraft[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (UNREAD_BLOCK_KINDS.has(block.kind)) continue;
    for (const line of unitsOf(block.text)) {
      const signal = readTextUnit(line, {
        // "Near the top" is measured in blocks here and in lines in a text file.
        // Both answer the same question: a bare `> BLOCKED` under a heading
        // halfway down is about that section, not about the document.
        admonitionsAllowed: index < LEADING_ADMONITION_UNITS,
        // A checkbox in a decoded block never carries the bullet that was drawn
        // beside it. Word keeps the marker in its numbering definition; PowerPoint
        // makes every body paragraph of a text shape a bullet by layout; a
        // worksheet cell has no list syntax at all. In Markdown the bullet has to
        // be present because Markdown has real list syntax and `[ ] x` without one
        // is bracketed prose — but by the time a document has been decoded into
        // blocks, that distinction no longer exists to be honoured. Requiring the
        // marker here would read every Markdown checklist and no Word or
        // PowerPoint one: the same list failing to be understood because of the
        // program it was written in.
        listMarkerImplied: true,
      });
      if (signal === null) continue;
      drafts.push({
        predicate: signal.predicate,
        object: signal.object,
        excerpt: signal.excerpt,
        evidenceClass: signal.evidenceClass,
        confidence: signal.confidence,
        block,
      });
    }
  }
  return drafts;
}

/** Total order over assertions, so the output never depends on reading order. */
function compareAssertions(
  left: DocumentBlockAssertion,
  right: DocumentBlockAssertion,
): number {
  return (
    compareCodePoints(left.source_path, right.source_path)
    || compareCodePoints(left.evidence.block_id, right.evidence.block_id)
    || compareCodePoints(left.predicate, right.predicate)
    || compareCodePoints(left.object, right.object)
    || compareCodePoints(left.assertion_id, right.assertion_id)
  );
}

/**
 * Read every work signal a decoded document states about itself.
 *
 * Never throws on malformed content: a document that cannot be read is a fact
 * about the corpus rather than a crash, and the decoder has already recorded the
 * ones that could not be opened at all.
 */
export function readDocumentBlockSignals(
  input: ReadDocumentBlocksInput,
): DocumentBlockAssertion[] {
  const drafts = [
    ...titularDrafts(input.blocks),
    ...milestoneSectionDrafts(input.blocks),
    ...statementDrafts(input.blocks),
  ];
  const assertions: DocumentBlockAssertion[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const excerpt = boundExcerpt(draft.excerpt);
    // A refusal rather than a redaction: a redacted excerpt is no longer evidence
    // of anything, and this is the same rule the line-based path applies.
    if (looksSecret(excerpt) || looksSecret(draft.object)) continue;
    const assertionId = stableId("document_assertion", {
      block_id: draft.block.block_id,
      extractor_id: DOCUMENT_BLOCK_EXTRACTOR_ID,
      object: draft.object,
      predicate: draft.predicate,
      source_path: input.sourcePath,
      subject_id: input.subjectId,
    });
    // Two identical claims from one block are one claim. A worksheet row repeated
    // in a merged range would otherwise be counted twice.
    if (seen.has(assertionId)) continue;
    seen.add(assertionId);
    assertions.push({
      assertion_id: assertionId,
      subject_id: input.subjectId,
      predicate: draft.predicate,
      object: draft.object,
      source_path: input.sourcePath,
      source_content_hash: input.sourceContentHash,
      format: input.format,
      evidence: {
        normalized_document_id: input.normalizedDocumentId,
        decoder_id: input.decoderId,
        decoder_version: input.decoderVersion,
        block_id: draft.block.block_id,
        block_kind: draft.block.kind,
        locator: draft.block.locator,
      },
      evidence_excerpt: excerpt,
      evidence_class: draft.evidenceClass,
      authority: "source",
      confidence: draft.confidence,
      extractor_id: DOCUMENT_BLOCK_EXTRACTOR_ID,
    });
  }
  return assertions.sort(compareAssertions);
}
