"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORK_PREDICATES = exports.WORK_KIND_VOCABULARY = exports.WORK_STATUS_VOCABULARY = exports.workIntelligenceExtractor = exports.LEADING_ADMONITION_UNITS = exports.documentStructureExtractor = void 0;
exports.readTextUnit = readTextUnit;
exports.readTitleMarkers = readTitleMarkers;
exports.isMilestoneSectionHeading = isMilestoneSectionHeading;
exports.documentText = documentText;
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
    if (!isMarkdown(sourcePath)) {
        // Plain text has neither construct, so both regions are empty by definition.
        return { lines, frontmatterStart: -1, frontmatterEnd: -1, fenced: new Array(lines.length).fill(false) };
    }
    const [frontmatterStart, frontmatterEnd] = findFrontmatter(lines);
    return { lines, frontmatterStart, frontmatterEnd, fenced: markFencedCode(lines, frontmatterEnd) };
}
/** The frontmatter body's line span, or `[-1, -1]` when the document has none. */
function findFrontmatter(lines) {
    if (lines.length === 0 || lines[0].trim() !== "---")
        return [-1, -1];
    const limit = Math.min(lines.length, MAX_FRONTMATTER_LINES);
    for (let index = 1; index < limit; index++) {
        const trimmed = lines[index].trim();
        if (trimmed === "---" || trimmed === "...")
            return [1, index - 1];
    }
    return [-1, -1];
}
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/**
 * Which lines sit inside a fenced code block.
 *
 * A closing fence must use the same character as the one that opened it, so a
 * ``` block containing ~~~ stays open. Frontmatter is skipped: its `---` lines
 * are not fences, and its body is read as structured values elsewhere.
 */
