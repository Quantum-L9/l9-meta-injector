"use strict";
/**
 * Repository metadata-authority loading and validation.
 *
 * The authority file is intentionally parsed with a narrow, fail-closed grammar.
 * It accepts only the l9.meta-authority/v1 shape and never attempts permissive
 * YAML recovery. A malformed authority declaration is an error, not an invitation
 * to infer repository policy.
 */
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
exports.META_AUTHORITY_RELATIVE_PATH = void 0;
exports.parseAuthorityYaml = parseAuthorityYaml;
exports.loadRepositoryAuthority = loadRepositoryAuthority;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const operation_contracts_1 = require("./operation_contracts");
exports.META_AUTHORITY_RELATIVE_PATH = ".l9/meta-authority.yaml";
class AuthorityParseError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "AuthorityParseError";
        this.code = code;
    }
}
function fail(code, message) {
    throw new AuthorityParseError(code, message);
}
function stripInlineComment(line) {
    let single = false;
    let double = false;
    let escaped = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\" && double) {
            escaped = true;
            continue;
        }
        if (char === "'" && !double)
            single = !single;
        else if (char === '"' && !single)
            double = !double;
        else if (char === "#" && !single && !double && (i === 0 || /\s/.test(line[i - 1]))) {
            return line.slice(0, i).replace(/\s+$/, "");
        }
    }
    return line.replace(/\s+$/, "");
}
function scalar(raw) {
    const value = raw.trim();
    if (!value)
        fail("META_AUTHORITY_CONFIG_INVALID", "empty scalar value");
    if (value.startsWith('"') || value.endsWith('"')) {
        if (!(value.startsWith('"') && value.endsWith('"') && value.length >= 2)) {
            fail("META_AUTHORITY_CONFIG_INVALID", `unbalanced double quote in '${value}'`);
        }
        try {
            return JSON.parse(value);
        }
        catch {
            fail("META_AUTHORITY_CONFIG_INVALID", `invalid double-quoted scalar '${value}'`);
        }
    }
    if (value.startsWith("'") || value.endsWith("'")) {
        if (!(value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
            fail("META_AUTHORITY_CONFIG_INVALID", `unbalanced single quote in '${value}'`);
        }
        return value.slice(1, -1).replace(/''/g, "'");
    }
    if (/^[\[\]{}&*!>|%@`]/.test(value)) {
        fail("META_AUTHORITY_CONFIG_INVALID", `unsupported YAML scalar '${value}'`);
    }
    return value;
}
function parseInlineList(raw) {
    const value = raw.trim();
    if (value === "[]")
        return [];
    if (!value.startsWith("[") || !value.endsWith("]")) {
        fail("META_AUTHORITY_CONFIG_INVALID", `expected inline list, got '${value}'`);
    }
    const body = value.slice(1, -1).trim();
    if (!body)
        return [];
    const items = [];
    let current = "";
    let single = false;
    let double = false;
    let escaped = false;
    for (const char of body) {
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === "\\" && double) {
            current += char;
            escaped = true;
            continue;
        }
        if (char === "'" && !double)
            single = !single;
        else if (char === '"' && !single)
            double = !double;
        if (char === "," && !single && !double) {
            items.push(scalar(current));
            current = "";
        }
        else {
            current += char;
        }
    }
    if (single || double || escaped) {
        fail("META_AUTHORITY_CONFIG_INVALID", "unterminated quote in inline list");
    }
    items.push(scalar(current));
    return items;
}
function assertIndent(line) {
    if (line.includes("\t"))
        fail("META_AUTHORITY_CONFIG_INVALID", "tabs are forbidden in authority YAML");
    return line.length - line.replace(/^ +/, "").length;
}
/** Parse the intentionally small l9.meta-authority/v1 YAML grammar. */
function parseAuthorityYaml(text) {
    const lines = text.replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map(stripInlineComment)
        .filter((line) => line.trim().length > 0);
    const result = Object.create(null);
    const seen = new Set();
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (assertIndent(line) !== 0) {
            fail("META_AUTHORITY_CONFIG_INVALID", `unexpected indentation at line ${index + 1}`);
        }
        const match = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (!match)
            fail("META_AUTHORITY_CONFIG_INVALID", `invalid mapping at line ${index + 1}`);
        const key = match[1];
        const rest = match[2];
        if (seen.has(key))
            fail("META_AUTHORITY_CONFIG_INVALID", `duplicate key '${key}'`);
        seen.add(key);
        if (key === "writer") {
            if (rest)
                fail("META_AUTHORITY_CONFIG_INVALID", "writer must be a nested mapping");
            index++;
            const writer = Object.create(null);
            while (index < lines.length && assertIndent(lines[index]) > 0) {
                const child = lines[index];
                if (assertIndent(child) !== 2) {
                    fail("META_AUTHORITY_CONFIG_INVALID", `writer entries must use two spaces at line ${index + 1}`);
                }
                const childMatch = child.trim().match(/^([A-Za-z_][\w-]*):\s*(.+)$/);
                if (!childMatch)
                    fail("META_AUTHORITY_CONFIG_INVALID", `invalid writer entry at line ${index + 1}`);
                const childKey = childMatch[1];
                if (childKey !== "repository" && childKey !== "ref") {
                    fail("META_AUTHORITY_CONFIG_INVALID", `unsupported writer key '${childKey}'`);
                }
                if (childKey in writer)
                    fail("META_AUTHORITY_CONFIG_INVALID", `duplicate writer key '${childKey}'`);
                writer[childKey] = scalar(childMatch[2]);
                index++;
            }
            result.writer = writer;
            continue;
        }
        if (key === "inline_allow" || key === "validation_commands") {
            if (rest) {
                result[key] = parseInlineList(rest);
                index++;
                continue;
            }
            index++;
            const values = [];
            while (index < lines.length && assertIndent(lines[index]) > 0) {
                const child = lines[index];
                if (assertIndent(child) !== 2 || !child.trim().startsWith("- ")) {
                    fail("META_AUTHORITY_CONFIG_INVALID", `${key} entries must be two-space list items at line ${index + 1}`);
                }
                values.push(scalar(child.trim().slice(2)));
                index++;
            }
            result[key] = values;
            continue;
        }
        if (!["schema", "default_carrier", "legacy_writers"].includes(key)) {
            fail("META_AUTHORITY_CONFIG_INVALID", `unsupported top-level key '${key}'`);
        }
        if (!rest)
            fail("META_AUTHORITY_CONFIG_INVALID", `missing value for '${key}'`);
        result[key] = scalar(rest);
        index++;
    }
    if (result.schema !== operation_contracts_1.META_AUTHORITY_SCHEMA) {
        fail("META_AUTHORITY_SCHEMA_UNSUPPORTED", `unsupported authority schema '${String(result.schema ?? "<missing>")}'`);
    }
    if (!(0, operation_contracts_1.isAuthorityConfig)(result)) {
        fail("META_AUTHORITY_CONFIG_INVALID", "authority document does not satisfy l9.meta-authority/v1");
    }
    return result;
}
function conflict(code, message, filePath, evidence) {
    return { code, message, path: filePath, evidence };
}
function loadRepositoryAuthority(root, options = {}) {
    const repositoryRoot = path.resolve(root);
    const authorityPath = path.resolve(repositoryRoot, options.authorityPath ?? exports.META_AUTHORITY_RELATIVE_PATH);
    const relative = path.relative(repositoryRoot, authorityPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return {
            path: authorityPath,
            conflicts: [conflict("META_AUTHORITY_CONFIG_INVALID", "authority path escapes repository root", authorityPath)],
        };
    }
    if (!fs.existsSync(authorityPath)) {
        return {
            path: authorityPath,
            conflicts: [conflict("META_AUTHORITY_FILE_MISSING", `missing ${exports.META_AUTHORITY_RELATIVE_PATH}`, authorityPath)],
        };
    }
    try {
        const stat = fs.lstatSync(authorityPath);
        if (stat.isSymbolicLink()) {
            return {
                path: authorityPath,
                conflicts: [conflict("META_AUTHORITY_CONFIG_INVALID", "authority file must not be a symbolic link", authorityPath)],
            };
        }
        if (!stat.isFile()) {
            return {
                path: authorityPath,
                conflicts: [conflict("META_AUTHORITY_CONFIG_INVALID", "authority path is not a regular file", authorityPath)],
            };
        }
        const authority = parseAuthorityYaml(fs.readFileSync(authorityPath, "utf8"));
        const expected = options.expectedWriter;
        const mismatches = [];
        if (expected?.repository && authority.writer.repository !== expected.repository) {
            mismatches.push(`repository expected ${expected.repository}, got ${authority.writer.repository}`);
        }
        if (expected?.ref && authority.writer.ref !== expected.ref) {
            mismatches.push(`ref expected ${expected.ref}, got ${authority.writer.ref}`);
        }
        if (mismatches.length) {
            return {
                path: authorityPath,
                authority,
                conflicts: [conflict("META_AUTHORITY_WRITER_MISMATCH", "configured metadata writer does not match policy", authorityPath, mismatches)],
            };
        }
        return { path: authorityPath, authority, conflicts: [] };
    }
    catch (error) {
        if (error instanceof AuthorityParseError) {
            return { path: authorityPath, conflicts: [conflict(error.code, error.message, authorityPath)] };
        }
        return {
            path: authorityPath,
            conflicts: [
                conflict("META_AUTHORITY_CONFIG_INVALID", `unable to read authority configuration: ${error instanceof Error ? error.message : String(error)}`, authorityPath),
            ],
        };
    }
}
//# sourceMappingURL=authority.js.map