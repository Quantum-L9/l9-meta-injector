"use strict";
/**
 * Deterministic central metadata index.
 *
 * The index is newline-delimited canonical JSON at `.l9/metadata-index.jsonl`.
 * It is the sole default metadata carrier for source, configuration, test,
 * automation, infrastructure, structured data, and inventory-only artifacts.
 * This module never creates adjacent sidecars or inject logs.
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
exports.METADATA_INDEX_RELATIVE_PATH = exports.METADATA_INDEX_SCHEMA = void 0;
exports.serializeMetadataIndex = serializeMetadataIndex;
exports.compileMetadataIndex = compileMetadataIndex;
exports.writeMetadataIndex = writeMetadataIndex;
exports.parseMetadataIndex = parseMetadataIndex;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const mutation_policy_1 = require("./mutation_policy");
exports.METADATA_INDEX_SCHEMA = "l9.metadata-index/v1";
exports.METADATA_INDEX_RELATIVE_PATH = ".l9/metadata-index.jsonl";
const MATERIALIZED_CARRIERS = new Set([
    "inventory_only", "central_manifest", "inline_managed",
]);
const ARTIFACT_TYPES = new Set([
    "skill", "playbook", "kernel", "context", "prompt", "doctrine",
    "test", "script", "source", "unknown",
]);
const FORBIDDEN_VOLATILE_KEYS = new Set([
    "absolute_path",
    "generated_at",
    "report_path",
    "run_started_at",
    "runtime_timestamp",
]);
function normalizeRelativePath(value) {
    if (value.includes("\u0000"))
        throw new Error("metadata index path contains NUL");
    if (value.includes("\\"))
        throw new Error(`metadata index path must use POSIX separators: ${value}`);
    if (value.startsWith("/") || value.startsWith("./")) {
        throw new Error(`metadata index path must be canonical repository-relative POSIX: ${value}`);
    }
    if (value.includes("//"))
        throw new Error(`metadata index path contains an empty segment: ${value}`);
    const segments = value.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error(`metadata index path contains a non-canonical segment: ${value}`);
    }
    return segments.join("/");
}
function isPlainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
function canonicalize(value, location, seen) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error(`${location} contains a non-finite number`);
        return Object.is(value, -0) ? 0 : value;
    }
    if (Array.isArray(value)) {
        if (seen.has(value))
            throw new Error(`${location} contains a cycle`);
        seen.add(value);
        const output = value.map((item, index) => canonicalize(item, `${location}[${index}]`, seen));
        seen.delete(value);
        return output;
    }
    if (!isPlainObject(value)) {
        throw new Error(`${location} contains an unsupported value of type ${typeof value}`);
    }
    if (seen.has(value))
        throw new Error(`${location} contains a cycle`);
    seen.add(value);
    const output = Object.create(null);
    // Explicit code-unit ordering: keeps the canonical JSON bytes identical to the
    // prior default sort while satisfying the "sort needs a comparator" rule.
    for (const key of Object.keys(value).sort(byCodeUnit)) {
        if (FORBIDDEN_VOLATILE_KEYS.has(key)) {
            throw new Error(`${location}.${key} is runtime- or machine-specific and cannot be persisted`);
        }
        const item = value[key];
        if (item === undefined || typeof item === "bigint" || typeof item === "function" || typeof item === "symbol") {
            throw new Error(`${location}.${key} contains a non-JSON value`);
        }
        output[key] = canonicalize(item, `${location}.${key}`, seen);
    }
    seen.delete(value);
    return output;
}
function canonicalJson(value) {
    return JSON.stringify(canonicalize(value, "$", new Set()));
}
function assertContentHash(value, pathName) {
    if (!/^[a-f0-9]{64}$/.test(value)) {
        throw new Error(`metadata index content hash for ${pathName} must be lowercase SHA-256`);
    }
}
function toRecord(subject, decision) {
    const pathName = normalizeRelativePath(subject.path);
    if (decision.path !== pathName) {
        throw new Error(`carrier decision path mismatch for ${pathName}: ${decision.path}`);
    }
    if (decision.carrier === "hard_skip")
        return undefined;
    assertContentHash(subject.contentHash, pathName);
    const metadata = canonicalize(subject.metadata, `metadata:${pathName}`, new Set());
    if (!isPlainObject(metadata))
        throw new Error(`metadata for ${pathName} must be a plain object`);
    if (metadata.source_path !== undefined && metadata.source_path !== pathName) {
        throw new Error(`metadata source_path mismatch for ${pathName}`);
    }
    if (metadata.content_hash !== undefined && metadata.content_hash !== subject.contentHash) {
        throw new Error(`metadata content_hash mismatch for ${pathName}`);
    }
    return {
        schema: exports.METADATA_INDEX_SCHEMA,
        path: pathName,
        carrier: decision.carrier,
        artifact_type: subject.artifactType,
        content_hash: subject.contentHash,
        metadata,
    };
}
/** Deterministic code-unit string comparison (stable canonical ordering). */
function byCodeUnit(a, b) {
    if (a < b)
        return -1;
    if (a > b)
        return 1;
    return 0;
}
function comparePath(left, right) {
    return byCodeUnit(left.path, right.path);
}
function serializeMetadataIndex(records) {
    const seen = new Set();
    const sorted = [...records].sort(comparePath);
    for (const record of sorted) {
        const pathName = normalizeRelativePath(record.path);
        if (seen.has(pathName))
            throw new Error(`duplicate metadata index path: ${pathName}`);
        seen.add(pathName);
        if (record.schema !== exports.METADATA_INDEX_SCHEMA)
            throw new Error(`unsupported metadata index schema for ${pathName}`);
        if (!MATERIALIZED_CARRIERS.has(record.carrier)) {
            throw new Error(`unsupported materialized carrier '${String(record.carrier)}' for ${pathName}`);
        }
        if (!ARTIFACT_TYPES.has(record.artifact_type)) {
            throw new Error(`unsupported artifact type '${String(record.artifact_type)}' for ${pathName}`);
        }
        assertContentHash(record.content_hash, pathName);
        if (!isPlainObject(record.metadata))
            throw new Error(`metadata for ${pathName} must be a plain object`);
        if (record.metadata.source_path !== undefined && record.metadata.source_path !== pathName) {
            throw new Error(`metadata source_path mismatch for ${pathName}`);
        }
        if (record.metadata.content_hash !== undefined && record.metadata.content_hash !== record.content_hash) {
            throw new Error(`metadata content_hash mismatch for ${pathName}`);
        }
    }
    return sorted.length === 0 ? "" : `${sorted.map((record) => canonicalJson(record)).join("\n")}\n`;
}
function compileMetadataIndex(input) {
    const carrierDecisions = (0, mutation_policy_1.resolveCarrierDecisions)({
        authority: input.authority,
        mode: input.mode,
        subjects: input.subjects,
    });
    (0, mutation_policy_1.assertCarrierDecisionCoverage)(input.subjects, carrierDecisions);
    const subjectByPath = new Map(input.subjects.map((subject) => [normalizeRelativePath(subject.path), subject]));
    const records = [];
    for (const decision of carrierDecisions) {
        const subject = subjectByPath.get(decision.path);
        if (!subject)
            throw new Error(`carrier decision has no metadata subject: ${decision.path}`);
        const record = toRecord(subject, decision);
        if (record)
            records.push(record);
    }
    const bytes = serializeMetadataIndex(records);
    return {
        records: [...records].sort(comparePath),
        bytes,
        sha256: (0, node_crypto_1.createHash)("sha256").update(bytes).digest("hex"),
        carrierDecisions,
    };
}
function assertSafeOutput(root) {
    const absoluteRoot = path.resolve(root);
    const rootStat = fs.lstatSync(absoluteRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        throw new Error(`metadata index root must be a real directory: ${absoluteRoot}`);
    }
    const directory = path.join(absoluteRoot, ".l9");
    const target = path.join(absoluteRoot, exports.METADATA_INDEX_RELATIVE_PATH);
    const relative = path.relative(absoluteRoot, target);
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
        throw new Error(`metadata index target escapes repository root: ${target}`);
    }
    if (fs.existsSync(directory)) {
        const stat = fs.lstatSync(directory);
        if (stat.isSymbolicLink() || !stat.isDirectory())
            throw new Error(`.l9 must be a real directory: ${directory}`);
    }
    if (fs.existsSync(target)) {
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || !stat.isFile())
            throw new Error(`metadata index target must be a regular file: ${target}`);
    }
    return { root: absoluteRoot, directory, target };
}
function writeMetadataIndex(root, input, options = {}) {
    const output = assertSafeOutput(root);
    const compiled = compileMetadataIndex(input);
    const current = fs.existsSync(output.target) ? fs.readFileSync(output.target, "utf8") : undefined;
    const changed = current !== compiled.bytes;
    if (!options.dryRun && changed) {
        fs.mkdirSync(output.directory, { recursive: true });
        const temp = path.join(output.directory, `.metadata-index.jsonl.tmp-${process.pid}`);
        if (fs.existsSync(temp))
            throw new Error(`metadata index temporary path already exists: ${temp}`);
        try {
            fs.writeFileSync(temp, compiled.bytes, { encoding: "utf8", flag: "wx", mode: 0o644 });
            fs.renameSync(temp, output.target);
        }
        finally {
            if (fs.existsSync(temp))
                fs.rmSync(temp, { force: true });
        }
    }
    return {
        ...compiled,
        absolutePath: output.target,
        relativePath: exports.METADATA_INDEX_RELATIVE_PATH,
        changed,
        written: !options.dryRun && changed,
    };
}
function parseMetadataIndex(bytes) {
    if (bytes === "")
        return [];
    if (!bytes.endsWith("\n"))
        throw new Error("metadata index must end with a newline");
    const records = bytes.slice(0, -1).split("\n").map((line, index) => {
        let value;
        try {
            value = JSON.parse(line);
        }
        catch (error) {
            throw new Error(`metadata index line ${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!isPlainObject(value))
            throw new Error(`metadata index line ${index + 1} must be an object`);
        const record = value;
        if (canonicalJson(record) !== line)
            throw new Error(`metadata index line ${index + 1} is not canonical JSON`);
        return record;
    });
    const canonical = serializeMetadataIndex(records);
    if (canonical !== bytes)
        throw new Error("metadata index records are not in canonical path order");
    return records;
}
//# sourceMappingURL=metadata_index.js.map