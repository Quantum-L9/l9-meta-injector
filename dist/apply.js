"use strict";
/** Governed carrier-aware whole-run transactional apply operation. */
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
exports.runApplyAsync = runApplyAsync;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const authority_scan_1 = require("./authority_scan");
const carrier_operation_1 = require("./carrier_operation");
const metadata_index_1 = require("./metadata_index");
const file_transaction_1 = require("./file_transaction");
const inject_1 = require("./inject");
const discovery_contracts_1 = require("./discovery_contracts");
const verify_1 = require("./verify");
const ordering_1 = require("./ordering");
function sha256(bytes) {
    return (0, node_crypto_1.createHash)("sha256").update(bytes).digest("hex");
}
function relativePath(root, target) {
    const rel = path.relative(root, target);
    if (!rel || rel === "." || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        throw new Error(`apply target escapes or equals repository root: ${target}`);
    }
    return rel.split(path.sep).join("/");
}
function authorityFailure(conflicts, notices, warnings = []) {
    const apply = {
        passed: false,
        repositoryMutated: false,
        scanned: 0,
        planned: 0,
        changed: 0,
        inlineChanged: [],
        metadataIndexChanged: false,
        authorityConflicts: conflicts,
        authorityNotices: notices,
        carrierDecisions: [],
        discovery: (0, discovery_contracts_1.emptyDiscoverySummary)(),
        transaction: {
            transactionId: null,
            plannedWrites: 0,
            committedWrites: 0,
            rolledBack: false,
            recoveredTransactions: [],
            finalizedTransactions: [],
        },
    };
    return {
        mode: "apply",
        passed: false,
        authorityRequired: true,
        authorityResolved: false,
        repositoryMutated: false,
        warnings,
        apply,
    };
}
/**
 * Render the already-reconciled canonical metadata against a disposable copy.
 * The repository remains untouched; the result must match the shared planner's
 * expected hash before it can enter the transaction.
 */