function markFencedCode(lines, frontmatterEnd) {
    const fenced = new Array(lines.length).fill(false);
    let fence = null;
    for (let index = 0; index < lines.length; index++) {
        if (frontmatterEnd >= 0 && index <= frontmatterEnd + 1)
            continue;
        const match = FENCE.exec(lines[index]);
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
    return fenced;
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
/**
 * Strip markdown emphasis and backticks, then collapse whitespace.
 *
 * Global removal, so this is only correct where the result is matched against a
 * closed vocabulary — a label name, a status word, a kind word. Those contain no
 * `*`, `_` or backtick of their own, so removing every one is lossless.
 *
 * For text that is quoted back as an assertion object, use `plainText`.
 */
function plain(value) {
    return value.replace(EMPHASIS, "").replace(/\s+/g, " ").trim();
}
/**
 * Normalize free text that will be emitted as an assertion object.
 *
 * Unlike `plain`, only wrapping emphasis is removed. An object is a quotation:
 * the document wrote `ship_the_v2_pipeline` and the assertion has to say so.
 * Removing every underscore turns it into `shipthev2pipeline`, an identifier
 * that appears in no file and matches no search — the claim stops being evidence
 * of anything while still looking like it. `normalizeTarget` already draws this
 * line for relation targets; tasks, milestones, headings and titles are quoted
 * the same way and need it too.
 */
function plainText(value) {
    return unwrapEmphasis(value.trim()).replace(/\s+/g, " ").trim();
}
/** Length of the emphasis run at the start of a value. */
function leadingEmphasisRun(value) {
    let run = 0;
    while (run < value.length && isEmphasis(value[run]))
        run++;
    return run;
}
/** Length of the emphasis run at the end of a value. */
function trailingEmphasisRun(value) {
    let run = 0;
    while (run < value.length && isEmphasis(value[value.length - 1 - run]))
        run++;
    return run;
}
/**
 * Remove emphasis only where it wraps the whole value.
 *
 * `**Ship the release**` is a heading in bold and reads better without the
 * markers. `**urgent** fix` is a sentence with one emphasized word, and trimming
 * only what touches an edge would leave `urgent** fix` — a string the document
 * does not contain and nobody wrote. Emphasis is removed when both ends carry it
 * and left alone otherwise, so the object is always something a reader could find
 * in the file.
 */
function unwrapEmphasis(value) {
    let text = value;
    for (;;) {
        const run = Math.min(leadingEmphasisRun(text), trailingEmphasisRun(text));
        // A value that is nothing but emphasis characters has no inside to keep.
        if (run === 0 || text.length <= run * 2)
            return text;
        text = text.slice(run, text.length - run).trim();
    }
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
/** Wrappers a scalar may be enclosed in, opener to closer. */
const WRAPPERS = { '"': '"', "'": "'", "[": "]", "(": ")" };
const WHITESPACE = /\s/;
/**
 * Strip matching surrounding quotes, brackets or parentheses from a scalar.
 *
 * Walked inward from both ends rather than looped over whole-string replaces.
 * The loop this replaced re-scanned the entire value on every layer it removed,
 * so a deeply nested scalar cost a quadratic number of steps — 128ms at twenty
 * thousand nested brackets, and these scalars come out of documents this package
 * does not control. Each step here consumes at least one character.
 */
function unwrap(value) {
    let start = 0;
    let end = value.length;
    for (;;) {
        while (start < end && WHITESPACE.test(value[start]))
            start++;
        while (end > start && WHITESPACE.test(value[end - 1]))
            end--;
        if (end - start < 2)
            break;
        const closer = WRAPPERS[value[start]];
        if (closer === undefined || value[end - 1] !== closer)
            break;
        start++;
        end--;
    }
    return value.slice(start, end);
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
 * Why the tail of every pattern here captures with `[\s\S]` rather than `.`.
 *
 * `.` excludes `\r`, `\n`, `\u2028` and `\u2029`. A tail written `\s*(.*)$`
 * therefore lets two quantifiers compete for the same whitespace and then fail
 * at the anchor whenever one of those four characters appears later in the
 * string — and the engine retries every division of the whitespace before giving
 * up. Measured on a line carrying a lone carriage return: 16,000 characters in
 * 200ms, quadrupling with each doubling, so a 120 KiB line takes minutes.
 *
 * A lone `\r` is not a contrived input. `toLines` splits on `/\r?\n/`, so a
 * classic Mac line ending survives into what this module calls a line, and that
 * is precisely the vintage of document an archive of old plans is full of.
 *
 * `[\s\S]*` matches every character including those four, so the anchor is
 * reached on the first attempt and the pattern never backtracks. For a line with
 * no stray control character — every ordinary line — the two forms capture
 * exactly the same text.
 */
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
const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+([\s\S]*)$/;
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
        const text = plainText(trimRunEnd(match[2].trimEnd(), isHash));
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
        const text = unwrap(plainText(labelled.value));
        if (text.length > 0)
            out.push({ index, text });
    }
    return out.sort((left, right) => left.index - right.index);
}
function reading(predicate, object, excerpt, evidenceClass, confidence) {
    return { predicate, object, excerpt, evidenceClass, confidence };
}
/** Attach a line coordinate to a reading. Markdown, plain text and reST only. */
function draftAt(signal, index) {
    return {
        predicate: signal.predicate,
        object: signal.object,
        sourceRange: (0, common_1.lineRange)(index),
        evidenceExcerpt: signal.excerpt,
        evidenceClass: signal.evidenceClass,
        authority: "source",
        confidence: signal.confidence,
    };
}
function draft(predicate, object, index, line, evidenceClass, confidence) {
    return draftAt(reading(predicate, object, line, evidenceClass, confidence), index);
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
const CHECKBOX = /^\s{0,8}(?:[-*+]|\d{1,3}[.)])\s+\[([ xX])\]\s*([\s\S]*)$/;
/**
 * An explicit `TODO:` line, matched after the list prefix has been stripped.
 *
 * The prefix used to be spelled out a second time inside this pattern, which
 * made it the most complicated regex in the module and meant two places had to
 * agree about what a list marker looks like.
 */
const TODO_LINE = /^(?:\*\*|__)?TODO(?:\*\*|__)?\s*:\s*([\s\S]+)$/;
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
        const text = plainText(bullet[1].replace(/^\[[ xX]\]\s*/, ""));
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
/**
 * A checkbox whose list marker is not in the text.
 *
 * Markdown writes a task as `- [ ] ship it`, so the marker and the box arrive
 * together. A Word or PowerPoint list item carries its marker in the document's
 * numbering definition and its text as `[ ] ship it`; the decoder records that
 * structure as the block's `list_item` kind rather than by inventing a bullet
 * character. Requiring the marker in the text would therefore read every
 * Markdown checklist and no Word one, which is the same file failing to be
 * understood because of the program it was written in.
 */
const BARE_CHECKBOX = /^\s{0,8}\[([ xX])\]\s*([\s\S]*)$/;
/** A task written as list syntax: a checkbox, or a line that opens with `TODO:`. */
function taskSignal(line, listMarkerImplied = false) {
    const checkbox = CHECKBOX.exec(line) ?? (listMarkerImplied ? BARE_CHECKBOX.exec(line) : null);
    if (checkbox) {
        const text = plainText(checkbox[2]);
        if (text.length === 0)
            return null;
        const predicate = checkbox[1] === " " ? "work.task.open" : "work.task.completed";
        return reading(predicate, text, line, "observed", "high");
    }
    const todo = TODO_LINE.exec(line.replace(LIST_PREFIX, ""));
    if (todo === null)
        return null;
    const text = plainText(todo[1]);
    return text.length === 0 ? null : reading("work.task.open", text, line, "observed", "high");
}
/**
 * A bare status admonition.
 *
 * Only counts near the top of a document — `> **BLOCKED**` under a heading
 * halfway down is about that section, not about the file — so the caller decides
 * whether this reader is offered the text at all. The position rule lives there
 * because "near the top" is measured in lines in a text file and in blocks in a
 * decoded one, and this reader knows about neither.
 */
function admonitionSignal(line) {
    const admonition = BLOCKQUOTE_STATUS.exec(line);
    if (admonition === null)
        return null;
    const status = statusValue(admonition[1]);
    return status === null ? null : reading("work.status", status, line, "declared", "high");
}
/** A `Label: value` declaration: a status, a milestone, or a declared relation. */
function labelSignal(line) {
    if (ATX_HEADING.test(line))
        return null;
    const labelled = labelledLine(line);
    if (labelled === null || labelled.value.length === 0)
        return null;
    if (labelled.label === "status" || labelled.label === "state") {
        const status = statusValue(labelled.value);
        return status === null ? null : reading("work.status", status, line, "declared", "high");
    }
    if (MILESTONE_LABEL.test(labelled.label)) {
        const text = plainText(labelled.value);
        return text.length === 0 ? null : reading("work.milestone", text, line, "declared", "high");
    }
    const predicate = RELATION_PREDICATE_BY_LABEL[labelled.label];
    if (predicate === undefined)
        return null;
    const target = normalizeTarget(labelled.value);
    return target.length === 0 ? null : reading(predicate, target, line, "declared", "high");
}
/**
 * Text-unit readers, in the order a unit is offered to them.
 *
 * The order is the precedence: a checkbox is read as a task rather than as a
 * label, and a heading is never read as a declaration. The first reader to
 * return a reading claims the text.
 *
 * A reader that recognizes a unit's syntax but produces nothing from it — an
 * empty checkbox, a `TODO:` whose text is only emphasis — lets the remaining
 * readers see it. That is safe because the three syntaxes are mutually
 * exclusive: a line that opens with a list marker cannot be a blockquote
 * admonition, and a checkbox with no text has nothing after it to be a label.
 */
const UNIT_READERS = [
    taskSignal,
    admonitionSignal,
    labelSignal,
];
/**
 * Read one unit of text with the whole vocabulary, in precedence order.
 *
 * `admonitionsAllowed` is the caller's answer to "is this near the top of the
 * document", which is the only positional question any of these rules asks.
 * `listMarkerImplied` is its answer to "did the source say this was a list item
 * some way other than by writing a bullet".
 *
 * Exported because the block-driven reader in `./document_blocks` must apply
 * exactly these rules to a paragraph of a Word document or a shape on a slide. A
 * second implementation of "what is a status declaration" would eventually
 * disagree with this one, and a corpus would then report a `.docx` plan and the
 * `.md` copy of it beside it as saying different things.
 */
function readTextUnit(line, options) {
    for (const read of UNIT_READERS) {
        if (read === admonitionSignal && !options.admonitionsAllowed)
            continue;
        const signal = read(line, options.listMarkerImplied === true);
        if (signal !== null)
            return signal;
    }
    return null;
}
/**
 * Status and kind markers a declared title carries.
 *
 * Exported for the block reader, which meets titles as `title` blocks rather
 * than as `# ` lines but must read the same markers out of them.
 */
function readTitleMarkers(text, excerpt) {
    const signals = [];
    for (const status of titleStatuses(text)) {
        signals.push(reading("work.status", status, excerpt, "declared", "medium"));
    }
    for (const kind of titleKinds(text)) {
        signals.push(reading("work.kind", kind, excerpt, "declared", "medium"));
    }
    return signals;
}
/** True for a heading that opens an explicit milestone list. */
function isMilestoneSectionHeading(text) {
    return /^milestones:?$/i.test(plainText(text).trim());
}
/** Normalize a fragment of document text for use as an assertion object. */
function documentText(value) {
    return plainText(value);
}
/** How far into a document a bare status admonition still counts as leading. */
exports.LEADING_ADMONITION_UNITS = LEADING_ADMONITION_LINES;
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
            const signal = readTextUnit(view.lines[index], {
                admonitionsAllowed: index < LEADING_ADMONITION_LINES,
            });
            if (signal !== null)
                drafts.push(draftAt(signal, index));
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