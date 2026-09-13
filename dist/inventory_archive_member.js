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
exports.boundedGunzip = boundedGunzip;
exports.boundedGunzipSync = boundedGunzipSync;
exports.inventoryRewriteKind = inventoryRewriteKind;
exports.peekArchiveRootMeta = peekArchiveRootMeta;
exports.upsertArchiveRootMeta = upsertArchiveRootMeta;
exports.isCanonicalMetaMemberName = isCanonicalMetaMemberName;
// inventory_archive_member.ts — one inventory orchestrator for ZIP/TAR member inject (ADR-049).
// Codecs do not call inventory. Observation expansion does not use this module.
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_stream_1 = require("node:stream");
const node_util_1 = require("node:util");
const zlib = __importStar(require("node:zlib"));
const archive_formats_1 = require("./archive_formats");
const archive_preflight_1 = require("./archive_preflight");
const durable_write_1 = require("./durable_write");
const local_archive_policy_1 = require("./local_archive_policy");
const tar_reader_1 = require("./tar_reader");
const tar_writer_1 = require("./tar_writer");
const zip_writer_1 = require("./zip_writer");
const zip_reader_1 = require("./zip_reader");
const pipelineAsync = (0, node_util_1.promisify)(node_stream_1.pipeline);
/**
 * Streaming gzip inflation with budget enforcement.
 *
 * Returns the inflated buffer if it fits within the policy's maxTotalUncompressedBytesPerArchive.
 * Aborts and returns a hold if the budget would be exceeded, preventing decompression bombs.
 */
async function boundedGunzip(compressed, policy = local_archive_policy_1.DEFAULT_LOCAL_ARCHIVE_POLICY) {
    const budget = policy.maxTotalUncompressedBytesPerArchive;
    const chunks = [];
    let totalBytes = 0;
    let budgetExceeded = false;
    const budgetEnforcer = new node_stream_1.Transform({
        transform(chunk, _encoding, callback) {
            if (budgetExceeded) {
                callback();
                return;
            }
            totalBytes += chunk.length;
            if (totalBytes > budget) {
                budgetExceeded = true;
                callback(new Error("archive.inflation_budget_exceeded"));
                return;
            }
            chunks.push(chunk);
            callback(null, chunk);
        },
    });
    const gunzip = zlib.createGunzip();
    try {
        await pipelineAsync((async function* () { yield compressed; })(), gunzip, budgetEnforcer);
        return { ok: true, bytes: Buffer.concat(chunks) };
    }
    catch (err) {
        const msg = err.message;
        if (msg === "archive.inflation_budget_exceeded" || budgetExceeded) {
            return { ok: false, hold: "archive.inflation_budget_exceeded" };
        }
        return { ok: false, hold: `archive.gzip_unreadable:${msg}` };
    }
}
/**
 * Synchronous wrapper for bounded gzip inflation.
 * Uses a post-inflation check since zlib.gunzipSync must complete before we know the size.
 */
