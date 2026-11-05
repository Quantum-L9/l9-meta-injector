"use strict";
/**
 * Shared carrier-aware planning for governed check/apply operations.
 *
 * This module is the single bridge from the canonical pipeline's metadata plan
 * to the carrier policy. It never writes source files, adjacent sidecars, logs,
 * reports, or indexes. Both check and apply consume the exact same plan.
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
exports.CANONICAL_METADATA_WRITER = void 0;
exports.buildCarrierOperationPlan = buildCarrierOperationPlan;
exports.planCarrierOperationAsync = planCarrierOperationAsync;
exports.metadataIndexDrift = metadataIndexDrift;
exports.unsatisfiedAuthorizationDrift = unsatisfiedAuthorizationDrift;
exports.inlinePlanDrift = inlinePlanDrift;
exports.runTrackedCoverage = runTrackedCoverage;
exports.planTrackedOperation = planTrackedOperation;
exports.runTrackedCheckAsync = runTrackedCheckAsync;
exports.runTrackedApplyAsync = runTrackedApplyAsync;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const metadata_index_1 = require("./metadata_index");
const mutation_policy_1 = require("./mutation_policy");
const pipeline_1 = require("./pipeline");
const ordering_1 = require("./ordering");
const git_tree_1 = require("./git_tree");
const discovery_contracts_1 = require("./discovery_contracts");
const authority_scan_1 = require("./authority_scan");
const file_transaction_1 = require("./file_transaction");
exports.CANONICAL_METADATA_WRITER = "Quantum-L9/l9-meta-injector";
function toPosix(value) {
    return value.split(path.sep).join("/");
}
function relativePath(root, target) {
    const rel = path.relative(root, target);
    if (!rel || rel === ".")
        return ".";
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        throw new Error(`carrier operation target escapes repository root: ${target}`);
    }
    return toPosix(rel);
}
function sha256Text(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value, "utf8").digest("hex");
}
function decisionMap(decisions) {
    const out = new Map();
    for (const item of decisions) {
        if (out.has(item.path))
            throw new Error(`duplicate carrier decision path: ${item.path}`);
        out.set(item.path, item);
    }
    return out;
}
function assertInlinePlan(root, record, decision, subject) {
    const source = relativePath(root, record.sourcePath);
    if (source !== decision.path)
        throw new Error(`inline plan path mismatch: ${source} != ${decision.path}`);
    if (record.injectionStrategy !== subject.strategy || !["yaml-frontmatter", "line-comment", "block-comment"].includes(subject.strategy)) {
        throw new Error(`inline_managed requires a matching safe strategy, got '${record.injectionStrategy ?? "unknown"}' for ${source}`);
    }
    if (!record.targetPath || relativePath(root, record.targetPath) !== source) {
        throw new Error(`inline_managed target must be the source file itself: ${source}`);
    }
    if (record.expectedContentHash === undefined || record.wouldChange === undefined || record.targetExists === undefined) {
        throw new Error(`inline_managed plan is incomplete for ${source}`);
    }
}
/** Fail if the metadata index and carrier operation disagree on decisions. */
function assertMetadataIndexParity(metadataIndex, carrierDecisions) {
    if (metadataIndex.carrierDecisions.length !== carrierDecisions.length) {
        throw new Error("metadata index and carrier operation decision counts diverged");
    }
    for (let index = 0; index < carrierDecisions.length; index++) {
        if (JSON.stringify(metadataIndex.carrierDecisions[index]) !== JSON.stringify(carrierDecisions[index])) {
            throw new Error(`metadata index and carrier operation decisions diverged at ${carrierDecisions[index].path}`);
        }
    }
}
/** Index canonical injection plans by their repository-relative source path. */
function indexInjectionPlansBySource(root, injected) {
    const planBySource = new Map();
    for (const record of injected) {
        const source = relativePath(root, record.sourcePath);
        if (planBySource.has(source))
            throw new Error(`duplicate pipeline injection plan for ${source}`);
        planBySource.set(source, record);
    }
    return planBySource;
}
/** Resolve the sorted inline-managed injection plans, validating each subject's decision. */
function collectInlinePlans(root, subjects, byPath, planBySource) {
    const inlinePlans = [];
    for (const subject of subjects) {
        const decision = byPath.get(subject.path);
        if (!decision)
            throw new Error(`missing carrier decision for ${subject.path}`);
        const record = planBySource.get(subject.path);
        if (decision.carrier === "inline_managed") {
            if (!record)
                throw new Error(`inline_managed subject lacks canonical injection plan: ${subject.path}`);
            assertInlinePlan(root, record, decision, subject);
            inlinePlans.push(record);
        }
        else if (record?.sidecarPath) {
            // The historical syntax planner may have proposed a sidecar. Carrier policy
            // owns the final destination, so that sidecar proposal is deliberately ignored.
            const sidecar = relativePath(root, record.sidecarPath);
            if (!sidecar.endsWith(".l9meta.yaml"))
                throw new Error(`unexpected legacy sidecar target: ${sidecar}`);
        }
    }
    inlinePlans.sort((a, b) => (0, ordering_1.compareCodePoints)(relativePath(root, a.sourcePath), relativePath(root, b.sourcePath)));
    return inlinePlans;
}
const SCOPE_FILTERED_DISPOSITIONS = new Set(["glob_filtered", "extension_filtered"]);
/** Paths the run's own discovery ledger recorded as outside the requested scope. */
function scopeFilteredPaths(pipeline) {
    return new Set(pipeline.coverage.discovery.entries
        .filter((entry) => entry.kind === "file" && SCOPE_FILTERED_DISPOSITIONS.has(entry.disposition))
        .map((entry) => entry.path));
}
const UNSCOPED_REBUILD_ADVICE = "a scoped run cannot preserve out-of-scope records; run an unscoped check/apply to rebuild the index";
/**
 * Read the existing index for a scoped run. Only the records of scope-filtered paths are
 * carried forward; every other path's record comes from the current subjects.
 */
