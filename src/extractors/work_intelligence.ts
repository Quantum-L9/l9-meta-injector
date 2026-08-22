// work_intelligence.ts — artifact-scoped structure and declared work state.
//
// These extractors answer "what does this document say about itself and its
// work": its title and headings, the state and kind it declares, the tasks and
// milestones it lists, and the dependencies, references, and supersession it
// names.
//
// Every rule here is a reading rule, never a judgement:
//
//   - A status exists because the document wrote one down, in a place that means
//     "this is the status" — frontmatter, a `Status:` label, an admonition, or a
//     marker in the title. Age, path, TODO count, and the absence of open tasks
//     say nothing and are never consulted.
//   - A kind exists because frontmatter declares it or the title names it. A
//     document is never classified from the theme of its body.
//   - A task exists because of checkbox or `TODO:` syntax, not because the word
//     "todo" appears in a sentence.
//   - Contradictions survive. A document that says both `Status: WIP` and
//     `Status: Complete` produces both assertions; reconciling them is a
//     downstream decision with more context than a parser has.
//
// Fenced code is skipped, so a Markdown sample showing `- [ ] item` documents
// syntax rather than declaring a task.
import { AssertionDraft, Extractor, ExtractorFileInput, InterpretedConfidenceLevel } from "../interpretation";

/** Extensions whose bytes these rules know how to read. */
const TEXT_EXTENSIONS = [".md", ".markdown", ".txt", ".rst"];
/** Markdown heading and fence syntax applies only to these. */
const MARKDOWN_EXTENSIONS = [".md", ".markdown"];

