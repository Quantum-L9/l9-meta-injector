"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pythonRouteObservationExtractor = exports.repositoryStatusExtractor = exports.declaredAuthorityExtractor = void 0;
const common_1 = require("./common");
// ─────────────────────── declared-authority/v1 ───────────────────────
/** Lines that open a canonical-authority list. */
const AUTHORITY_HEADERS = [
    /\btreat\s+the\s+following\s+as\s+canonical\b/i,
    /\bthe\s+following\s+(?:files\s+)?are\s+canonical\b/i,
    /\bcanonical\s+(?:contracts|files|sources|authority)\s*:/i,
    /\bsource\s+of\s+truth\s*:/i,
];
/** A markdown bullet naming a backticked path. */
const BULLET_PATH = /^\s*[-*+]\s+`([^`]+)`/;
exports.declaredAuthorityExtractor = {
    id: "declared-authority/v1",
    version: "1.0.0",
    matches(sourcePath) {
        return ((0, common_1.basenameIs)(sourcePath, "AGENTS.md") ||
            (0, common_1.basenameIs)(sourcePath, "CLAUDE.md") ||
            (0, common_1.basenameIs)(sourcePath, "GOVERNANCE.md"));
    },
    extract(input) {
        const drafts = [];
        const lines = (0, common_1.toLines)(input.content);
        for (let index = 0; index < lines.length; index++) {
            if (!AUTHORITY_HEADERS.some((pattern) => pattern.test(lines[index])))
                continue;
            // Consume the contiguous bullet list that follows, skipping blank lines
            // between the header and the first bullet.
            let cursor = index + 1;
            while (cursor < lines.length && lines[cursor].trim() === "")
                cursor++;
            let found = 0;
            while (cursor < lines.length) {
                const match = BULLET_PATH.exec(lines[cursor]);
                if (!match)
                    break;
                const referenced = match[1].trim();
                drafts.push((0, common_1.declared)("authority.canonical_contract", referenced, cursor, lines[cursor]));
                if (!input.pathExists(referenced)) {
                    // The document's authority claim is real; its target is not present.
                    drafts.push((0, common_1.declared)("authority.unresolved_reference", referenced, cursor, lines[cursor], "medium"));
                }
                found++;
                cursor++;
            }
            if (found > 0) {
                drafts.push({
                    predicate: "authority.canonical_contract_count",
                    object: String(found),
                    sourceRange: { start_line: index + 1, end_line: cursor },
                    evidenceExcerpt: lines[index],
                    evidenceClass: "declared",
                    authority: "source",
                    confidence: "high",
                });
            }
            index = cursor - 1;
        }
        return drafts;
    },
};
// ─────────────────────── repository-status/v1 ───────────────────────
/** Bounded status vocabulary. Only these words carry a lifecycle claim. */
const STATUS_TERMS = [
    { object: "deprecated", pattern: /\bdeprecated\b/i },
    { object: "archived", pattern: /\barchived\b/i },
    { object: "superseded", pattern: /\bsuperseded\b/i },
    { object: "experimental", pattern: /\bexperimental\b/i },
    { object: "maintenance-only", pattern: /\bmaintenance[- ]only\b/i },
];
/** Explicit pointers to a replacement. */
const REPLACEMENT_PATTERNS = [
    /\b(?:ssot\s+)?replacement\s*:\s*(.+)$/i,
    /\breplaced\s+by\s+(.+)$/i,
    /\buse\s+\[?([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\]?\s+instead\b/i,
];
/** Self-description claims that assert a current role. */
const ROLE_PATTERNS = [
    { object: "reference-implementation", pattern: /\bthe\s+reference\s+implementation\b/i },
    { object: "bootstrap-template", pattern: /\b(?:org\s+)?bootstrap\s+template\b/i },
    { object: "starter-template", pattern: /\bstarter\s+template\b/i },
];
/** First markdown link target, or the trimmed text when there is no link. */
function firstReference(value) {
    const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(value);
    if (link)
        return link[1].trim();
    const trimmed = value.replace(/[*_`]/g, "").trim();
    return trimmed.length > 0 ? trimmed : null;
}
/** A blockquote or bold-lead line — the shapes a status admonition takes. */
function isAdmonition(line) {
    const trimmed = line.trim();
    return trimmed.startsWith(">") || /^\*\*/.test(trimmed);
}
exports.repositoryStatusExtractor = {
    id: "repository-status/v1",
    version: "1.0.0",
    matches(sourcePath) {
        return (0, common_1.basenameIs)(sourcePath, "README.md");
    },
    extract(input) {
        const drafts = [];
        const lines = (0, common_1.toLines)(input.content);
        lines.forEach((line, index) => {
            const admonition = isAdmonition(line);
            // A lifecycle status only counts inside a high-authority admonition, so
            // prose merely mentioning the word "deprecated" is not a status claim.
            if (admonition) {
                for (const term of STATUS_TERMS) {
                    if (term.pattern.test(line)) {
                        drafts.push((0, common_1.declared)("repository.status", term.object, index, line));
                    }
                }
                for (const pattern of REPLACEMENT_PATTERNS) {
                    const match = pattern.exec(line.replace(/^\s*>\s*/, ""));
                    if (match) {
                        const reference = firstReference(match[1]);
                        if (reference) {
                            drafts.push((0, common_1.declared)("repository.replaced_by", reference, index, line));
                        }
                        break;
                    }
                }
            }
            // A role claim is recorded wherever it appears. Where it contradicts a
            // status admonition above, both survive and the consumer reconciles them.
            for (const role of ROLE_PATTERNS) {
                if (role.pattern.test(line)) {
                    const negated = /\bdo not use\b|\bnot\b\s+(?:an?|the)\b/i.test(line);
                    drafts.push((0, common_1.declared)(negated ? "repository.disclaimed_role" : "repository.self_described_role", role.object, index, line, admonition ? "high" : "medium"));
                }
            }
        });
        return drafts;
    },
};
// ─────────────────── python-route-observation/v1 ───────────────────
/** `@app.get("/health")` and friends, including `@router.post(...)`. */
const ROUTE_DECORATOR = /^\s*@([A-Za-z_]\w*)\.(get|post|put|patch|delete|head|options)\s*\(\s*["']([^"']+)["']/;
const DEF_LINE = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
/** Markers observable inside a handler body. Reported, never interpreted. */
const BODY_MARKERS = [
    { object: "todo-marker", pattern: /#\s*TODO\b|#\s*FIXME\b/i },
    { object: "not-implemented-error", pattern: /\braise\s+NotImplementedError\b/ },
    { object: "bare-pass", pattern: /^\s*pass\s*$/ },
];
exports.pythonRouteObservationExtractor = {
    id: "python-route-observation/v1",
    version: "1.0.0",
    matches(sourcePath) {
        return sourcePath.endsWith(".py");
    },
    extract(input) {
        const drafts = [];
        const lines = (0, common_1.toLines)(input.content);
        for (let index = 0; index < lines.length; index++) {
            const decorator = ROUTE_DECORATOR.exec(lines[index]);
            if (!decorator)
                continue;
            const [, , verb, routePath] = decorator;
            const method = verb.toUpperCase();
            // Find the handler this decorator applies to, skipping stacked decorators.
            let cursor = index + 1;
            while (cursor < lines.length && /^\s*@/.test(lines[cursor]))
                cursor++;
            const definition = cursor < lines.length ? DEF_LINE.exec(lines[cursor]) : null;
            if (!definition) {
                // A decorator with no reachable def is not a route observation.
                continue;
            }
            const handler = definition[1];
            const defIndent = lines[cursor].search(/\S/);
            drafts.push({
                predicate: "http.route",
                object: `${method} ${routePath}`,
                sourceRange: { start_line: index + 1, end_line: cursor + 1 },
                evidenceExcerpt: `${lines[index].trim()} ${lines[cursor].trim()}`,
                evidenceClass: "observed",
                authority: "source",
                confidence: "high",
            });
            drafts.push({
                predicate: "http.route_handler",
                object: `${method} ${routePath} -> ${handler}`,
                sourceRange: { start_line: cursor + 1, end_line: cursor + 1 },
                evidenceExcerpt: lines[cursor].trim(),
                evidenceClass: "observed",
                authority: "source",
                confidence: "high",
            });
            // Scan the handler body: from the def to the next line at or below its
            // indentation. Markers are reported as present, with no claim about what
            // their presence implies for the endpoint's behavior.
            const seen = new Set();
            for (let body = cursor + 1; body < lines.length; body++) {
                const line = lines[body];
                if (line.trim() !== "") {
                    const indent = line.search(/\S/);
                    if (indent <= defIndent)
                        break;
                }
                for (const marker of BODY_MARKERS) {
                    if (seen.has(marker.object))
                        continue;
                    if (marker.pattern.test(line)) {
                        seen.add(marker.object);
                        drafts.push({
                            predicate: "http.handler_body_marker",
                            object: `${handler}: ${marker.object}`,
                            sourceRange: (0, common_1.lineRange)(body),
                            evidenceExcerpt: line.trim(),
                            evidenceClass: "observed",
                            authority: "source",
                            confidence: "high",
                        });
                    }
                }
            }
            index = cursor;
        }
        return drafts;
    },
};
//# sourceMappingURL=prose.js.map