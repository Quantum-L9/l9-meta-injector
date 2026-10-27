"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contractInvariantsExtractor = exports.serviceSpecExtractor = exports.manifestExtractor = void 0;
const common_1 = require("./common");
// ───────────────────────────── manifest/v1 ─────────────────────────────
/** Dependency names worth reporting as a framework or server declaration. */
const FRAMEWORK_DEPENDENCIES = new Set([
    "fastapi",
    "django",
    "flask",
    "starlette",
    "express",
    "next",
    "nestjs",
    "axum",
    "actix-web",
    "rocket",
]);
const SERVER_DEPENDENCIES = new Set(["uvicorn", "gunicorn", "hypercorn", "daphne", "waitress"]);
/** One `package.dependency` claim plus the framework/server reading of its name. */
function dependencyDrafts(name, index, line, servers) {
    const drafts = [(0, common_1.declared)("package.dependency", name, index, line, "medium")];
    if (FRAMEWORK_DEPENDENCIES.has(name))
        drafts.push((0, common_1.declared)("package.framework", name, index, line));
    // Cargo never read the server vocabulary (it names Python servers).
    if (servers && SERVER_DEPENDENCIES.has(name))
        drafts.push((0, common_1.declared)("package.server", name, index, line));
    return drafts;
}
/**
 * A TOML table header, or null when the line is not one.
 *
 * `[[name]]` (an array of tables) is a section change like `[name]`, but it never
 * names a dependency or package table: its keys describe one element of a list
 * (a `[[bin]]` target, a `[[tool.poetry.source]]` index), so `array` lets the
 * caller refuse to read them as declarations.
 */
function tomlHeader(bare) {
    const arrayMatch = /^\[\[([^\]]+)\]\]$/.exec(bare);
    if (arrayMatch)
        return { name: arrayMatch[1].trim(), array: true };
    const tableMatch = /^\[([^\]]+)\]$/.exec(bare);
    if (tableMatch)
        return { name: tableMatch[1].trim(), array: false };
    return null;
}
/**
 * A `key = value` pair. The pattern matches only the fixed-structure prefix and
 * the value is taken by slice, so the cost is linear in the line length on any
 * input (a quantified tail before `$` backtracks quadratically on characters `.`
 * does not match).
 */
function tomlPair(bare) {
    const prefix = /^([A-Za-z0-9_.-]+)\s*=/.exec(bare);
    if (!prefix)
        return null;
    const rawValue = bare.slice(prefix[0].length).trim();
    if (rawValue === "")
        return null;
    return { key: prefix[1], rawValue };
}
/**
 * Poetry tables whose keys are dependency names.
 *
 * An exact set, not a suffix: `[project.optional-dependencies]` also ends in
 * "dependencies", but its keys are extras group names. Poetry dev groups are
 * kept as they were read before (DEC-RC-093).
 */
function isPoetryDependencyTable(name) {
    return (name === "tool.poetry.dependencies" ||
        name === "tool.poetry.dev-dependencies" ||
        /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(name));
}
/**
 * Read a TOML array of strings that opens at `lines[startIndex]` offset `start`
 * (the character after `=`), across as many lines as it spans.
 *
 * Returns each string element with the line it appears on, and the index of the
 * line holding the closing `]`. Returns null when the value is not a plain array
 * of strings or is never closed: an array this reader cannot bound is reported as
 * nothing rather than as a guess.
 */
