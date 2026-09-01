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
exports.ArchiveExecutionContext = void 0;
exports.resolveArchiveExecution = resolveArchiveExecution;
// archive_execution.ts — one shared admission context for every archive path.
//
// Both archive paths in this package — the read-only observation path
// (`local_source.ts`) and the legacy mutating local-files materialization path
// (`archives.ts`) — used to resolve the archive policy and the session budget
// independently, and the materialization path preflighted every archive at depth
// 0 even when it was a nested member. Two independent resolutions is exactly the
// divergence this module exists to remove: every archive is judged against one
// policy, one budget, and the archive's real depth.
//
// `resolveArchiveExecution` is the single resolution point both paths share.
// `ArchiveExecutionContext` wraps it for the materialization path with the
// archive's own facts: the central directory is read once, preflighted once at
// the real depth, and the verdict is carried with the resolved policy and
// budget. The context never writes; materialization happens in `archives.ts`
// against the candidate the context describes.
const fs = __importStar(require("node:fs"));
const archive_preflight_1 = require("./archive_preflight");
const local_archive_policy_1 = require("./local_archive_policy");
const zip_reader_1 = require("./zip_reader");
/**
 * The single resolution point for archive policy and session budget.
 *
 * Both the observation path and the materialization path call this, so a caller
 * override, a default change, or a budget rule can never be applied by one path
 * and missed by the other.
 */
function resolveArchiveExecution(overrides, nowMs) {
    const policy = (0, local_archive_policy_1.resolveLocalArchivePolicy)(overrides);
    const now = nowMs ?? (() => Date.now());
    return { policy, budget: new local_archive_policy_1.ArchiveSessionBudget(policy, now(), now) };
}
/**
 * Admission facts for one archive about to be materialized.
 *
 * Reading the central directory and running preflight are both construction
 * concerns: a context that exists is a context whose archive has been read and
 * judged at the depth its caller actually occupies in the tree, never a
 * hard-coded 0.
 */
class ArchiveExecutionContext {
    constructor(input) {
        this.zipPath = input.zipPath;
        this.extractDir = input.extractDir;
        this.depth = input.depth;
        this.nowMs = input.nowMs ?? (() => Date.now());
        const resolution = resolveArchiveExecution(input.policy, this.nowMs);
        this.policy = resolution.policy;
        this.budget = resolution.budget;
        this.archiveCompressedBytes = fs.statSync(this.zipPath).size;
        this.centralDirectory = (0, zip_reader_1.readZipCentralDirectory)(this.zipPath);
        this.preflight = (0, archive_preflight_1.preflightArchive)({
            directory: this.centralDirectory,
            policy: this.policy,
            depth: this.depth,
            archiveCompressedBytes: this.archiveCompressedBytes,
        });
    }
    /** File members eligible for materialization, narrowed to `allowedMembers`. */
    planMembers(allowedMembers) {
        return allowedMembers
            ? this.preflight.members.filter((member) => allowedMembers.includes(member.canonicalPath))
            : this.preflight.members;
    }
    /** The single refusal sentence every path reports, or null when accepted. */
    holdReasons() {
        if (this.preflight.accepted)
            return null;
        return this.preflight.holds
            .map((hold) => (hold.memberPath ? `${hold.code} (${hold.memberPath})` : hold.code))
            .join(", ");
    }
}
exports.ArchiveExecutionContext = ArchiveExecutionContext;
//# sourceMappingURL=archive_execution.js.map