function hasExtension(sourcePath: string, extensions: string[]): boolean {
  const lower = sourcePath.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

function claimsPath(sourcePath: string): boolean {
  return hasExtension(sourcePath, TEXT_EXTENSIONS);
}

function toLines(content: string): string[] {
  return content.split(/\r\n|\r|\n/);
}

/** Whitespace-collapsed, trimmed text. Never lowercased: the object is quoted text. */
function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Strip emphasis markers from a closed-vocabulary value (`**wip**` -> `wip`).
 *
 * Global, which is safe here only because the status and kind vocabularies are
 * short lowercase words that contain no `_` or `*` of their own.
 */
function stripEmphasis(value: string): string {
  return value.replace(/[*_`]+/g, "");
}

/**
 * Strip emphasis that wraps a free-text value, leaving the inside alone.
 *
 * Free text is quoted back as the object, so removing markers globally would
 * corrupt it: `Supersedes: l9_constellation_topology_contract` would be recorded
 * as `l9constellationtopologycontract`, an identifier that appears nowhere and
 * resolves to nothing. Observed on a real repository, which is what caught it.
 */
function stripWrappingEmphasis(value: string): string {
  return value.replace(/^[*_`]+/, "").replace(/[*_`]+$/, "");
}

function draft(
  predicate: string,
  object: string,
  lineIndex: number,
  line: string,
  confidence: InterpretedConfidenceLevel = "high",
): AssertionDraft {
  return {
    predicate,
    object,
    sourceRange: { start_line: lineIndex + 1, end_line: lineIndex + 1 },
    evidenceExcerpt: line,
    evidenceClass: "declared",
    authority: "source",
    confidence,
  };
}

// ───────────────────────────── document shape ─────────────────────────────

interface DocumentShape {
  lines: string[];
  /** Line indexes inside fenced code, which carry syntax rather than claims. */
  fenced: Set<number>;
  /** Frontmatter key -> { value, lineIndex }. Absent when there is no frontmatter. */
  frontmatter: Map<string, { value: string; lineIndex: number }>;
  /** Line index (exclusive) where frontmatter ends; 0 when there is none. */
  bodyStart: number;
  markdown: boolean;
}

/**
 * Read the leading `---` block as flat `key: value` pairs.
 *
 * Deliberately not a YAML parser: only unindented scalar keys are read, so a
 * nested structure contributes nothing rather than being flattened into claims
 * its author did not make.
 */
function readFrontmatter(lines: string[]): { entries: Map<string, { value: string; lineIndex: number }>; bodyStart: number } {
  const entries = new Map<string, { value: string; lineIndex: number }>();
  if (lines.length === 0 || lines[0].trim() !== "---") return { entries, bodyStart: 0 };
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === "---" || line.trim() === "...") return { entries, bodyStart: index + 1 };
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    // First declaration wins the key slot; a repeated key is still a separate
    // line and is reported by whichever rule reads it.
    if (!entries.has(key)) {
      entries.set(key, { value: normalizeText(stripQuotes(match[2])), lineIndex: index });
    }
  }
  // An unterminated block is not frontmatter; treat the whole file as body.
  return { entries: new Map(), bodyStart: 0 };
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

/** Line indexes inside ``` or ~~~ fences. */
function fencedLines(lines: string[], markdown: boolean): Set<number> {
  const fenced = new Set<number>();
  if (!markdown) return fenced;
  let openFence: string | null = null;
  lines.forEach((line, index) => {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (openFence === null) {
      if (match) {
        openFence = match[1][0];
        fenced.add(index);
      }
      return;
    }
    fenced.add(index);
    if (match && match[1][0] === openFence) openFence = null;
  });
  return fenced;
}

function readShape(input: ExtractorFileInput): DocumentShape {
  const lines = toLines(input.content);
  const markdown = hasExtension(input.sourcePath, MARKDOWN_EXTENSIONS);
  const { entries, bodyStart } = readFrontmatter(lines);
  return { lines, fenced: fencedLines(lines, markdown), frontmatter: entries, bodyStart, markdown };
}

/** True for a body line that carries claims rather than code or frontmatter. */
function isClaimLine(shape: DocumentShape, index: number): boolean {
  return index >= shape.bodyStart && !shape.fenced.has(index);
}

// ───────────────────── document-structure/v1 ─────────────────────

const ATX_HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const PLAIN_TITLE = /^\s*(?:[*_]{0,2})Title(?:[*_]{0,2})\s*:\s*(.+)$/i;

/**
 * Title and heading structure, exactly as written.
 *
 * Every title form the document uses is emitted. Where two disagree the
 * disagreement is the finding — silently preferring frontmatter over the H1
 * would hide that the document contradicts itself.
 */
export const documentStructureExtractor: Extractor = {
  id: "document-structure/v1",
  version: "1.0.0",
  subjectScope: "artifact",
  matches: claimsPath,
  extract(input: ExtractorFileInput): AssertionDraft[] {
    const shape = readShape(input);
    const drafts: AssertionDraft[] = [];

    const frontmatterTitle = shape.frontmatter.get("title");
    if (frontmatterTitle && frontmatterTitle.value.length > 0) {
      drafts.push(draft(
        "document.title",
        frontmatterTitle.value,
        frontmatterTitle.lineIndex,
        shape.lines[frontmatterTitle.lineIndex],
      ));
    }

    shape.lines.forEach((line, index) => {
      if (!isClaimLine(shape, index)) return;

      if (shape.markdown) {
        const heading = ATX_HEADING.exec(line);
        if (heading) {
          const level = heading[1].length;
          const text = normalizeText(heading[2]);
          if (text.length > 0) {
            drafts.push(draft("document.heading", `H${level}: ${text}`, index, line));
            if (level === 1) drafts.push(draft("document.title", text, index, line));
          }
          return;
        }
      }

      const plain = PLAIN_TITLE.exec(line);
      if (plain) {
        const text = normalizeText(stripWrappingEmphasis(plain[1]));
        if (text.length > 0) drafts.push(draft("document.title", text, index, line));
      }
    });

    return drafts;
  },
};

// ───────────────────── work-intelligence/v1 ─────────────────────

/** Every state a document may declare. A value outside this set is not a status. */
const WORK_STATUS_VALUES = [
  "wip", "draft", "planned", "blocked", "paused", "active",
  "done", "complete", "archived", "superseded", "cancelled",
] as const;

/** Every kind a document may declare. A value outside this set is not a kind. */
const WORK_KIND_VALUES = [
  "plan", "roadmap", "proposal", "design", "specification",
  "notes", "checklist", "decision", "research",
] as const;

const STATUS_SET: ReadonlySet<string> = new Set(WORK_STATUS_VALUES);
const KIND_SET: ReadonlySet<string> = new Set(WORK_KIND_VALUES);

/** `Status: wip` / `**State:** blocked`. The label is what makes it a claim. */
const STATUS_LABEL = /^\s*(?:[-*+]\s+)?(?:[*_]{0,2})(?:Status|State)(?:[*_]{0,2})\s*:\s*(.+)$/i;
/** `> **WIP**` — a leading admonition whose whole text is a status token. */
const ADMONITION = /^\s{0,3}>\s*(.+)$/;
/** How far into a document an admonition still reads as the document's own state. */
const ADMONITION_WINDOW = 10;
/** `# [WIP] Title`, `# WIP: Title`, `# Title (DRAFT)`. */
const TITLE_STATUS_MARKERS = [
  /^\s*\[([A-Za-z-]+)\]\s*/,
  /^\s*\(([A-Za-z-]+)\)\s*/,
  /^\s*([A-Za-z-]+)\s*[:—-]\s+/,
  /\s*\[([A-Za-z-]+)\]\s*$/,
  /\s*\(([A-Za-z-]+)\)\s*$/,
];

const KIND_LABEL = /^\s*(?:[-*+]\s+)?(?:[*_]{0,2})(?:Type|Kind)(?:[*_]{0,2})\s*:\s*(.+)$/i;

const TASK_UNCHECKED = /^\s*[-*+]\s+\[\s\]\s+(.+)$/;
const TASK_CHECKED = /^\s*[-*+]\s+\[[xX]\]\s+(.+)$/;
/** `TODO: ship it` at the start of a line. A `TODO` mid-sentence is prose. */
const TASK_TODO = /^\s*(?:[-*+]\s+)?(?:[*_]{0,2})TODO(?:[*_]{0,2})\s*:\s*(.+)$/;

/** `Milestone: beta` and `Milestone 2: GA`. */
const MILESTONE_LABEL = /^\s*(?:[-*+]\s+)?(?:[*_]{0,2})Milestone(?:\s+\d+)?(?:[*_]{0,2})\s*:\s*(.+)$/i;
const MILESTONE_HEADING = /^milestones?$/i;
const PLAIN_BULLET = /^\s*[-*+]\s+(.+)$/;

/**
 * Declared relationships, longest label first.
 *
 * Order matters: `Superseded by:` must be tested before `Supersedes` would match
 * a prefix of it, or a supersession would be recorded backwards.
 */
const RELATION_LABELS: { predicate: string; label: RegExp }[] = [
  { predicate: "work.superseded_by", label: /Superseded\s+by/i },
  { predicate: "work.superseded_by", label: /Replaced\s+by/i },
  { predicate: "work.supersedes", label: /Supersedes/i },
  { predicate: "work.supersedes", label: /Replaces/i },
  { predicate: "work.blocked_by", label: /Blocked\s+by/i },
  { predicate: "work.depends_on", label: /Depends\s+on/i },
  { predicate: "work.depends_on", label: /Depends\s+upon/i },
  { predicate: "work.depends_on", label: /Requires/i },
  { predicate: "work.references", label: /References/i },
  { predicate: "work.references", label: /Reference/i },
  { predicate: "work.references", label: /See\s+also/i },
  { predicate: "work.references", label: /Related/i },
];

function statusValueOf(raw: string): string | null {
  const value = normalizeText(stripEmphasis(raw)).toLowerCase().replace(/[.]+$/, "");
  return STATUS_SET.has(value) ? value : null;
}

function kindValueOf(raw: string): string | null {
  const value = normalizeText(stripEmphasis(raw)).toLowerCase().replace(/[.]+$/, "");
  return KIND_SET.has(value) ? value : null;
}

/** The kind a title names outright, e.g. "Deployment Roadmap" -> roadmap. */
function kindFromTitle(title: string): string | null {
  const words: string[] = normalizeText(stripEmphasis(title)).toLowerCase().match(/[a-z]+/g) ?? [];
  for (const kind of WORK_KIND_VALUES) {
    // Accept the plural a heading naturally uses ("Notes", "Decisions").
    if (words.includes(kind) || words.includes(`${kind}s`)) return kind;
  }
  return null;
}

/** A status marker attached to a title, e.g. "[WIP] Rollout" or "Rollout (draft)". */
function statusFromTitle(title: string): string | null {
  const text = normalizeText(stripEmphasis(title));
  for (const marker of TITLE_STATUS_MARKERS) {
    const match = marker.exec(text);
    if (match) {
      const value = statusValueOf(match[1]);
      if (value) return value;
    }
  }
  return null;
}

function frontmatterDraft(
  shape: DocumentShape,
  key: string,
  predicate: string,
  valueOf: (raw: string) => string | null,
): AssertionDraft | null {
  const entry = shape.frontmatter.get(key);
  if (!entry) return null;
  const value = valueOf(entry.value);
  return value ? draft(predicate, value, entry.lineIndex, shape.lines[entry.lineIndex]) : null;
}

/** Status and kind declared in frontmatter, and status/kind named by the title. */
function declaredStateDrafts(shape: DocumentShape): AssertionDraft[] {
  const drafts: AssertionDraft[] = [];

  const status = frontmatterDraft(shape, "status", "work.status", statusValueOf);
  if (status) drafts.push(status);
  for (const key of ["type", "kind"]) {
    const kind = frontmatterDraft(shape, key, "work.kind", kindValueOf);
    if (kind) drafts.push(kind);
  }

  const titleEntry = shape.frontmatter.get("title");
  if (titleEntry) drafts.push(...titleDerivedDrafts(shape, titleEntry.value, titleEntry.lineIndex));

  return drafts;
}

/**
 * What a title says about kind and state.
 *
 * A kind read out of a title is `medium`: "Deployment Roadmap" names a roadmap,
 * but a title is a name rather than a declaration field, so it carries less
 * weight than `kind: roadmap` written down as such.
 */
function titleDerivedDrafts(shape: DocumentShape, title: string, lineIndex: number): AssertionDraft[] {
  const drafts: AssertionDraft[] = [];
  const line = shape.lines[lineIndex];
  const kind = kindFromTitle(title);
  if (kind) drafts.push(draft("work.kind", kind, lineIndex, line, "medium"));
  const status = statusFromTitle(title);
  if (status) drafts.push(draft("work.status", status, lineIndex, line));
  return drafts;
}

/** A blockquote near the top whose entire text is a status token. */
function admonitionStatus(shape: DocumentShape, line: string, index: number): AssertionDraft | null {
  if (index >= shape.bodyStart + ADMONITION_WINDOW) return null;
  const match = ADMONITION.exec(line);
  if (!match) return null;
  const value = statusValueOf(match[1].replace(/^Status\s*:\s*/i, ""));
  return value ? draft("work.status", value, index, line) : null;
}

function labelledDrafts(line: string, index: number): AssertionDraft[] {
  const drafts: AssertionDraft[] = [];

  const status = STATUS_LABEL.exec(line);
  if (status) {
    const value = statusValueOf(status[1]);
    if (value) drafts.push(draft("work.status", value, index, line));
  }

  const kind = KIND_LABEL.exec(line);
  if (kind) {
    const value = kindValueOf(kind[1]);
    if (value) drafts.push(draft("work.kind", value, index, line));
  }

  return drafts;
}

function taskDrafts(line: string, index: number): AssertionDraft[] {
  const checked = TASK_CHECKED.exec(line);
  if (checked) {
    const text = normalizeText(checked[1]);
    return text ? [draft("work.task.completed", text, index, line)] : [];
  }
  const unchecked = TASK_UNCHECKED.exec(line);
  if (unchecked) {
    const text = normalizeText(unchecked[1]);
    return text ? [draft("work.task.open", text, index, line)] : [];
  }
  const todo = TASK_TODO.exec(line);
  if (todo) {
    const text = normalizeText(todo[1]);
    return text ? [draft("work.task.open", text, index, line)] : [];
  }
  return [];
}

function relationDrafts(line: string, index: number): AssertionDraft[] {
  for (const { predicate, label } of RELATION_LABELS) {
    const pattern = new RegExp(`^\\s*(?:[-*+]\\s+)?(?:[*_]{0,2})(?:${label.source})(?:[*_]{0,2})\\s*:\\s*(.+)$`, "i");
    const match = pattern.exec(line);
    if (match) {
      const target = normalizeText(stripWrappingEmphasis(match[1]));
      // The whole remainder is the declared target. Splitting a list on commas
      // would invent boundaries the author did not write.
      return target ? [draft(predicate, target, index, line)] : [];
    }
  }
  return [];
}

/**
 * Explicit work state: status, kind, tasks, milestones, and declared relations.
 *
 * Nothing here is inferred. Every assertion cites the line that states it, and a
 * document that declares nothing produces nothing rather than a default.
 */
export const workIntelligenceExtractor: Extractor = {
  id: "work-intelligence/v1",
  version: "1.0.0",
  subjectScope: "artifact",
  matches: claimsPath,
  extract(input: ExtractorFileInput): AssertionDraft[] {
    const shape = readShape(input);
    const drafts: AssertionDraft[] = [...declaredStateDrafts(shape)];
    let underMilestones = false;

    shape.lines.forEach((line, index) => {
      if (!isClaimLine(shape, index)) return;

      if (shape.markdown) {
        const heading = ATX_HEADING.exec(line);
        if (heading) {
          const text = normalizeText(heading[2]);
          underMilestones = MILESTONE_HEADING.test(text);
          if (heading[1].length === 1) drafts.push(...titleDerivedDrafts(shape, text, index));
          return;
        }
      }

      const admonition = admonitionStatus(shape, line, index);
      if (admonition) drafts.push(admonition);

      drafts.push(...labelledDrafts(line, index));

      const milestone = MILESTONE_LABEL.exec(line);
      if (milestone) {
        const text = normalizeText(milestone[1]);
        if (text) drafts.push(draft("work.milestone", text, index, line));
        return;
      }

      const tasks = taskDrafts(line, index);
      if (tasks.length > 0) {
        drafts.push(...tasks);
        return;
      }

      // A plain bullet under a Milestones heading is a milestone by position.
      // Checkbox bullets were already claimed above as tasks, which is the more
      // specific syntax.
      if (underMilestones) {
        const bullet = PLAIN_BULLET.exec(line);
        if (bullet) {
          const text = normalizeText(bullet[1]);
          if (text) drafts.push(draft("work.milestone", text, index, line));
          return;
        }
      }

      drafts.push(...relationDrafts(line, index));
    });

    return drafts;
  },
};

/** The predicates these rules can emit. Documentation and report rendering read it. */
export const WORK_INTELLIGENCE_PREDICATES = [
  "document.heading",
  "document.title",
  "work.blocked_by",
  "work.depends_on",
  "work.kind",
  "work.milestone",
  "work.references",
  "work.status",
  "work.superseded_by",
  "work.supersedes",
  "work.task.completed",
  "work.task.open",
] as const;

export const WORK_STATUS_VOCABULARY: readonly string[] = WORK_STATUS_VALUES;
export const WORK_KIND_VOCABULARY: readonly string[] = WORK_KIND_VALUES;