function tomlStringArray(lines, startIndex, start) {
    const elements = [];
    let opened = false;
    for (let index = startIndex; index < lines.length; index++) {
        const line = lines[index];
        let position = index === startIndex ? start : 0;
        while (position < line.length) {
            const character = line[position];
            if (character === " " || character === "\t" || character === ",") {
                position++;
                continue;
            }
            if (character === "#")
                break;
            if (!opened) {
                if (character !== "[")
                    return null;
                opened = true;
                position++;
                continue;
            }
            if (character === "]")
                return { elements, endIndex: index };
            if (character === '"' || character === "'") {
                // Triple-quoted strings are not requirement strings; refuse them.
                if (line.startsWith(character.repeat(3), position))
                    return null;
                let value = "";
                let cursor = position + 1;
                let closed = false;
                while (cursor < line.length) {
                    const next = line[cursor];
                    if (character === '"' && next === "\\" && cursor + 1 < line.length) {
                        value += line[cursor + 1];
                        cursor += 2;
                        continue;
                    }
                    if (next === character) {
                        closed = true;
                        break;
                    }
                    value += next;
                    cursor++;
                }
                // Single-line strings cannot continue onto the next line.
                if (!closed)
                    return null;
                elements.push({ value, index });
                position = cursor + 1;
                continue;
            }
            // Anything else (a nested array, an inline table, a bare word) is not a
            // requirement list this reader understands.
            return null;
        }
    }
    return null;
}
/** The distribution name a PEP 508 requirement starts with, lower-cased; null when none. */
function requirementName(requirement) {
    const match = /^\s*[A-Za-z0-9][A-Za-z0-9._-]*/.exec(requirement);
    if (!match)
        return null;
    // PEP 508 names end in a letter or digit; trailing separators are not part of
    // the name. Trimmed by index, not by an unanchored pattern, to stay linear.
    let name = match[0].trim();
    let end = name.length;
    while (end > 0 && ".-_".includes(name[end - 1]))
        end--;
    name = name.slice(0, end);
    return name === "" ? null : name.toLowerCase();
}
function pyprojectAssertions(lines) {
    const drafts = [];
    let section = "";
    let arraySection = false;
    let sawPoetry = false;
    let sawBuildBackend = false;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const bare = (0, common_1.stripComment)(line).trim();
        const header = tomlHeader(bare);
        if (header) {
            section = header.name;
            arraySection = header.array;
            if (!arraySection && section === "tool.poetry")
                sawPoetry = true;
            continue;
        }
        // Keys of an array-of-tables element are never package or dependency fields.
        if (arraySection)
            continue;
        const pair = tomlPair(bare);
        if (!pair)
            continue;
        const { key, rawValue } = pair;
        const value = (0, common_1.unquote)(rawValue);
        if ((section === "tool.poetry" || section === "project") && key === "name") {
            drafts.push((0, common_1.declared)("package.name", value, index, line));
            continue;
        }
        if (section === "project" && key === "dependencies" && rawValue.startsWith("[")) {
            // PEP 621: an array of PEP 508 requirement strings, possibly multi-line.
            const equals = line.indexOf("=");
            const array = equals < 0 ? null : tomlStringArray(lines, index, equals + 1);
            if (!array)
                continue;
            for (const element of array.elements) {
                const name = requirementName(element.value);
                if (name)
                    drafts.push(...dependencyDrafts(name, element.index, lines[element.index], true));
            }
            index = array.endIndex;
            continue;
        }
        if (section === "build-system" && key === "build-backend") {
            sawBuildBackend = true;
            // `poetry.core.masonry.api` names the packaging system in use.
            const system = value.split(".")[0];
            drafts.push((0, common_1.declared)("package.build_backend", value, index, line));
            if (system)
                drafts.push((0, common_1.declared)("package.packaging_system", system, index, line));
            continue;
        }
        if (isPoetryDependencyTable(section)) {
            if (key === "python") {
                drafts.push((0, common_1.declared)("package.python_constraint", value, index, line));
                continue;
            }
            drafts.push(...dependencyDrafts(key.toLowerCase(), index, line, true));
        }
    }
    // `[tool.poetry]` alone is a packaging declaration even without a build-system.
    if (sawPoetry && !sawBuildBackend) {
        const index = lines.findIndex((line) => (0, common_1.stripComment)(line).trim() === "[tool.poetry]");
        if (index >= 0)
            drafts.push((0, common_1.declared)("package.packaging_system", "poetry", index, lines[index]));
    }
    return drafts;
}
/** A JSON string token's value, decoded; the raw text when it does not decode. */
function decodeJsonString(raw) {
    try {
        const decoded = JSON.parse(`"${raw}"`);
        return typeof decoded === "string" ? decoded : raw;
    }
    catch {
        return raw;
    }
}
/**
 * package.json read with a string-aware depth scan.
 *
 * `name` and `version` are read only at depth 1 (the top-level object), and
 * dependency entries only at depth 2 inside the top-level `dependencies` object,
 * however the file is laid out: one key per line, inline objects, or minified on
 * a single line. Each claim cites the line its key is on. A malformed file stops
 * the scan where it stops being attributable — an unterminated string or an
 * unbalanced closer ends the read, keeping only claims already made at a known
 * depth.
 */