function readScopedIndexBase(root, outOfScope) {
    const target = path.join(root, ...metadata_index_1.METADATA_INDEX_RELATIVE_PATH.split("/"));
    let stat;
    try {
        stat = fs.lstatSync(target);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return { base: { exists: false }, preserved: [] };
        const reason = error instanceof Error ? error.message : String(error);
        return { base: { exists: true, unmergeableReason: `existing ${metadata_index_1.METADATA_INDEX_RELATIVE_PATH} cannot be inspected (${reason}); ${UNSCOPED_REBUILD_ADVICE}` }, preserved: [] };
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
        return { base: { exists: true, unmergeableReason: `existing ${metadata_index_1.METADATA_INDEX_RELATIVE_PATH} is not a regular file; ${UNSCOPED_REBUILD_ADVICE}` }, preserved: [] };
    }
    const raw = fs.readFileSync(target);
    const sha256 = (0, node_crypto_1.createHash)("sha256").update(raw).digest("hex");
    try {
        const records = (0, metadata_index_1.parseMetadataIndex)(new TextDecoder("utf-8", { fatal: true }).decode(raw));
        return { base: { exists: true, sha256 }, preserved: records.filter((record) => outOfScope.has(record.path)) };
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { base: { exists: true, sha256, unmergeableReason: `existing ${metadata_index_1.METADATA_INDEX_RELATIVE_PATH} cannot be parsed (${reason}); ${UNSCOPED_REBUILD_ADVICE}` }, preserved: [] };
    }
}
function buildCarrierOperationPlan(mode, rootInput, authority, pipeline) {
    const root = path.resolve(rootInput);
    const subjects = [...pipeline.metadataSubjects].sort((a, b) => (0, ordering_1.compareCodePoints)(a.path, b.path));
    const carrierSubjects = subjects.map(({ path: subjectPath, artifactType, strategy, inlineCarrierBlock }) => ({
        path: subjectPath,
        artifactType,
        strategy,
        ...(inlineCarrierBlock ? { inlineCarrierBlock: { code: inlineCarrierBlock.code, malformed: inlineCarrierBlock.malformed } } : {}),
    }));
    const carrierDecisions = (0, mutation_policy_1.resolveCarrierDecisions)({ authority, mode, subjects: carrierSubjects });
    (0, mutation_policy_1.assertCarrierDecisionCoverage)(carrierSubjects, carrierDecisions);
    const byPath = decisionMap(carrierDecisions);
    // ADR-058: a scoped run (its ledger recorded scope-filtered files) merges with the
    // existing index; an unscoped run never reads it and compiles exactly as before.
    const outOfScope = scopeFilteredPaths(pipeline);
    const scopedBase = outOfScope.size > 0 ? readScopedIndexBase(root, outOfScope) : null;
    const metadataIndex = (0, metadata_index_1.compileMetadataIndex)({
        authority,
        mode,
        subjects,
        ...(scopedBase && scopedBase.preserved.length > 0 ? { preservedRecords: scopedBase.preserved } : {}),
    });
    assertMetadataIndexParity(metadataIndex, carrierDecisions);
    const planBySource = indexInjectionPlansBySource(root, pipeline.injected);
    const inlinePlans = collectInlinePlans(root, subjects, byPath, planBySource);
    return {
        mode,
        root,
        authority,
        pipeline,
        subjects,
        carrierDecisions,
        metadataIndex,
        metadataIndexBase: scopedBase ? scopedBase.base : null,
        inlinePlans,
    };
}
async function planCarrierOperationAsync(input) {
    const root = path.resolve(input.config.root);
    // The governed run is the sole metadata-index compiler, so it alone discovers with
    // the index-representability hold (DEC-RC-013 B).
    const pipeline = await (0, pipeline_1.runIndexGovernedPipelineAsync)({
        ...input.config,
        root,
        dryRun: true,
        localFiles: false,
        normalizeFilenames: false,
        writeInjectLog: false,
        persistOutputs: false,
    }, input.authority);
    return buildCarrierOperationPlan(input.mode, root, input.authority, pipeline);
}
function metadataIndexDrift(plan) {
    const target = path.join(plan.root, metadata_index_1.METADATA_INDEX_RELATIVE_PATH);
    if (!fs.existsSync(target)) {
        return {
            path: metadata_index_1.METADATA_INDEX_RELATIVE_PATH,
            kind: "missing",
            message: "canonical central metadata index is missing",
            expectedHash: plan.metadataIndex.sha256,
        };
    }
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        return {
            path: metadata_index_1.METADATA_INDEX_RELATIVE_PATH,
            kind: "conflict",
            message: "canonical central metadata index is not a regular file",
            expectedHash: plan.metadataIndex.sha256,
        };
    }
    if (plan.metadataIndexBase?.unmergeableReason) {
        return {
            path: metadata_index_1.METADATA_INDEX_RELATIVE_PATH,
            kind: "conflict",
            message: plan.metadataIndexBase.unmergeableReason,
            expectedHash: plan.metadataIndex.sha256,
            ...(plan.metadataIndexBase.sha256 ? { actualHash: plan.metadataIndexBase.sha256 } : {}),
        };
    }
    const actualBytes = fs.readFileSync(target, "utf8");
    try {
        (0, metadata_index_1.assertLegacyMetadataIndexWrite)(actualBytes);
    }
    catch (error) {
        return { path: metadata_index_1.METADATA_INDEX_RELATIVE_PATH, kind: "conflict", message: error instanceof Error ? error.message : String(error), expectedHash: plan.metadataIndex.sha256 };
    }
    const actualHash = sha256Text(actualBytes);
    if (actualBytes === plan.metadataIndex.bytes)
        return null;
    return {
        path: metadata_index_1.METADATA_INDEX_RELATIVE_PATH,
        kind: "stale",
        message: "canonical central metadata index differs from expected bytes",
        expectedHash: plan.metadataIndex.sha256,
        actualHash,
    };
}
/**
 * Drift for decisions the repository's own authority asked for but cannot receive.
 *
 * A malformed header under an explicit `inline_allow` authorization is reported here, not
 * repaired: preserving the file's bytes outranks satisfying the authorization.
 */
