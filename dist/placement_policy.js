"use strict";
// placement_policy.ts — metadata placement compiler.
//
// Pure and advisory: given an artifact's source path (and optional body), it
// classifies the artifact and compiles a PlacementPlan describing *where* the
// artifact should live. It computes plans only — it performs NO file-system
// writes and mutates nothing. Downstream executors may act on a plan; this
// module never does.
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
exports.compilePlacementPlan = compilePlacementPlan;
exports.compilePlacementPlans = compilePlacementPlans;
const path = __importStar(require("path"));
const artifact_class_1 = require("./artifact_class");
const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };
const DEFAULT_NAMESPACE = "l9";
/** POSIX-join and strip any leading "./" so target paths are stable. */
function joinPosix(...parts) {
    const joined = path.posix.join(...parts.filter((p) => p && p !== "."));
    return joined.replace(/^\.\//, "");
}
/**
 * Compile a single {@link PlacementPlan}. Pure: depends only on its arguments,
 * writes nothing, never throws on well-formed input.
 */
function compilePlacementPlan(sourcePath, body = "", opts = {}) {
    const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
    const threshold = opts.quarantineAtOrBelow ?? "low";
    const rootDir = opts.rootDir ?? "";
    const { artifactClass, confidence, signals } = (0, artifact_class_1.classifyArtifact)(sourcePath, body);
    const hint = (0, artifact_class_1.placementHintFor)(artifactClass);
    const quarantined = artifactClass === "unknown" || CONFIDENCE_RANK[confidence] <= CONFIDENCE_RANK[threshold];
    const baseDir = quarantined ? artifact_class_1.QUARANTINE_DIRECTORY : hint.directory;
    const targetDirectory = joinPosix(rootDir, baseDir);
    const fileName = path.posix.basename(sourcePath.replace(/\\/g, "/"));
    const targetPath = joinPosix(targetDirectory, fileName);
    const rationale = [
        `classified as "${artifactClass}" (confidence: ${confidence})`,
        signals.length ? `signals: ${signals.join(", ")}` : "no distinctive signals",
        quarantined
            ? `routed to quarantine "${artifact_class_1.QUARANTINE_DIRECTORY}" (at/below threshold "${threshold}")`
            : `mapped to "${hint.directory}" on the "${hint.layer}" layer`,
    ];
    return {
        sourcePath,
        artifactClass,
        confidence,
        layer: quarantined ? "quarantine" : hint.layer,
        namespace,
        targetDirectory,
        targetPath,
        quarantined,
        writesRequired: false,
        rationale,
    };
}
/**
 * Compile plans for a batch of artifacts. Order-preserving and pure; a
 * convenience wrapper over {@link compilePlacementPlan}.
 */
function compilePlacementPlans(inputs, opts = {}) {
    return inputs.map((i) => compilePlacementPlan(i.sourcePath, i.body ?? "", opts));
}
//# sourceMappingURL=placement_policy.js.map