function packageJsonAssertions(lines) {
    const drafts = [];
    const stack = [];
    let started = false;
    const valueString = (frame, value) => {
        if (frame.kind !== "object" || frame.key === null)
            return;
        const key = frame.key;
        const index = frame.keyIndex;
        if (stack.length === 1) {
            if (key === "name")
                drafts.push((0, common_1.declared)("package.name", value, index, lines[index]));
            if (key === "version")
                drafts.push((0, common_1.declared)("package.version", value, index, lines[index]));
        }
        else if (stack.length === 2 && frame.dependencies) {
            drafts.push(...dependencyDrafts(key.toLowerCase(), index, lines[index], true));
        }
    };
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        let position = 0;
        while (position < line.length) {
            const character = line[position];
            const top = stack[stack.length - 1];
            if (character === '"') {
                let cursor = position + 1;
                while (cursor < line.length && line[cursor] !== '"') {
                    cursor += line[cursor] === "\\" ? 2 : 1;
                }
                // JSON strings never span lines: an unterminated one ends the read.
                if (cursor >= line.length)
                    return drafts;
                const text = decodeJsonString(line.slice(position + 1, cursor));
                position = cursor + 1;
                if (!top)
                    continue;
                if (top.kind === "object" && top.key === null) {
                    top.key = text;
                    top.keyIndex = index;
                    top.awaitingColon = true;
                }
                else if (top.kind === "object" && !top.awaitingColon) {
                    valueString(top, text);
                    top.key = null;
                }
                continue;
            }
            if (character === ":") {
                if (top && top.kind === "object")
                    top.awaitingColon = false;
                position++;
                continue;
            }
            if (character === "{" || character === "[") {
                if (stack.length === 0 && started)
                    return drafts;
                started = true;
                const opensDependencies = character === "{" &&
                    stack.length === 1 &&
                    top !== undefined &&
                    top.kind === "object" &&
                    top.key === "dependencies" &&
                    !top.awaitingColon;
                stack.push({
                    kind: character === "{" ? "object" : "array",
                    dependencies: opensDependencies,
                    key: null,
                    keyIndex: -1,
                    awaitingColon: false,
                });
                position++;
                continue;
            }
            if (character === "}" || character === "]") {
                const closing = stack.pop();
                if (!closing || closing.kind !== (character === "}" ? "object" : "array"))
                    return drafts;
                const parent = stack[stack.length - 1];
                if (parent && parent.kind === "object")
                    parent.key = null;
                position++;
                continue;
            }
            if (character === ",") {
                if (top && top.kind === "object")
                    top.key = null;
                position++;
                continue;
            }
            // Whitespace and scalar literals (numbers, true/false/null): a scalar
            // value ends its key's pair at the next `,` or closer.
            position++;
        }
    }
    return drafts;
}
function cargoAssertions(lines) {
    const drafts = [];
    let section = "";
    let arraySection = false;
    lines.forEach((line, index) => {
        const bare = (0, common_1.stripComment)(line).trim();
        const header = tomlHeader(bare);
        if (header) {
            section = header.name;
            arraySection = header.array;
            return;
        }
        // `[[bin]]`, `[[example]]`, ... describe targets, not the package.
        if (arraySection)
            return;
        const pair = tomlPair(bare);
        if (!pair)
            return;
        const value = (0, common_1.unquote)(pair.rawValue);
        if (section === "package" && pair.key === "name") {
            drafts.push((0, common_1.declared)("package.name", value, index, line), (0, common_1.declared)("package.packaging_system", "cargo", index, line));
        }
        if (section === "dependencies") {
            drafts.push(...dependencyDrafts(pair.key.toLowerCase(), index, line, false));
        }
    });
    return drafts;
}
exports.manifestExtractor = {
    id: "manifest/v1",
    // 1.1.0: array-of-tables headers end a section, extras groups are not
    // dependency tables, PEP 621 dependency arrays are read, and package.json is
    // read by depth rather than by line shape (RC-093); BOM and lone-CR aware
    // lines (RC-096).
    version: "1.1.0",
    matches(sourcePath) {
        return ((0, common_1.basenameIs)(sourcePath, "pyproject.toml") ||
            (0, common_1.basenameIs)(sourcePath, "package.json") ||
            (0, common_1.basenameIs)(sourcePath, "Cargo.toml"));
    },
    extract(input) {
        const lines = (0, common_1.toLines)(input.content);
        if ((0, common_1.basenameIs)(input.sourcePath, "pyproject.toml"))
            return pyprojectAssertions(lines);
        if ((0, common_1.basenameIs)(input.sourcePath, "package.json"))
            return packageJsonAssertions(lines);
        return cargoAssertions(lines);
    },
};
// ───────────────────────────── service-spec/v1 ─────────────────────────────
exports.serviceSpecExtractor = {
    id: "service-spec/v1",
    // 1.1.0: BOM and lone-CR aware lines (RC-096); linear key/value reading (RC-094).
    version: "1.1.0",
    matches(sourcePath) {
        return (0, common_1.basenameIs)(sourcePath, "spec.yaml") || (0, common_1.basenameIs)(sourcePath, "spec.yml");
    },
    extract(input) {
        const drafts = [];
        const lines = (0, common_1.toLines)(input.content);
        let block = null;
        lines.forEach((line, index) => {
            const pair = (0, common_1.keyValue)(line);
            if (!pair)
                return;
            if (pair.indent === 0) {
                if (pair.key === "service")
                    block = "service";
                else if (pair.key === "actions")
                    block = "actions";
                else
                    block = null;
                return;
            }
            if (block === "service") {
                if (pair.key === "name" && pair.value) {
                    drafts.push((0, common_1.declared)("service.name", pair.value, index, line));
                }
                if (pair.key === "version" && pair.value) {
                    drafts.push((0, common_1.declared)("service.version", pair.value, index, line));
                }
                return;
            }
            if (block === "actions" && pair.key === "name" && pair.value) {
                // A list item under `actions:` names one action the spec declares.
                if (/^\s*-\s+/.test((0, common_1.stripComment)(line))) {
                    drafts.push((0, common_1.declared)("service.action", pair.value, index, line));
                }
            }
        });
        return drafts;
    },
};
// ─────────────────────── contract-invariants/v1 ───────────────────────
/**
 * Invariant vocabulary this profile recognizes.
 *
 * Each entry names a canonical predicate object and the phrases that evidence
 * it. The extractor reports only that the contract file states the invariant —
 * never that the repository upholds it.
 *
 * A phrase is a sequence of terms that must occur in order within one sentence
 * (a stretch of the line without a `.`). This is what the patterns used to say
 * with `X[^.\n]*Y` gaps, but an unanchored gap rescans to the end of the line
 * from every occurrence of `X`, which is quadratic in the number of occurrences.
 * Searching each term from where the previous one ended reads each sentence a
 * bounded number of times; taking the earliest occurrence of every term is
 * enough, because an earlier end never leaves less room for the terms after it.
 */
