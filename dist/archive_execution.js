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
exports.ArchiveExecutionContext = exports.ArchiveExecutionHeldError = exports.ARCHIVE_READER_VERSION = void 0;
exports.resolveArchiveExecution = resolveArchiveExecution;
// archive_execution.ts — one shared admission context for every archive path.
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const archive_preflight_1 = require("./archive_preflight");
const local_archive_policy_1 = require("./local_archive_policy");
const zip_reader_1 = require("./zip_reader");
/**
 * Version of the canonical ZIP reader and preflight whose verdict this context carries.
 *
 * Bumped whenever an admission rule changes, because a warm archive-manifest
 * verdict is keyed on it: 1.1.0 added the file/directory path-conflict rule, and
 * an archive accepted under 1.0.0 may be held under 1.1.0.
 */
exports.ARCHIVE_READER_VERSION = "1.1.0";
const STAGE_CHUNK_BYTES = 64 * 1024;
/**
 * Expected refusal caused by archive/resource policy, not a host/tool failure.
 * The local-files orchestrator converts only this class (plus canonical ZIP
 * format/budget errors) into ArchiveRecord.heldReason; filesystem and invariant
 * failures continue to throw so they cannot masquerade as hostile input.
 */
class ArchiveExecutionHeldError extends Error {
    constructor(message) {
        super(message);
        this.name = "ArchiveExecutionHeldError";
    }
}
exports.ArchiveExecutionHeldError = ArchiveExecutionHeldError;
/** Single resolution point shared by observation and materialization paths. */
function resolveArchiveExecution(overrides, nowMs) {
    const policy = (0, local_archive_policy_1.resolveLocalArchivePolicy)(overrides);
    const now = nowMs ?? (() => Date.now());
    return { policy, budget: new local_archive_policy_1.ArchiveSessionBudget(policy, now(), now) };
}
/**
 * Admission facts for one archive.
 *
 * Construction stages and hashes the source in one streaming pass, then all ZIP
 * parsing, preflight and materialization read only the staged path. This closes
 * the live-path TOCTOU window: the verdict and the bytes written always describe
 * the same immutable snapshot.
 */
class ArchiveExecutionContext {
    constructor(input) {
        this.readerVersion = exports.ARCHIVE_READER_VERSION;
        this.disposed = false;
        if (input.resolution !== undefined && input.policy !== undefined) {
            throw new Error("archive execution accepts either a shared resolution or policy overrides, not both");
        }
        this.zipPath = input.zipPath;
        this.extractDir = input.extractDir;
        this.depth = input.depth;
        const resolution = input.resolution ?? resolveArchiveExecution(input.policy, input.nowMs);
        this.policy = resolution.policy;
        this.budget = resolution.budget;
        this.policyFingerprint = (0, local_archive_policy_1.localArchivePolicyFingerprint)(this.policy);
        const stagingParent = input.stagingParent ?? os.tmpdir();
        this.stagingRoot = fs.mkdtempSync(path.join(stagingParent, "l9-meta-injector-archive-"));
        this.stagedZipPath = path.join(this.stagingRoot, "snapshot.zip");
        const hash = crypto.createHash("sha256");
        let sizeBytes = 0;
        let source = null;
        let target = null;
        try {
            source = fs.openSync(this.zipPath, "r");
            target = fs.openSync(this.stagedZipPath, "wx");
            const buffer = Buffer.alloc(STAGE_CHUNK_BYTES);
            for (;;) {
                const deadline = this.budget.processingRefusalReason();
                if (deadline !== null)
                    throw new ArchiveExecutionHeldError(deadline);
                const count = fs.readSync(source, buffer, 0, buffer.length, null);
                if (count === 0)
                    break;
                if (sizeBytes + count > this.policy.maxArchiveCompressedBytes) {
                    throw new ArchiveExecutionHeldError(`archive exceeds the ${this.policy.maxArchiveCompressedBytes}-byte staging limit`);
                }
                const chunk = buffer.subarray(0, count);
                hash.update(chunk);
                let written = 0;
                while (written < chunk.length) {
                    written += fs.writeSync(target, chunk, written, chunk.length - written);
                }
                sizeBytes += count;
            }
        }
        catch (error) {
            if (source !== null)
                try {
                    fs.closeSync(source);
                }
                catch { }
            if (target !== null)
                try {
                    fs.closeSync(target);
                }
                catch { }
            fs.rmSync(this.stagingRoot, { recursive: true, force: true });
            throw error;
        }
        if (source !== null)
            fs.closeSync(source);
        if (target !== null)
            fs.closeSync(target);
        this.archiveCompressedBytes = sizeBytes;
        this.archiveSha256 = `sha256:${hash.digest("hex")}`;
        try {
            this.centralDirectory = (0, zip_reader_1.readZipCentralDirectory)(this.stagedZipPath);
            this.preflight = (0, archive_preflight_1.preflightArchive)({
                directory: this.centralDirectory,
                policy: this.policy,
                depth: this.depth,
                archiveCompressedBytes: this.archiveCompressedBytes,
            });
        }
        catch (error) {
            this.dispose();
            throw error;
        }
    }
    /** File members eligible for materialization, narrowed in O(n) time. */
    planMembers(allowedMembers) {
        if (allowedMembers === undefined)
            return this.preflight.members;
        const allowed = new Set(allowedMembers);
        return this.preflight.members.filter((member) => allowed.has(member.canonicalPath));
    }
    /** Run-scoped refusal after archive-local preflight has accepted. */
    sessionRefusalReason() {
        return this.budget.refuseReason(this.preflight.declaredUncompressedBytes);
    }
    /** Fail closed when wall-clock time expires during staging/member streaming. */
    assertProcessingWithinBudget() {
        const refusal = this.budget.processingRefusalReason();
        if (refusal !== null)
            throw new ArchiveExecutionHeldError(refusal);
    }
    /** Consume acquisition-wide accounting only after a verified archive succeeds. */
    recordSuccess(expandedBytes) {
        this.budget.recordArchive(expandedBytes);
    }
    /** The single archive-local refusal sentence every path reports, or null. */
    holdReasons() {
        if (this.preflight.accepted)
            return null;
        return this.preflight.holds
            .map((hold) => (hold.memberPath ? `${hold.code} (${hold.memberPath})` : hold.code))
            .join(", ");
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        fs.rmSync(this.stagingRoot, { recursive: true, force: true });
    }
}
exports.ArchiveExecutionContext = ArchiveExecutionContext;
//# sourceMappingURL=archive_execution.js.map