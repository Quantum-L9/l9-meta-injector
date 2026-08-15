"use strict";
/** Read-only carrier-aware expected-versus-actual drift evaluation. */
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
exports.runCheckAsync = runCheckAsync;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const archives_1 = require("./archives");
const discovery_contracts_1 = require("./discovery_contracts");
const authority_scan_1 = require("./authority_scan");
const carrier_operation_1 = require("./carrier_operation");
var carrier_operation_2 = require("./carrier_operation");
Object.defineProperty(exports, "CANONICAL_METADATA_WRITER", { enumerable: true, get: function () { return carrier_operation_2.CANONICAL_METADATA_WRITER; } });
function toPosix(value) {
    return value.split(path.sep).join("/");
}
function hashBytes(value) {
    return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
function snapshotRepository(root) {
    const repositoryRoot = path.resolve(root);
    const snapshot = new Map();
    const walk = (directory) => {
        const entries = fs.readdirSync(directory, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name === ".git" || entry.name === "node_modules")
                continue;
            const absolute = path.join(directory, entry.name);
            const relative = toPosix(path.relative(repositoryRoot, absolute));
            const stat = fs.lstatSync(absolute);
            if (stat.isSymbolicLink())
                snapshot.set(relative, { kind: "symlink", mode: stat.mode, target: fs.readlinkSync(absolute) });
            else if (stat.isDirectory()) {
                snapshot.set(relative, { kind: "directory", mode: stat.mode });
                walk(absolute);
            }
            else if (stat.isFile())
                snapshot.set(relative, { kind: "file", mode: stat.mode, size: stat.size, hash: hashBytes(fs.readFileSync(absolute)) });
            else
                snapshot.set(relative, { kind: "other", mode: stat.mode, size: stat.size });
        }
    };
    walk(repositoryRoot);
    return snapshot;
}
function snapshotDifferences(before, after) {
    return [...new Set([...before.keys(), ...after.keys()])]
        .sort((a, b) => a.localeCompare(b))
        .filter((item) => JSON.stringify(before.get(item)) !== JSON.stringify(after.get(item)));
}
function inspectArchivesWithoutExtraction(root) {
    return (0, archives_1.findArchives)(root).archives.map((archivePath) => ({
        path: toPosix(path.relative(root, archivePath)),
        kind: "unsupported",
        message: `archive inspected read-only (${(0, archives_1.listZipMembers)(archivePath).length} member(s)); governed check never extracts archives`,
    }));
}
function authorityFailureResult(conflicts, archiveDrift) {
    const check = {
        passed: false,
        repositoryMutated: false,
        scanned: 0,
        planned: 0,
        drift: [
            ...archiveDrift,
            ...conflicts.map((item) => ({ path: item.path ?? ".", kind: "conflict", message: item.message })),
        ],
        authorityConflicts: conflicts,
        carrierDecisions: [],
        discovery: (0, discovery_contracts_1.emptyDiscoverySummary)(),
    };
    return { mode: "check", passed: false, authorityRequired: true, authorityResolved: false, repositoryMutated: false, warnings: [], check };
}
async function runCheckAsync(config) {
    const root = path.resolve(config.root);
    const before = snapshotRepository(root);
    try {
        const inspection = (0, authority_scan_1.inspectRepositoryAuthority)(root, { expectedWriter: { repository: carrier_operation_1.CANONICAL_METADATA_WRITER } });
        const archiveDrift = config.localFiles ? inspectArchivesWithoutExtraction(root) : [];
        if (inspection.conflicts.length > 0 || !inspection.authority) {
            return authorityFailureResult(inspection.conflicts, archiveDrift);
        }
        const warnings = [];
        const deterministicDrift = [...archiveDrift];
        if (config.llmEnabled) {
            warnings.push("LLM assistance is disabled in check mode because expected state must be deterministic");
            deterministicDrift.push({ path: ".", kind: "unsupported", message: "check cannot prove expected state while LLM assistance is requested" });
        }
        const plan = await (0, carrier_operation_1.planCarrierOperationAsync)({
            mode: "check",
            authority: inspection.authority,
            config: {
                ...config,
                root,
                dryRun: true,
                llmEnabled: false,
                localFiles: false,
                normalizeFilenames: false,
                writeInjectLog: false,
                persistOutputs: false,
            },
        });
        const discoveryDrift = plan.pipeline.coverage.discovery.entries
            .filter((entry) => discovery_contracts_1.BLOCKING_DISCOVERY_DISPOSITIONS.has(entry.disposition))
            .map((entry) => ({ path: entry.path, kind: "unsupported", message: `discovery ${entry.disposition}: ${entry.reason}` }));
        const indexDrift = (0, carrier_operation_1.metadataIndexDrift)(plan);
        const drift = [
            ...deterministicDrift,
            ...discoveryDrift,
            ...(0, carrier_operation_1.inlinePlanDrift)(plan),
            ...(indexDrift ? [indexDrift] : []),
        ].sort((a, b) => `${a.path}:${a.kind}`.localeCompare(`${b.path}:${b.kind}`));
        const check = {
            passed: drift.length === 0,
            repositoryMutated: false,
            scanned: plan.pipeline.coverage.scanned,
            planned: plan.subjects.length,
            drift,
            authorityConflicts: [],
            carrierDecisions: plan.carrierDecisions,
            discovery: plan.pipeline.coverage.discovery,
        };
        return {
            mode: "check",
            passed: check.passed,
            authorityRequired: true,
            authorityResolved: true,
            repositoryMutated: false,
            warnings,
            check,
        };
    }
    finally {
        const changed = snapshotDifferences(before, snapshotRepository(root));
        if (changed.length > 0) {
            throw new Error(`CHECK_MUTATION_DETECTED: read-only check changed ${changed.length} repository path(s): ${changed.slice(0, 20).join(", ")}`);
        }
    }
}
//# sourceMappingURL=check.js.map