function renderInlineBytes(root, planned, outDir) {
    if (!planned.targetPath || planned.targetPath !== planned.sourcePath) {
        throw new Error(`inline mutation target must equal source: ${planned.sourcePath}`);
    }
    if (!planned.expectedContentHash || planned.wouldChange === undefined || planned.targetExists === undefined) {
        throw new Error(`inline mutation plan is incomplete: ${planned.sourcePath}`);
    }
    const renderRoot = fs.mkdtempSync(path.join(os.tmpdir(), "l9-meta-render-"));
    const renderTarget = path.join(renderRoot, path.basename(planned.sourcePath));
    try {
        fs.copyFileSync(planned.sourcePath, renderTarget);
        const rendered = (0, inject_1.injectFile)(renderTarget, planned.meta, {
            dryRun: false,
            outDir,
            verbose: false,
            writeInjectLog: false,
            writeDryRunDiff: false,
        });
        if (rendered.injectionStrategy !== "yaml-frontmatter" || rendered.sidecarPath || rendered.injectLogPath) {
            throw new Error(`carrier policy violation while rendering ${planned.sourcePath}`);
        }
        const bytes = fs.readFileSync(renderTarget);
        const actualHash = sha256(bytes);
        if (actualHash !== planned.expectedContentHash) {
            throw new Error(`APPLY_RENDER_DIVERGENCE: ${relativePath(root, planned.sourcePath)} expected ${planned.expectedContentHash}, rendered ${actualHash}`);
        }
        return bytes;
    }
    finally {
        fs.rmSync(renderRoot, { recursive: true, force: true });
    }
}
function currentIntentState(target) {
    if (!fs.existsSync(target))
        return { expectedExists: false };
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error(`apply target must be a regular file: ${target}`);
    return { expectedExists: true, expectedHash: sha256(fs.readFileSync(target)) };
}
function buildMutationIntents(root, plan, outDir) {
    const intents = [];
    for (const planned of plan.inlinePlans) {
        if (!planned.wouldChange)
            continue;
        const target = planned.targetPath;
        if (!target)
            throw new Error(`inline plan lacks targetPath: ${planned.sourcePath}`);
        const bytes = renderInlineBytes(root, planned, outDir);
        intents.push({
            path: relativePath(root, target),
            expectedExists: planned.targetExists === true,
            expectedHash: planned.targetExists ? planned.actualContentHash : undefined,
            bytes,
        });
    }
    const indexTarget = path.join(root, ...metadata_index_1.METADATA_INDEX_RELATIVE_PATH.split("/"));
    const indexState = currentIntentState(indexTarget);
    const desiredIndexHash = sha256(plan.metadataIndex.bytes);
    if (indexState.expectedHash !== desiredIndexHash) {
        intents.push({
            path: metadata_index_1.METADATA_INDEX_RELATIVE_PATH,
            ...indexState,
            bytes: plan.metadataIndex.bytes,
            mode: 0o644,
        });
    }
    return intents.sort((left, right) => (0, ordering_1.compareCodePoints)(left.path, right.path));
}
function validateCommittedPlan(root, plan) {
    for (const planned of plan.inlinePlans) {
        if (!planned.wouldChange)
            continue;
        if (!planned.targetPath || !planned.expectedContentHash)
            throw new Error(`inline validation plan incomplete: ${planned.sourcePath}`);
        const actualHash = sha256(fs.readFileSync(planned.targetPath));
        if (actualHash !== planned.expectedContentHash) {
            throw new Error(`APPLY_POSTCONDITION_FAILED: ${relativePath(root, planned.sourcePath)} hash mismatch`);
        }
        const verified = (0, verify_1.verify)(planned.sourcePath, planned.originalBodyHash, planned.meta);
        if (verified.issues.length > 0) {
            throw new Error(`APPLY_VERIFICATION_FAILED: ${relativePath(root, planned.sourcePath)}: ${verified.issues.join("; ")}`);
        }
    }
    const indexTarget = path.join(root, ...metadata_index_1.METADATA_INDEX_RELATIVE_PATH.split("/"));
    if (!fs.existsSync(indexTarget) || fs.readFileSync(indexTarget, "utf8") !== plan.metadataIndex.bytes) {
        throw new Error("APPLY_POSTCONDITION_FAILED: canonical metadata index differs from planned bytes");
    }
}
async function runApplyAsync(config) {
    const root = path.resolve(config.root);
    // Recovery precedes authority inspection so journal or backup artifacts from an
    // interrupted commit cannot poison the authority scan and strand partial state.
    const recovery = (0, file_transaction_1.recoverPendingTransactions)(root);
    const warnings = [
        ...recovery.recovered.map((id) => `rolled back interrupted metadata transaction ${id}`),
        ...recovery.finalized.map((id) => `finalized validated metadata transaction ${id}`),
    ];
    const inspection = (0, authority_scan_1.inspectRepositoryAuthority)(root, {
        expectedWriter: { repository: carrier_operation_1.CANONICAL_METADATA_WRITER },
    });
    if (inspection.conflicts.length > 0 || !inspection.authority) {
        return authorityFailure(inspection.conflicts, inspection.notices, warnings);
    }
    if (config.localFiles)
        throw new Error("apply does not expand archives; local-files requires a separate import workflow");
    if (config.normalizeFilenames)
        throw new Error("apply does not normalize filenames; rename work must be reviewed separately");
    const plan = await (0, carrier_operation_1.planCarrierOperationAsync)({
        mode: "apply",
        authority: inspection.authority,
        config: {
            ...config,
            root,
            dryRun: true,
            localFiles: false,
            normalizeFilenames: false,
            writeInjectLog: false,
            persistOutputs: false,
        },
    });
    if (plan.pipeline.coverage.discovery.blocking > 0) {
        throw new Error(`DISCOVERY_INCOMPLETE: apply refused with ${plan.pipeline.coverage.discovery.blocking} blocking path(s)`);
    }
    const unsatisfied = (0, carrier_operation_1.unsatisfiedAuthorizationDrift)(plan);
    if (unsatisfied.length > 0) {
        // The repository authorized inline metadata for a file whose header cannot be
        // rewritten byte-safely. Preserving those bytes wins; apply holds and names the files.
        return authorityFailure(unsatisfied.map((item) => ({
            code: "META_AUTHORITY_CONFLICT",
            message: item.message,
            path: item.path,
        })), inspection.notices, warnings);
    }
    const intents = buildMutationIntents(root, plan, config.outDir);
    const transaction = (0, file_transaction_1.executeFileTransaction)(root, intents, {
        validate: () => validateCommittedPlan(root, plan),
    });
    const inlineChanged = transaction.changedPaths.filter((item) => item !== metadata_index_1.METADATA_INDEX_RELATIVE_PATH);
    const metadataIndexChanged = transaction.changedPaths.includes(metadata_index_1.METADATA_INDEX_RELATIVE_PATH);
    const repositoryMutated = transaction.changedPaths.length > 0;
    const apply = {
        passed: true,
        repositoryMutated,
        scanned: plan.pipeline.coverage.scanned,
        planned: plan.subjects.length,
        changed: transaction.changedPaths.length,
        inlineChanged,
        metadataIndexChanged,
        authorityConflicts: [],
        authorityNotices: inspection.notices,
        carrierDecisions: plan.carrierDecisions,
        discovery: plan.pipeline.coverage.discovery,
        transaction: {
            transactionId: transaction.transactionId,
            plannedWrites: transaction.plannedWrites,
            committedWrites: transaction.committedWrites,
            rolledBack: transaction.rolledBack,
            recoveredTransactions: recovery.recovered,
            finalizedTransactions: recovery.finalized,
        },
    };
    return {
        mode: "apply",
        passed: true,
        authorityRequired: true,
        authorityResolved: true,
        repositoryMutated,
        warnings,
        apply,
    };
}
//# sourceMappingURL=apply.js.map