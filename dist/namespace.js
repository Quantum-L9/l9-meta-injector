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
exports.toSnakeStem = toSnakeStem;
exports.resolveNamespace = resolveNamespace;
// namespace.ts — Deterministic path → namespace + sharing_scope + primitive_folder
const path = __importStar(require("path"));
const SHARED_SIGNALS = ["_shared", "shared", "core", "common", "universal"];
const PRIVATE_SIGNALS = ["l9", "plastos", "legal", "ops", "private"];
function matchGlob(filePath, glob) {
    const norm = filePath.replace(/\\/g, "/");
    const pat = glob.replace(/\./g, "\\.").replace(/\*\*/g, "DSTAR").replace(/\*/g, "[^/]*").replace(/DSTAR/g, ".*");
    return new RegExp(`(^|/)${pat}($|/)`).test(norm);
}
function deriveSharingScope(filePath) {
    const parts = filePath.replace(/\\/g, "/").toLowerCase().split("/");
    if (SHARED_SIGNALS.some((s) => parts.includes(s)))
        return "shared";
    if (PRIVATE_SIGNALS.some((s) => parts.includes(s)))
        return "private";
    return "agnostic";
}
function derivePrimitiveFolder(filePath) {
    const base = path.basename(filePath).toLowerCase();
    const dot = base.match(/\.(skill|playbook|kernel|context|prompt|doctrine|test|script)\./);
    if (dot)
        return dot[1];
    const norm = filePath.replace(/\\/g, "/").toLowerCase();
    const segMap = {
        skills: "skill", playbooks: "playbook", kernels: "kernel", contexts: "context",
        prompts: "prompt", doctrines: "doctrine", tests: "test", scripts: "script",
    };
    for (const [seg, prim] of Object.entries(segMap)) {
        if (norm.includes(`/${seg}/`))
            return prim;
    }
    if (/^prompt-/i.test(path.basename(filePath)))
        return "prompt";
    return "unknown";
}
function toSnakeStem(filename) {
    const stem = path.basename(filename, path.extname(filename))
        .replace(/^Prompt-/i, "")
        .replace(/\.[a-z]+$/i, "");
    return stem.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[-\s]+/g, "_")
        .replace(/[^a-z0-9_]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}
function resolveNamespace(filePath, cfg, typeHint) {
    const norm = filePath.replace(/\\/g, "/");
    let namespace = cfg.namespace ?? "l9";
    if (cfg.namespaceGlobs) {
        for (const e of cfg.namespaceGlobs) {
            if (matchGlob(norm, e.glob)) {
                namespace = e.namespace;
                break;
            }
        }
    }
    const sharingScope = deriveSharingScope(filePath);
    // Folder derivation wins; when the path yields no primitive folder, fall back to the
    // resolved artifact_type so the id reads e.g. l9.source.app rather than l9.unknown.app.
    let primitiveFolder = derivePrimitiveFolder(filePath);
    if (primitiveFolder === "unknown" && typeHint && typeHint !== "unknown")
        primitiveFolder = typeHint;
    const stem = toSnakeStem(path.basename(filePath));
    return { namespace, sharingScope, primitiveFolder, idStem: `${namespace}.${primitiveFolder}.${stem}` };
}
//# sourceMappingURL=namespace.js.map