"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORK_PREDICATES = exports.WORK_KIND_VOCABULARY = exports.WORK_STATUS_VOCABULARY = exports.workIntelligenceExtractor = exports.documentStructureExtractor = void 0;
const common_1 = require("./common");
// ───────────────────────────── file eligibility ─────────────────────────────
/** Extensions this profile reads. v1 adds no document-format extraction. */
const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".rst"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
/**
 * Lowercase extension of a source path.
 *
 * Written by hand rather than with `path.extname` because a source path here may
 * be a virtual archive locator (`Bundle.zip!/docs/a.md`), and the answer must not
 * depend on the host platform's separator.
 */
function extensionOf(sourcePath) {
    const slash = sourcePath.lastIndexOf("/");
    const name = slash >= 0 ? sourcePath.slice(slash + 1) : sourcePath;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot).toLowerCase() : "";
}
function isSupportedTextDocument(sourcePath) {
    return SUPPORTED_EXTENSIONS.has(extensionOf(sourcePath));
}
function isMarkdown(sourcePath) {
    return MARKDOWN_EXTENSIONS.has(extensionOf(sourcePath));
}
// ───────────────────────────── document scaffolding ─────────────────────────────
/** Longest frontmatter block this reader will walk before giving up. */
const MAX_FRONTMATTER_LINES = 200;
/** How far into a document a bare status admonition still counts as leading. */
const LEADING_ADMONITION_LINES = 10;
/**
 * Split a document into the regions extraction has to tell apart.
 *
 * Fenced code is tracked because a shell transcript containing `# deploy` is not
 * a heading and `- [ ] item` inside an example is not a task. Frontmatter is
 * tracked because its fields are read as structured values, and reading them a
 * second time as prose labels would emit every field twice.
 */