function boundedGunzipSync(compressed, policy = local_archive_policy_1.DEFAULT_LOCAL_ARCHIVE_POLICY) {
    const budget = policy.maxTotalUncompressedBytesPerArchive;
    try {
        const inflated = zlib.gunzipSync(compressed);
        if (inflated.length > budget) {
            return { ok: false, hold: "archive.inflation_budget_exceeded" };
        }
        return { ok: true, bytes: inflated };
    }
    catch (err) {
        return { ok: false, hold: `archive.gzip_unreadable:${err.message}` };
    }
}
const HOLD_EXTENSIONS = new Set([".jar", ".war", ".gz"]);
function inventoryRewriteKind(fileName) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz"))
        return "tar.gz";
    const ext = (0, archive_formats_1.archiveExtensionOf)(fileName);
    if (ext === ".zip")
        return "zip";
    if (ext === ".tar")
        return "tar";
    if (HOLD_EXTENSIONS.has(ext))
        return null;
    return null;
}
function peekArchiveRootMeta(abs) {
    const kind = inventoryRewriteKind(path.basename(abs));
    if (kind === "zip")
        return (0, zip_writer_1.peekZipRootMeta)(abs);
    if (kind === "tar") {
        try {
            const peeked = (0, tar_reader_1.peekTarRootMeta)(fs.readFileSync(abs));
            return peeked ? peeked.toString("utf8") : null;
        }
        catch {
            return null;
        }
    }
    if (kind === "tar.gz") {
        try {
            const result = boundedGunzipSync(fs.readFileSync(abs));
            if (!result.ok)
                return null;
            const peeked = (0, tar_reader_1.peekTarRootMeta)(result.bytes);
            return peeked ? peeked.toString("utf8") : null;
        }
        catch {
            return null;
        }
    }
    return null;
}
function admitTarNames(names) {
    for (const name of names) {
        const holds = (0, archive_preflight_1.pathSafetyHolds)(name, local_archive_policy_1.DEFAULT_LOCAL_ARCHIVE_POLICY);
        if (holds.length)
            return holds[0].code;
        if ((0, tar_reader_1.rootMetaKind)(name) === null && (name.includes("/") && name.split("/").includes(".."))) {
            return "archive.path_traversal";
        }
    }
    const seen = new Set();
    for (const name of names) {
        const key = name.replace(/\\/g, "/").replace(/^\.\//, "").normalize("NFC").toLowerCase();
        if (seen.has(key))
            return "archive.duplicate_member";
        seen.add(key);
    }
    return null;
}
function admitZip(abs) {
    try {
        const directory = (0, zip_reader_1.readZipCentralDirectory)(abs);
        const verdict = (0, archive_preflight_1.preflightArchive)({
            directory,
            policy: local_archive_policy_1.DEFAULT_LOCAL_ARCHIVE_POLICY,
            depth: 0,
            archiveCompressedBytes: fs.statSync(abs).size,
        });
        if (!verdict.accepted)
            return verdict.holds[0]?.code ?? "archive.preflight_held";
        return null;
    }
    catch (err) {
        return `archive.format_unreadable:${err.message}`;
    }
}
function admitTarBytes(tar) {
    const read = (0, tar_reader_1.readTarArchive)(tar);
    if (!read.ok)
        return read.hold;
    return admitTarNames(read.members.map((m) => m.name));
}
function upsertArchiveRootMeta(abs, yaml) {
    const kind = inventoryRewriteKind(path.basename(abs));
    if (kind === null) {
        return { rewritten: false, hold: "archive.rewrite_not_admitted" };
    }
    if (kind === "zip") {
        const admit = admitZip(abs);
        if (admit)
            return { rewritten: false, hold: admit };
        const injected = (0, zip_writer_1.injectZipRootMeta)(abs, yaml);
        if (!injected.ok)
            return { rewritten: false, hold: injected.hold };
        (0, durable_write_1.replaceFileAtomically)(abs, injected.bytes);
        return { rewritten: true };
    }
    if (kind === "tar") {
        const bytes = fs.readFileSync(abs);
        const admit = admitTarBytes(bytes);
        if (admit)
            return { rewritten: false, hold: admit };
        const injected = (0, tar_writer_1.injectTarRootMeta)(bytes, yaml);
        if (!injected.ok)
            return { rewritten: false, hold: injected.hold };
        (0, durable_write_1.replaceFileAtomically)(abs, injected.bytes);
        return { rewritten: true };
    }
    const inflateResult = boundedGunzipSync(fs.readFileSync(abs));
    if (!inflateResult.ok) {
        return { rewritten: false, hold: inflateResult.hold };
    }
    const tar = inflateResult.bytes;
    const admit = admitTarBytes(tar);
    if (admit)
        return { rewritten: false, hold: admit };
    const injected = (0, tar_writer_1.injectGzipTarRootMeta)(fs.readFileSync(abs), yaml);
    if (!injected.ok)
        return { rewritten: false, hold: injected.hold };
    (0, durable_write_1.replaceFileAtomically)(abs, injected.bytes);
    return { rewritten: true };
}
function isCanonicalMetaMemberName(name) {
    return (0, zip_writer_1.rootMetaKind)(name) === "canonical" || (0, tar_reader_1.rootMetaKind)(name) === "canonical";
}
//# sourceMappingURL=inventory_archive_member.js.map