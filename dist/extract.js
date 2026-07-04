"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.contentHash = contentHash;
exports.estimateTokens = estimateTokens;
exports.extract = extract;
exports.splitContent = splitContent;
exports.stripExistingFrontMatter = stripExistingFrontMatter;
// extract.ts — Structured-grammar extraction: AST/regex for code, frontmatter for .md
// Rule: parse what has grammar; for prose fields return UNKNOWN (assist.ts fills those).
const crypto = __importStar(require("crypto"));
const schema_1 = require("./schema");
const llm_1 = require("./llm");
function contentHash(text) {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
function estimateTokens(text) {
    return (0, llm_1.getAdapter)().estimateTokens(text);
}
function extractList(body, heading) {
    const m = body.match(heading);
    if (!m || m.index === undefined)
        return schema_1.UNKNOWN;
    const start = m.index + m[0].length;
    const nextHeading = /\n## /;
    const nextMatch = body.slice(start).match(nextHeading);
    const section = nextMatch ? body.slice(start, start + (nextMatch.index ?? body.length)) : body.slice(start);
    const items = section.match(/^[-*]\s+.+/gm)?.map((l) => l.replace(/^[-*]\s+/, "").trim()) ?? [];
    return items.length > 0 ? items : schema_1.UNKNOWN;
}
function extractScalar(body, patterns) {
    for (const p of patterns) {
        const m = body.match(p);
        if (m?.[1]?.trim())
            return m[1].trim();
    }
    return schema_1.UNKNOWN;
}
// Regex-seed patterns for prose sections.
// Prose fields NOT extracted here — assist.ts handles description/activation_signals/contracts.
function extract(body) {
    return {
        role: extractScalar(body, [/^##\s+Role[ \t]*\n+([^\n#]+)/m, /\*\*Role\*\*:?\s*([^\n]+)/]),
        objective: extractScalar(body, [/^##\s+Objective[ \t]*\n+([^\n#]+)/m, /\*\*Objective\*\*:?\s*([^\n]+)/]),
        constraints: extractList(body, /^##\s+Constraints?\s*$/m),
        validationGates: extractList(body, /^##\s+Validation Gates?\s*$/m),
        stopConditions: extractList(body, /^##\s+Stop Conditions?\s*$/m),
        phaseModel: extractList(body, /^##\s+(Phase Model|Phases)\s*$/m),
        inputVariables: extractList(body, /^##\s+Input Variables?\s*$/m),
        outputFormat: extractScalar(body, [/^##\s+Output Format[ \t]*\n+([^\n#]+)/m, /\*\*Output Format\*\*:?\s*([^\n]+)/]),
        modelTarget: extractScalar(body, [/^##\s+Model[ _-]?Target[ \t]*\n+([^\n#]+)/mi, /model[_-]?target:?\s*([^\n,]+)/i, /\*\*Model Target\*\*:?\s*([^\n]+)/]),
    };
}
function splitContent(raw) {
    if (raw.startsWith("---\n") || raw.startsWith("---\r\n")) {
        const end = raw.indexOf("\n---", 4);
        if (end !== -1) {
            const fm = raw.slice(0, end + 4);
            const rest = raw.slice(end + 4).replace(/^\n/, "");
            return { frontMatter: fm, body: rest, headerConvention: "full-yaml" };
        }
    }
    if (/^[a-zA-Z_]+:\s+.+/m.test(raw.slice(0, 300)))
        return { frontMatter: null, body: raw, headerConvention: "bare-yaml" };
    if (/\|.+\|.+\|/.test(raw.slice(0, 500)))
        return { frontMatter: null, body: raw, headerConvention: "prose-table" };
    return { frontMatter: null, body: raw, headerConvention: "none" };
}
function stripExistingFrontMatter(raw) {
    if (raw.startsWith("---\n") || raw.startsWith("---\r\n")) {
        const end = raw.indexOf("\n---", 4);
        if (end !== -1)
            return raw.slice(end + 4).replace(/^\n/, "");
    }
    return raw;
}
//# sourceMappingURL=extract.js.map