function readDocument(sourcePath, content) {
    const lines = (0, common_1.toLines)(content);
    const markdown = isMarkdown(sourcePath);
    let frontmatterStart = -1;
    let frontmatterEnd = -1;
    if (markdown && lines.length > 0 && lines[0].trim() === "---") {
        const limit = Math.min(lines.length, MAX_FRONTMATTER_LINES);
        for (let index = 1; index < limit; index++) {
            const trimmed = lines[index].trim();
            if (trimmed === "---" || trimmed === "...") {
                frontmatterStart = 1;
                frontmatterEnd = index - 1;
                break;
            }
        }
    }
    const fenced = new Array(lines.length).fill(false);
    if (markdown) {
        let fence = null;
        for (let index = 0; index < lines.length; index++) {
            if (frontmatterStart >= 0 && index <= frontmatterEnd + 1)
                continue;
            const match = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[index]);
            if (fence === null) {
                if (match) {
                    fence = match[1][0];
                    fenced[index] = true;
                }
                continue;
            }
            fenced[index] = true;
            if (match?.[1].startsWith(fence))
                fence = null;
        }
    }
    return { lines, frontmatterStart, frontmatterEnd, fenced };
}
function inFrontmatter(view, index) {
    return view.frontmatterStart >= 0 && index >= view.frontmatterStart && index <= view.frontmatterEnd;
}
/** True for a line that carries no readable body content: frontmatter or code. */
function isProseLine(view, index) {
    if (inFrontmatter(view, index))
        return false;
    if (view.frontmatterStart >= 0 && (index === 0 || index === view.frontmatterEnd + 1))
        return false;
    return !view.fenced[index];
}
// ───────────────────────────── scalar normalization ─────────────────────────────
const EMPHASIS = /[*_`]/g;
/** Strip markdown emphasis and backticks, then collapse whitespace. */
function plain(value) {
    return value.replace(EMPHASIS, "").replace(/\s+/g, " ").trim();
}
/**
 * Trim a run of characters from the front of a string.
 *
 * Scanned rather than matched, for the reason given on `trimRunEnd`.
 */
function trimRunStart(value, isTrimmable) {
    let start = 0;
    while (start < value.length && isTrimmable(value[start]))
        start++;
    return start === 0 ? value : value.slice(start);
}
/**
 * Trim a run of characters from the end of a string.
 *
 * A `$`-anchored quantifier looks linear here and is not. `String.replace` retries
 * the match at every start position, and each attempt scans to the end, so
 * stripping a trailing run costs a quadratic number of steps: a hundred thousand
 * asterisks measured at eleven seconds, and these strings come from documents
 * inside archives this package does not control. Scanning inward from the end
 * costs one step per character trimmed.
 */
function trimRunEnd(value, isTrimmable) {
    let end = value.length;
    while (end > 0 && isTrimmable(value[end - 1]))
        end--;
    return end === value.length ? value : value.slice(0, end);
}
const isEmphasis = (character) => character === "*" || character === "_";
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const isNotAlphanumeric = (character) => !ALPHANUMERIC.test(character);
/**
 * Remove leading and trailing runs of markdown emphasis characters.
 *
 * The alternation this replaced — `(?:\*\*|__|\*|_)+` — was ambiguous: a run of
 * asterisks can be divided into pairs or singles in exponentially many ways, and
 * against an anchor that ultimately fails the engine tries all of them.
 */
function stripEmphasis(value) {
    return trimRunEnd(trimRunStart(value, isEmphasis), isEmphasis).trim();
}
/** Strip matching surrounding quotes, brackets or parentheses from a scalar. */
function unwrap(value) {
    let current = value.trim();
    for (;;) {
        const next = current
            .replace(/^"(.*)"$/s, "$1")
            .replace(/^'(.*)'$/s, "$1")
            .replace(/^\[(.*)\]$/s, "$1")
            .replace(/^\((.*)\)$/s, "$1")
            .trim();
        if (next === current)
            return current;
        current = next;
    }
}
/**
 * The declared target of a relation line, normalized without being interpreted.
 *
 * A whole-value markdown link resolves to its target because `[the plan](plan.md)`
 * declares `plan.md` and the label is presentation. Everything else is kept as
 * written: splitting a comma list or resolving a fuzzy filename would be this
 * module asserting something the document did not.
 */
function normalizeTarget(value) {
    const trimmed = stripEmphasis(value.trim());
    const link = /^\[[^\]]*\]\(\s*<?([^)\s]+)>?\s*(?:"[^"]*")?\)$/.exec(trimmed);
    if (link)
        return link[1].trim();
    const autolink = /^<([^>\s]+)>$/.exec(trimmed);
    if (autolink)
        return autolink[1].trim();
    const code = /^`([^`]+)`$/.exec(trimmed);
    if (code)
        return code[1].trim();
    return trimmed.replace(/\s+/g, " ");
}
const LIST_PREFIX = /^\s{0,8}(?:>\s?)*(?:[-*+]\s+|\d{1,3}[.)]\s+)?/;
/**
 * A label is letters, digits and spaces, starting with a letter.
 *
 * Restrictive on purpose: anything carrying a slash, a dot or punctuation is not
 * a label, which is what stops a sentence containing a URL or a path from being
 * read as a declaration. Digits are allowed for the `Milestone 3:` form.
 */
const LABEL_SHAPE = /^[a-z][a-z0-9 ]{0,23}$/;
/**
 * Read `Label: value` from a line, tolerating the markup people actually write.
 *
 * `**Status:** WIP`, `- Depends on: a.md`, `> Blocked by: review` all reduce to
 * the same pair. The label shape is deliberately restrictive: anything carrying a
 * slash, digit or punctuation is not a label, which is what keeps a sentence
 * containing a URL from being read as a declaration.
 */
function labelledLine(rawLine) {
    const body = rawLine.replace(LIST_PREFIX, "");
    const colon = body.indexOf(":");
    if (colon < 0)
        return null;
    const label = plain(body.slice(0, colon)).toLowerCase();
    if (!LABEL_SHAPE.test(label))
        return null;
    const value = body.slice(colon + 1).trim().replace(/^[*_]+/, "").trim();
    return { label, value };
}
// ───────────────────────────── vocabulary ─────────────────────────────
const WORK_STATUS_VALUES = [
    "active", "archived", "blocked", "cancelled", "complete", "done",
    "draft", "paused", "planned", "superseded", "wip",
];
const WORK_STATUS = new Set(WORK_STATUS_VALUES);
const WORK_KIND_VALUES = [
    "checklist", "decision", "design", "notes", "plan", "proposal",
    "research", "roadmap", "specification",
];
const WORK_KIND = new Set(WORK_KIND_VALUES);
/**
 * Status words that may be read from a title without brackets.
 *
 * `WIP` and `DRAFT` are markers; nobody titles a document `WIP` by accident. The
 * rest of the vocabulary is ordinary English — "Complete Guide to Routing" is not
 * a completed document — so those are recognized in a title only when bracketed.
 */
const BARE_TITLE_STATUS = new Set(["draft", "wip"]);
const RELATION_PREDICATE_BY_LABEL = {
    "depends on": "work.depends_on",
    "depends upon": "work.depends_on",
    "requires": "work.depends_on",
    "blocked by": "work.blocked_by",
    "reference": "work.references",
    "references": "work.references",
    "see also": "work.references",
    "related": "work.references",
    "supersedes": "work.supersedes",
    "replaces": "work.supersedes",
    "superseded by": "work.superseded_by",
    "replaced by": "work.superseded_by",
};
/** A declared status word, or null when the value is not one of them. */
function statusValue(raw) {
    const bare = unwrap(plain(raw));
    const candidate = trimRunEnd(trimRunStart(bare, isNotAlphanumeric), isNotAlphanumeric).toLowerCase();
    return WORK_STATUS.has(candidate) ? candidate : null;
}
/** A declared kind word, or null when the value is not one of them. */
function kindValue(raw) {
    const candidate = unwrap(plain(raw)).toLowerCase();
    return WORK_KIND.has(candidate) ? candidate : null;
}
// ───────────────────────────── structure reading ─────────────────────────────
/**
 * An ATX heading, split only as far as the marker.
 *
 * The closing `#` run is trimmed afterwards by a scan rather than matched here.
 * Expressing it inline as `(.*?)\s*#*\s*$` makes the trailing whitespace
 * attributable to either of two `\s*` groups, and the engine tries every split:
 * a heading line of five thousand characters shaped `# … ### … x` measured at
 * twenty-six seconds. This form always succeeds once a marker and a space are
 * present, so it never backtracks at all.
 */
const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const isHash = (character) => character === "#";
/** Every ATX heading outside frontmatter and fenced code, in document order. */
function headings(view) {
    const out = [];
    for (let index = 0; index < view.lines.length; index++) {
        if (!isProseLine(view, index))
            continue;
        const match = ATX_HEADING.exec(view.lines[index]);
        if (!match)
            continue;
        const text = plain(trimRunEnd(match[2].trimEnd(), isHash));
        if (text.length === 0)
            continue;
        out.push({ index, level: match[1].length, text });
    }
    return out;
}
/** A frontmatter mapping key. Anchored on both ends, so it cannot backtrack. */
const FRONTMATTER_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** Frontmatter `key: value` scalars, in document order. */
function frontmatterFields(view) {
    const out = [];
    if (view.frontmatterStart < 0)
        return out;
    for (let index = view.frontmatterStart; index <= view.frontmatterEnd; index++) {
        // Split at the first colon and validate the key, rather than expressing the
        // whole line as one pattern: `key\s*:` lets a long run of key characters and
        // a long run of spaces be divided many ways when the colon is absent.
        const line = view.lines[index];
        const colon = line.indexOf(":");
        if (colon < 0)
            continue;
        const key = line.slice(0, colon).trimEnd();
        if (!FRONTMATTER_KEY.test(key))
            continue;
        out.push({ index, key: key.toLowerCase(), value: line.slice(colon + 1).trim() });
    }
    return out;
}
/** Every title this document declares about itself, with the line that declares it. */
function titleDeclarations(view) {
    const out = [];
    for (const field of frontmatterFields(view)) {
        if (field.key !== "title")
            continue;
        const text = unwrap(field.value);
        if (text.length > 0)
            out.push({ index: field.index, text });
    }
    for (const heading of headings(view)) {
        if (heading.level === 1)
            out.push({ index: heading.index, text: heading.text });
    }
    for (let index = 0; index < view.lines.length; index++) {
        if (!isProseLine(view, index))
            continue;
        if (ATX_HEADING.test(view.lines[index]))
            continue;
        const labelled = labelledLine(view.lines[index]);
        if (labelled?.label !== "title")
            continue;
        const text = unwrap(plain(labelled.value));
        if (text.length > 0)
            out.push({ index, text });
    }
    return out.sort((left, right) => left.index - right.index);
}
// ───────────────────────────── draft helpers ─────────────────────────────
function draft(predicate, object, index, line, evidenceClass, confidence) {
    return {
        predicate,
        object,
        sourceRange: (0, common_1.lineRange)(index),
        evidenceExcerpt: line,
        evidenceClass,
        authority: "source",
        confidence,
    };
}
// ───────────────────────── document-structure/v1 ─────────────────────────
/**
 * What a document says it is called and how it is organized.
 *
 * Titles are emitted from every form the document uses, even when they disagree:
 * a frontmatter `title` and an `# H1` that differ is a fact about the document,
 * and picking a winner here would hide it.
 */
exports.documentStructureExtractor = {
    id: "document-structure/v1",
    version: "1.0.0",
    subjectScope: "artifact",
    matches: isSupportedTextDocument,
    extract(input) {
        const view = readDocument(input.sourcePath, input.content);
        const drafts = [];
        for (const title of titleDeclarations(view)) {
            drafts.push(draft("document.title", title.text, title.index, view.lines[title.index], "declared", "high"));
        }
        for (const heading of headings(view)) {
            drafts.push(draft("document.heading", `H${heading.level}: ${heading.text}`, heading.index, view.lines[heading.index], "observed", "high"));
        }
        return drafts;
    },
};
// ───────────────────────── work-intelligence/v1 ─────────────────────────
const CHECKBOX = /^\s{0,8}(?:[-*+]|\d{1,3}[.)])\s+\[([ xX])\]\s*(.*)$/;
const TODO_LINE = /^\s{0,8}(?:>\s?)*(?:[-*+]\s+|\d{1,3}[.)]\s+)?(?:\*\*|__)?TODO(?:\*\*|__)?\s*:\s*(.+)$/;
const BULLET = /^\s{0,3}(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;
const MILESTONE_LABEL = /^milestone(?: [a-z0-9.]{1,8})?$/;
const BLOCKQUOTE_STATUS = /^\s{0,3}>\s*(?:\*\*|__)?\[?([A-Za-z]+)\]?(?:\*\*|__)?\s*(?::.*)?$/;
/** Where a title stops saying what the document is and starts qualifying it. */
const TITLE_SEGMENT = / [—–|] | - |[:(]/u;
/** Status markers a title carries, with the reason each one counts. */
function titleStatuses(text) {
    const found = [];
    for (const match of text.matchAll(/[[(]\s*([A-Za-z][A-Za-z ]{0,20}?)\s*[\])]/g)) {
        const status = statusValue(match[1]);
        if (status !== null)
            found.push(status);
    }
    const prefix = /^([A-Za-z]+)\s*[:\-–—]/.exec(text);
    if (prefix) {
        const status = statusValue(prefix[1]);
        if (status !== null && BARE_TITLE_STATUS.has(status))
            found.push(status);
    }
    const suffix = /[:\-–—]\s*([A-Za-z]+)\s*$/.exec(text);
    if (suffix) {
        const status = statusValue(suffix[1]);
        if (status !== null && BARE_TITLE_STATUS.has(status))
            found.push(status);
    }
    return found;
}
/**
 * Kind words a title names outright, e.g. `# Deployment Roadmap` -> `roadmap`.
 *
 * Only the first or last word of the title's leading segment counts. A kind word
 * loose in the middle of a name is usually part of the name rather than a
 * statement about the document: "L9 Perplexity Research Agent" is an agent, not a
 * piece of research, while "Implementation Roadmap — 6-Phase Rollout" and "Plan
 * for the migration" both say what they are. This narrowing came from running the
 * profile over a real repository and reading what it claimed.
 */
function titleKinds(text) {
    // Whitespace is collapsed first, in one linear pass, so the separators below
    // are literal. Matching ` +[—–|] +` against a title carrying a long whitespace
    // run costs a quadratic number of steps for every split position it fails at.
    const segment = plain(text).split(TITLE_SEGMENT)[0];
    const words = segment.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length > 0);
    if (words.length === 0)
        return [];
    const found = [];
    for (const word of new Set([words[0], words[words.length - 1]])) {
        if (WORK_KIND.has(word))
            found.push(word);
    }
    return found;
}
/** Line indexes that open an explicit milestone list. */
function milestoneSectionOpeners(view) {
    const openers = [];
    for (const heading of headings(view)) {
        if (/^milestones:?$/i.test(heading.text))
            openers.push(heading.index);
    }
    for (let index = 0; index < view.lines.length; index++) {
        if (!isProseLine(view, index))
            continue;
        if (ATX_HEADING.test(view.lines[index]))
            continue;
        if (/^\s{0,3}(?:\*\*|__)?milestones(?:\*\*|__)?\s*:\s*$/i.test(view.lines[index]))
            openers.push(index);
    }
    return [...new Set(openers)].sort((left, right) => left - right);
}
/** Bullets belonging to one milestone section, up to the next heading or blank run. */
function milestoneSectionBullets(view, opener) {
    const out = [];
    for (let index = opener + 1; index < view.lines.length; index++) {
        if (!isProseLine(view, index))
            break;
        const line = view.lines[index];
        if (ATX_HEADING.test(line))
            break;
        if (line.trim() === "") {
            // A blank line inside a list is ordinary; a blank line after the list has
            // ended is the section boundary. Stop only once bullets have been seen and
            // the next content line is not one.
            if (out.length === 0)
                continue;
            const next = view.lines[index + 1];
            if (next === undefined || !BULLET.test(next))
                break;
            continue;
        }
        const bullet = BULLET.exec(line);
        if (!bullet) {
            if (out.length > 0)
                break;
            continue;
        }
        // A milestone written as a checklist item is still a milestone; the checkbox
        // marker is task syntax, not part of the milestone's text.
        const text = plain(bullet[1].replace(/^\[[ xX]\]\s*/, ""));
        if (text.length > 0)
            out.push({ index, text });
    }
    return out;
}
/** What the frontmatter block declares outright. */
function frontmatterSignals(view) {
    const drafts = [];
    for (const field of frontmatterFields(view)) {
        const line = view.lines[field.index];
        const status = field.key === "status" || field.key === "state" ? statusValue(field.value) : null;
        if (status !== null)
            drafts.push(draft("work.status", status, field.index, line, "declared", "high"));
        const kind = field.key === "type" || field.key === "kind" ? kindValue(field.value) : null;
        if (kind !== null)
            drafts.push(draft("work.kind", kind, field.index, line, "declared", "high"));
    }
    return drafts;
}
/**
 * What a title marks.
 *
 * Weaker than a structured field, and recorded as such: a title is a name first
 * and a statement about the document second.
 */
function titleSignals(view) {
    const drafts = [];
    for (const title of titleDeclarations(view)) {
        const line = view.lines[title.index];
        for (const status of titleStatuses(title.text)) {
            drafts.push(draft("work.status", status, title.index, line, "declared", "medium"));
        }
        for (const kind of titleKinds(title.text)) {
            drafts.push(draft("work.kind", kind, title.index, line, "declared", "medium"));
        }
    }
    return drafts;
}
/** Bullets under every explicit milestone section. */
function milestoneSectionSignals(view) {
    const drafts = [];
    for (const opener of milestoneSectionOpeners(view)) {
        for (const bullet of milestoneSectionBullets(view, opener)) {
            drafts.push(draft("work.milestone", bullet.text, bullet.index, view.lines[bullet.index], "observed", "high"));
        }
    }
    return drafts;
}
/** A task written as list syntax: a checkbox, or a line that opens with `TODO:`. */
function taskSignal(line, index) {
    const checkbox = CHECKBOX.exec(line);
    if (checkbox) {
        const text = plain(checkbox[2]);
        if (text.length === 0)
            return null;
        const predicate = checkbox[1] === " " ? "work.task.open" : "work.task.completed";
        return draft(predicate, text, index, line, "observed", "high");
    }
    const todo = TODO_LINE.exec(line);
    if (todo === null)
        return null;
    const text = plain(todo[1]);
    return text.length === 0 ? null : draft("work.task.open", text, index, line, "observed", "high");
}
/** A bare status admonition, which only counts near the top of a document. */
function admonitionSignal(line, index) {
    if (index >= LEADING_ADMONITION_LINES)
        return null;
    const admonition = BLOCKQUOTE_STATUS.exec(line);
    if (admonition === null)
        return null;
    const status = statusValue(admonition[1]);
    return status === null ? null : draft("work.status", status, index, line, "declared", "high");
}
/** A `Label: value` declaration: a status, a milestone, or a declared relation. */
function labelSignal(line, index) {
    if (ATX_HEADING.test(line))
        return null;
    const labelled = labelledLine(line);
    if (labelled === null || labelled.value.length === 0)
        return null;
    if (labelled.label === "status" || labelled.label === "state") {
        const status = statusValue(labelled.value);
        return status === null ? null : draft("work.status", status, index, line, "declared", "high");
    }
    if (MILESTONE_LABEL.test(labelled.label)) {
        const text = plain(labelled.value);
        return text.length === 0 ? null : draft("work.milestone", text, index, line, "declared", "high");
    }
    const predicate = RELATION_PREDICATE_BY_LABEL[labelled.label];
    if (predicate === undefined)
        return null;
    const target = normalizeTarget(labelled.value);
    return target.length === 0 ? null : draft(predicate, target, index, line, "declared", "high");
}
/**
 * Line-oriented readers, in the order a line is offered to them.
 *
 * The order is the precedence: a checkbox is read as a task rather than as a
 * label, and a heading is never read as a declaration. The first reader to
 * return a draft claims the line.
 *
 * A reader that recognizes a line's syntax but produces nothing from it — an
 * empty checkbox, a `TODO:` whose text is only emphasis — lets the remaining
 * readers see the line. That is safe because the three syntaxes are mutually
 * exclusive: a line that opens with a list marker cannot be a blockquote
 * admonition, and a checkbox with no text has nothing after it to be a label.
 */
const LINE_READERS = [
    taskSignal,
    admonitionSignal,
    labelSignal,
];
/**
 * Explicit work state: status, kind, tasks, milestones, and declared relations.
 *
 * Every rule here recognizes a form the document chose deliberately. Nothing is
 * read from a path, a filename, a modification time, or the absence of a signal.
 */
exports.workIntelligenceExtractor = {
    id: "work-intelligence/v1",
    version: "1.0.0",
    subjectScope: "artifact",
    matches: isSupportedTextDocument,
    extract(input) {
        const view = readDocument(input.sourcePath, input.content);
        const drafts = [
            ...frontmatterSignals(view),
            ...titleSignals(view),
            ...milestoneSectionSignals(view),
        ];
        for (let index = 0; index < view.lines.length; index++) {
            if (!isProseLine(view, index))
                continue;
            for (const read of LINE_READERS) {
                const signal = read(view.lines[index], index);
                if (signal !== null) {
                    drafts.push(signal);
                    break;
                }
            }
        }
        return drafts;
    },
};
/** The vocabularies this profile recognizes, for documentation and reporting. */
exports.WORK_STATUS_VOCABULARY = WORK_STATUS_VALUES;
exports.WORK_KIND_VOCABULARY = WORK_KIND_VALUES;
/** Every predicate the work-intelligence profile can emit, in code-point order. */
exports.WORK_PREDICATES = [
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
];
//# sourceMappingURL=work_intelligence.js.map