const INVARIANT_RULES = [
    {
        object: "gate-compatible-ingress",
        phrases: [
            [/\bgate[- ]compatible\b/gi],
            [/\bthrough\s+(?:the\s+)?gate\b/gi],
            [/\bgate\s+ingress\b/gi],
            [/\benters?\s+through\s+gate\b/gi],
        ],
    },
    {
        object: "tenant-context-immutable",
        phrases: [
            [/\btenant[_ ]context\b/gi, /\bimmutable\b/gi],
            [/\bimmutable\b/gi, /\btenant\b/gi],
        ],
    },
    {
        object: "packets-derived-not-mutated",
        phrases: [
            [/\bderivation\b/gi, /\b(?:not|never)\b/gi, /\bmutat/gi],
            [/\bderived?\b/gi, /\brather\s+than\b/gi, /\bmutat/gi],
            [/\bderived?,?\s+(?:not|never)\s+mutat/gi],
            [/\bnever\s+mutat/gi],
        ],
    },
    {
        object: "replay-is-explicit",
        phrases: [
            [/\breplay\b/gi, /\bexplicit\b/gi],
            [/\bexplicit\b/gi, /\breplay\b/gi],
        ],
    },
    {
        object: "lineage-is-reconstructable",
        phrases: [
            [/\blineage\b/gi, /\breconstruct/gi],
            [/\breconstruct\w*\b/gi, /\blineage\b/gi],
            [/\blineage\b/gi, /\btraceable\b/gi],
        ],
    },
];
/** True when `terms` occur in order in `sentence`, each after the previous one ended. */
function phraseOccurs(sentence, terms) {
    let from = 0;
    for (const term of terms) {
        term.lastIndex = from;
        const match = term.exec(sentence);
        if (!match)
            return false;
        from = match.index + match[0].length;
    }
    return true;
}
/** True when any phrase of the rule occurs within one sentence of the line. */
function statesInvariant(sentences, phrases) {
    return phrases.some((terms) => sentences.some((sentence) => phraseOccurs(sentence, terms)));
}
exports.contractInvariantsExtractor = {
    id: "contract-invariants/v1",
    // 1.1.0: BOM and lone-CR aware lines (RC-096); linear phrase evaluation (RC-094).
    version: "1.1.0",
    matches(sourcePath) {
        return /^contracts\/.+\.(ya?ml|md)$/.test(sourcePath);
    },
    extract(input) {
        const drafts = [];
        const lines = (0, common_1.toLines)(input.content);
        // One assertion per invariant per file: the first line that evidences it.
        const claimed = new Set();
        lines.forEach((line, index) => {
            // `[^.\n]` bounded every gap: no phrase spans a `.`.
            const sentences = line.split(".");
            for (const rule of INVARIANT_RULES) {
                if (claimed.has(rule.object))
                    continue;
                if (statesInvariant(sentences, rule.phrases)) {
                    claimed.add(rule.object);
                    drafts.push((0, common_1.declared)("contract.invariant", rule.object, index, line));
                }
            }
        });
        if (drafts.length > 0) {
            drafts.push({
                predicate: "contract.declares_invariants",
                object: input.sourcePath,
                sourceRange: (0, common_1.spanRange)(0, Math.max(0, lines.length - 1)),
                evidenceExcerpt: `contract file stating ${drafts.length} recognized invariant(s)`,
                evidenceClass: "declared",
                authority: "source",
                confidence: "high",
            });
        }
        return drafts;
    },
};
//# sourceMappingURL=structured.js.map