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
exports.inlinePlanDrift = inlinePlanDrift;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const metadata_index_1 = require("./metadata_index");
const mutation_policy_1 = require("./mutation_policy");
const pipeline_1 = require("./pipeline");
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
function assertInlinePlan(root, record, decision) {
    const source = relativePath(root, record.sourcePath);
    if (source !== decision.path)
        throw new Error(`inline plan path mismatch: ${source} != ${decision.path}`);
    if (record.injectionStrategy !== "yaml-frontmatter") {
        throw new Error(`inline_managed requires yaml-frontmatter, got '${record.injectionStrategy ?? "unknown"}' for ${source}`);
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
            assertInlinePlan(root, record, decision);
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
    inlinePlans.sort((a, b) => relativePath(root, a.sourcePath).localeCompare(relativePath(root, b.sourcePath)));
    return inlinePlans;
}
function buildCarrierOperationPlan(mode, rootInput, authority, pipeline) {
    const root = path.resolve(rootInput);
    const subjects = [...pipeline.metadataSubjects].sort((a, b) => a.path.localeCompare(b.path));
    const carrierSubjects = subjects.map(({ path: subjectPath, artifactType, strategy }) => ({
        path: subjectPath,
        artifactType,
        strategy,
    }));
    const carrierDecisions = (0, mutation_policy_1.resolveCarrierDecisions)({ authority, mode, subjects: carrierSubjects });
    (0, mutation_policy_1.assertCarrierDecisionCoverage)(carrierSubjects, carrierDecisions);
    const byPath = decisionMap(carrierDecisions);
    const metadataIndex = (0, metadata_index_1.compileMetadataIndex)({ authority, mode, subjects });
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
        inlinePlans,
    };
}
async function planCarrierOperationAsync(input) {
    const root = path.resolve(input.config.root);
    const pipeline = await (0, pipeline_1.runPipelineAsync)({
        ...input.config,
        root,
        dryRun: true,
        localFiles: false,
        normalizeFilenames: false,
        writeInjectLog: false,
        persistOutputs: false,
    });
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
    const actualBytes = fs.readFileSync(target, "utf8");
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
//# sourceMappingURL=carrier_operation.js.map