function unsatisfiedAuthorizationDrift(plan) {
    return plan.carrierDecisions
        .filter((decision) => decision.unsatisfiedInlineAuthorization === true)
        .map((decision) => ({
        path: decision.path,
        kind: "conflict",
        message: `inline metadata is explicitly authorized (${decision.authorityRule ?? "inline_allow"}) but the existing frontmatter cannot be patched safely: ${decision.reason}`,
    }));
}
function inlinePlanDrift(plan) {
    const drift = [];
    for (const record of plan.inlinePlans) {
        if (record.wouldChange === false)
            continue;
        const source = relativePath(plan.root, record.sourcePath);
        drift.push({
            path: source,
            kind: record.targetExists ? "stale" : "missing",
            message: record.targetExists
                ? "authorized inline metadata differs from canonical expected bytes"
                : "authorized inline metadata target is missing",
            expectedHash: record.expectedContentHash,
            actualHash: record.actualContentHash,
        });
    }
    return drift;
}
function assertTrackedOptIn(input, governed = false) {
    if (input.contract !== discovery_contracts_1.TRACKED_POLICY_SCHEMA)
        throw new Error("tracked workflow requires explicit l9.tracked-carrier-policy/v2 opt-in");
    const allowed = new Set(["root", "revision", "repositoryId", "contract", "producerVersion", "maxOutputBytes", "timeoutMs", ...(governed ? ["migrateV1", "expectedWriterRef"] : [])]);
    if (Object.keys(input).some((key) => !allowed.has(key)))
        throw new Error("unsupported tracked workflow input field");
    const options = input;
    if (options.migrateV1 !== undefined && typeof options.migrateV1 !== "boolean")
        throw new Error("migrateV1 must be explicit boolean consent");
    if (options.expectedWriterRef !== undefined && (typeof options.expectedWriterRef !== "string" || !options.expectedWriterRef.trim()))
        throw new Error("expectedWriterRef must be nonempty");
}
/** Immutable tree metadata only. No pipeline/authority scan, subject reads, or writes. */
function runTrackedCoverage(input) {
    assertTrackedOptIn(input);
    return (0, metadata_index_1.compileTrackedMetadataIndex)({ snapshot: (0, git_tree_1.readTrackedGitSnapshot)(input), producerVersion: input.producerVersion });
}
/** One plan is shared by versioned check/apply; no inline or adjacent-sidecar intents exist. */
function planTrackedOperation(input) {
    assertTrackedOptIn(input, true);
    const root = path.resolve(input.root);
    (0, git_tree_1.assertTrackedGitTopLevel)(root);
    const snapshot = (0, git_tree_1.readTrackedGitSnapshot)(input);
    let metadataIndexBase;
    try {
        metadataIndexBase = (0, metadata_index_1.readTrackedMetadataIndexBase)(root);
    }
    catch (error) {
        metadataIndexBase = { exists: true, unmergeableReason: error instanceof Error ? error.message : String(error) };
    }
    if (metadataIndexBase.index?.schema === metadata_index_1.METADATA_INDEX_SCHEMA_V2 && metadataIndexBase.index.header.repository_id !== input.repositoryId) {
        metadataIndexBase.unmergeableReason = "active v2 index repository identity differs from requested repository";
    }
    let legacyIdentityClaims;
    if (!metadataIndexBase.unmergeableReason) {
        try {
            if (metadataIndexBase.index?.schema === metadata_index_1.METADATA_INDEX_SCHEMA_V2) {
                legacyIdentityClaims = metadataIndexBase.index.header.legacy_identity_claims;
            }
            else if (metadataIndexBase.index?.schema === metadata_index_1.METADATA_INDEX_SCHEMA && input.migrateV1 === true) {
                if (!metadataIndexBase.sha256)
                    throw new Error("migration requires the actual active v1 index hash");
                legacyIdentityClaims = (0, metadata_index_1.compileMetadataIndexLegacyIdentityClaims)(metadataIndexBase.index, metadataIndexBase.sha256, snapshot);
            }
        }
        catch (error) {
            metadataIndexBase.unmergeableReason = error instanceof Error ? error.message : String(error);
        }
    }
    const metadataIndex = (0, metadata_index_1.compileTrackedMetadataIndex)({ snapshot, producerVersion: input.producerVersion, ...(legacyIdentityClaims ? { legacyIdentityClaims } : {}) });
    const authorityInspection = (0, authority_scan_1.inspectRepositoryAuthority)(root, { expectedWriter: { repository: exports.CANONICAL_METADATA_WRITER } });
    const migrationEvidence = legacyIdentityClaims && metadataIndexBase.index && metadataIndexBase.sha256
        ? (0, metadata_index_1.compileMetadataIndexMigrationEvidence)(metadataIndexBase.index, metadataIndexBase.sha256, metadataIndex, snapshot) : null;
    return { root, snapshot, metadataIndex, metadataIndexBase, authorityInspection, migrationEvidence };
}
function trackedPlanDrift(plan, migrateV1) {
    if (plan.metadataIndexBase.unmergeableReason)
        return [{ path: metadata_index_1.METADATA_INDEX_RELATIVE_PATH, kind: "conflict", message: plan.metadataIndexBase.unmergeableReason }];
    if (plan.metadataIndexBase.index?.schema === metadata_index_1.METADATA_INDEX_SCHEMA && !migrateV1) {
        return [{ path: metadata_index_1.METADATA_INDEX_RELATIVE_PATH, kind: "conflict", message: "active v1 index requires explicit migrateV1 before replacement" }];
    }
    const aliasProblem = plan.metadataIndexBase.index ? (0, metadata_index_1.metadataIndexMigrationAliasProblem)(plan.metadataIndexBase.index, plan.metadataIndex) : null;
    if (aliasProblem)
        return [{ path: metadata_index_1.METADATA_INDEX_RELATIVE_PATH, kind: "conflict", message: aliasProblem }];
    if (!plan.metadataIndexBase.exists)
        return [{ path: metadata_index_1.METADATA_INDEX_RELATIVE_PATH, kind: "missing", message: "canonical v2 metadata index is missing", expectedHash: plan.metadataIndex.sha256 }];
    if (plan.metadataIndexBase.bytes !== plan.metadataIndex.bytes)
        return [{ path: metadata_index_1.METADATA_INDEX_RELATIVE_PATH, kind: "stale", message: "canonical v2 metadata index differs from tracked plan", expectedHash: plan.metadataIndex.sha256, actualHash: plan.metadataIndexBase.sha256 }];
    return [];
}
/** Read-only/in-memory by default; authority inspection is explicit and not content-free. */
function runTrackedCheckAsync(input) {
    // The executor runs synchronously and turns thrown guards into rejected promises.
    return new Promise((resolve) => resolve(runTrackedCheck(input)));
}
function runTrackedCheck(input) {
    const plan = planTrackedOperation(input);
    (0, git_tree_1.assertTrackedWorktreeCurrent)(plan.snapshot, plan.root);
    const drift = trackedPlanDrift(plan, input.migrateV1 === true);
    return {
        mode: "tracked-check", passed: drift.length === 0 && plan.authorityInspection.conflicts.length === 0 && !!plan.authorityInspection.authority,
        repositoryMutated: false, sourceMutated: false, authorityInspection: "performed",
        authorityConflicts: plan.authorityInspection.conflicts, authorityNotices: plan.authorityInspection.notices,
        drift, metadataIndex: plan.metadataIndex,
        migrationEvidence: plan.migrationEvidence,
    };
}
function assertTrackedAuthority(plan, expectedWriterRef) {
    const inspection = (0, authority_scan_1.inspectRepositoryAuthority)(plan.root, {
        expectedWriter: { repository: exports.CANONICAL_METADATA_WRITER, ...(expectedWriterRef ? { ref: expectedWriterRef } : {}) },
    });
    if (!inspection.authority || inspection.conflicts.length !== 0) {
        throw new Error(`TRACKED_AUTHORITY_REQUIRED: ${inspection.conflicts.map((item) => item.code).join(", ")}`);
    }
    if (JSON.stringify(inspection.authority) !== JSON.stringify(plan.authorityInspection.authority))
        throw new Error("TRACKED_AUTHORITY_CHANGED: authority changed after planning");
}
function assertTrackedBaseCurrent(plan) {
    const current = (0, metadata_index_1.readTrackedMetadataIndexBase)(plan.root);
    if (current.exists !== plan.metadataIndexBase.exists || current.sha256 !== plan.metadataIndexBase.sha256)
        throw new Error("TRACKED_INDEX_CAS_FAILED: active index changed after planning");
}
function assertNoPendingTrackedTransactions(root) {
    const directory = path.join(root, ...file_transaction_1.TRANSACTION_DIRECTORY.split("/"));
    try {
        const stat = fs.lstatSync(directory);
        if (stat.isSymbolicLink() || !stat.isDirectory() || fs.readdirSync(directory).length !== 0) {
            throw new Error("pending/unsafe transaction state requires existing recovery workflow before tracked apply");
        }
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
}
/** Only the active canonical index may be committed; all census sources remain read-only. */
function runTrackedApplyAsync(input) {
    // Do not defer planning/commit guards; preserve the async API's rejection semantics.
    return new Promise((resolve) => resolve(runTrackedApply(input)));
}
function runTrackedApply(input) {
    const plan = planTrackedOperation(input);
    if (plan.metadataIndexBase.unmergeableReason)
        throw new Error(`TRACKED_INDEX_UNMERGEABLE: ${plan.metadataIndexBase.unmergeableReason}`);
    assertTrackedAuthority(plan, input.expectedWriterRef);
    if (plan.metadataIndexBase.index?.schema === metadata_index_1.METADATA_INDEX_SCHEMA && input.migrateV1 !== true)
        throw new Error("active v1 index requires explicit migrateV1 before replacement");
    const aliasProblem = plan.metadataIndexBase.index ? (0, metadata_index_1.metadataIndexMigrationAliasProblem)(plan.metadataIndexBase.index, plan.metadataIndex) : null;
    if (aliasProblem)
        throw new Error(aliasProblem);
    (0, git_tree_1.assertTrackedWorktreeCurrent)(plan.snapshot, plan.root);
    assertNoPendingTrackedTransactions(plan.root);
    assertTrackedBaseCurrent(plan);
    const changed = plan.metadataIndexBase.bytes !== plan.metadataIndex.bytes;
    const intents = changed ? [{
            path: metadata_index_1.METADATA_INDEX_RELATIVE_PATH,
            expectedExists: plan.metadataIndexBase.exists,
            ...(plan.metadataIndexBase.exists ? { expectedHash: plan.metadataIndexBase.sha256 } : {}),
            bytes: plan.metadataIndex.bytes,
            mode: 0o644,
        }] : [];
    const transaction = (0, file_transaction_1.executeFileTransaction)(plan.root, intents, {
        // Synchronous source and authority guards run immediately before committing and
        // while backups remain available. Postcondition failure rolls the index back.
        faultInjector: ({ stage }) => {
            if (stage === "before_commit") {
                (0, git_tree_1.assertTrackedWorktreeCurrent)(plan.snapshot, plan.root);
                assertTrackedAuthority(plan, input.expectedWriterRef);
                assertTrackedBaseCurrent(plan);
            }
        },
        validate: () => {
            (0, git_tree_1.assertTrackedWorktreeCurrent)(plan.snapshot, plan.root);
            assertTrackedAuthority(plan, input.expectedWriterRef);
            if ((0, metadata_index_1.readTrackedMetadataIndexBase)(plan.root).bytes !== plan.metadataIndex.bytes)
                throw new Error("TRACKED_INDEX_POSTCONDITION_FAILED");
        },
    });
    return {
        mode: "tracked-apply", passed: true, repositoryMutated: transaction.changedPaths.length !== 0, sourceMutated: false,
        authorityInspection: "performed", authorityConflicts: [], authorityNotices: plan.authorityInspection.notices,
        metadataIndex: plan.metadataIndex, transaction,
        migrationEvidence: plan.migrationEvidence,
    };
}
//# sourceMappingURL=carrier_operation.js.map