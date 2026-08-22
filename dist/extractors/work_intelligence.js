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
            if (match && match[1][0] === fence)
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
    const trimmed = value.trim().replace(/^(?:\*\*|__|\*|_)+/, "").replace(/(?:\*\*|__|\*|_)+$/, "").trim();
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
    const value = body.slice(colon + 1).trim().replace(/^(?:\*\*|__|\*|_)+/, "").trim();
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
    const candidate = unwrap(plain(raw))
        .replace(/^[^\p{L}\p{N}]+/u, "")
        .replace(/[^\p{L}\p{N}]+$/u, "")
        .toLowerCase();
    return WORK_STATUS.has(candidate) ? candidate : null;
}
/** A declared kind word, or null when the value is not one of them. */
function kindValue(raw) {
    const candidate = unwrap(plain(raw)).toLowerCase();
    return WORK_KIND.has(candidate) ? candidate : null;
}
// ───────────────────────────── structure reading ─────────────────────────────
const ATX_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
/** Every ATX heading outside frontmatter and fenced code, in document order. */
function headings(view) {
    const out = [];
    for (let index = 0; index < view.lines.length; index++) {
        if (!isProseLine(view, index))
            continue;
        const match = ATX_HEADING.exec(view.lines[index]);
        if (!match)
            continue;
        const text = plain(match[2]);
        if (text.length === 0)
            continue;
        out.push({ index, level: match[1].length, text });
    }
    return out;
}
/** Frontmatter `key: value` scalars, in document order. */
function frontmatterFields(view) {
    const out = [];
    if (view.frontmatterStart < 0)
        return out;
    for (let index = view.frontmatterStart; index <= view.frontmatterEnd; index++) {
        const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(view.lines[index]);
        if (!match)
            continue;
        out.push({ index, key: match[1].toLowerCase(), value: match[2].trim() });
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
        if (labelled === null || labelled.label !== "title")
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
    const segment = text.split(/\s+[—–|]\s+|\s+-\s+|[:(]/u)[0];
    const words = segment.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length > 0);
    if (words.length === 0)
        return [];
    const found = [];
    for (const word of [...new Set([words[0], words[words.length - 1]])]) {
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
        const { lines } = view;
        const drafts = [];
        // Structured frontmatter fields.
        for (const field of frontmatterFields(view)) {
            if (field.key === "status" || field.key === "state") {
                const status = statusValue(field.value);
                if (status !== null) {
                    drafts.push(draft("work.status", status, field.index, lines[field.index], "declared", "high"));
                }
            }
            if (field.key === "type" || field.key === "kind") {
                const kind = kindValue(field.value);
                if (kind !== null) {
                    drafts.push(draft("work.kind", kind, field.index, lines[field.index], "declared", "high"));
                }
            }
        }
        // Title markers. Weaker than a status field, and recorded as such.
        for (const title of titleDeclarations(view)) {
            for (const status of titleStatuses(title.text)) {
                drafts.push(draft("work.status", status, title.index, lines[title.index], "declared", "medium"));
            }
            for (const kind of titleKinds(title.text)) {
                drafts.push(draft("work.kind", kind, title.index, lines[title.index], "declared", "medium"));
            }
        }
        const milestoneOpeners = new Set(milestoneSectionOpeners(view));
        for (const opener of milestoneOpeners) {
            for (const bullet of milestoneSectionBullets(view, opener)) {
                drafts.push(draft("work.milestone", bullet.text, bullet.index, lines[bullet.index], "observed", "high"));
            }
        }
        for (let index = 0; index < lines.length; index++) {
            if (!isProseLine(view, index))
                continue;
            const line = lines[index];
            const checkbox = CHECKBOX.exec(line);
            if (checkbox) {
                const text = plain(checkbox[2]);
                if (text.length > 0) {
                    const predicate = checkbox[1] === " " ? "work.task.open" : "work.task.completed";
                    drafts.push(draft(predicate, text, index, line, "observed", "high"));
                }
                continue;
            }
            const todo = TODO_LINE.exec(line);
            if (todo) {
                const text = plain(todo[1]);
                if (text.length > 0)
                    drafts.push(draft("work.task.open", text, index, line, "observed", "high"));
                continue;
            }
            if (index < LEADING_ADMONITION_LINES) {
                const admonition = BLOCKQUOTE_STATUS.exec(line);
                if (admonition) {
                    const status = statusValue(admonition[1]);
                    if (status !== null) {
                        drafts.push(draft("work.status", status, index, line, "declared", "high"));
                        continue;
                    }
                }
            }
            if (ATX_HEADING.test(line))
                continue;
            const labelled = labelledLine(line);
            if (labelled === null || labelled.value.length === 0)
                continue;
            if (labelled.label === "status" || labelled.label === "state") {
                const status = statusValue(labelled.value);
                if (status !== null) {
                    drafts.push(draft("work.status", status, index, line, "declared", "high"));
                }
                continue;
            }
            if (MILESTONE_LABEL.test(labelled.label)) {
                const text = plain(labelled.value);
                if (text.length > 0)
                    drafts.push(draft("work.milestone", text, index, line, "declared", "high"));
                continue;
            }
            const predicate = RELATION_PREDICATE_BY_LABEL[labelled.label];
            if (predicate !== undefined) {
                const target = normalizeTarget(labelled.value);
                if (target.length > 0)
                    drafts.push(draft(predicate, target, index, line, "declared", "high"));
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