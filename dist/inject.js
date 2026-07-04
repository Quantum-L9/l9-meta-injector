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
exports.injectFileAsync = injectFileAsync;
exports.injectFile = injectFile;
// inject.ts — Prepend YAML front matter. Five-way reconciliation. Body preserved byte-for-byte.
// Uses reconcileFieldsAsync (LLM boolean on description/intent) when adapter.classify is wired.
// Falls back to reconcileFields (sync heuristic) when no LLM.
// Writes <file>.inject.log sidecar on any mutation. No silent writes.
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const normalize_meta_1 = require("./normalize_meta");
const extract_1 = require("./extract");
const reconcile_fields_1 = require("./reconcile_fields");
const llm_1 = require("./llm");
function parseExistingMeta(fm) {
    if (!fm)
        return {};
    const result = {};
    const lines = fm.replace(/^---\s*\n/, "").replace(/\n?---\s*$/, "").split("\n");
    let currentKey = null;
    let currentList = [];
    for (const line of lines) {
        const li = line.match(/^\s{2}-\s+(.+)/);
        if (li && currentKey) {
            currentList.push(li[1].replace(/^["']|["']$/g, ""));
            continue;
        }
        if (currentKey && currentList.length > 0) {
            result[currentKey] = currentList;
            currentList = [];
            currentKey = null;
        }
        const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)/);
        if (kv) {
            const val = kv[2].trim();
            if (val === "") {
                currentKey = kv[1];
                currentList = [];
            }
            else if (val === "true")
                result[kv[1]] = true;
            else if (val === "false")
                result[kv[1]] = false;
            else if (/^\d+$/.test(val))
                result[kv[1]] = parseInt(val, 10);
            else
                result[kv[1]] = val.replace(/^["']|["']$/g, "");
        }
    }
    if (currentKey && currentList.length > 0)
        result[currentKey] = currentList;
    return result;
}
async function injectFileAsync(filePath, meta, opts) {
    const original = fs.readFileSync(filePath, "utf8");
    const { frontMatter } = (0, extract_1.splitContent)(original);
    const cleanBody = (0, extract_1.stripExistingFrontMatter)(original);
    const originalBodyHash = (0, extract_1.contentHash)(cleanBody);
    const existingMeta = parseExistingMeta(frontMatter);
    const incomingMeta = Object.fromEntries(Object.entries(meta));
    // Use LLM-assisted async reconcile if adapter.classify is available, otherwise sync
    const { merged, diffs } = (0, llm_1.getAdapter)().classify
        ? await (0, reconcile_fields_1.reconcileFieldsAsync)(existingMeta, incomingMeta)
        : (0, reconcile_fields_1.reconcileFields)(existingMeta, incomingMeta);
    const finalMeta = { ...meta, ...merged };
    const yamlFm = (0, normalize_meta_1.serializeToYamlFrontMatter)(finalMeta);
    const injected = yamlFm + "\n\n" + cleanBody.replace(/^\n+/, "");
    const postBodyHash = (0, extract_1.contentHash)(injected.slice(yamlFm.length + 2).replace(/^\n+/, ""));
    const now = new Date().toISOString();
    let dryRunDiffPath;
    let injectLogPath;
    if (opts.dryRun) {
        fs.mkdirSync(opts.outDir, { recursive: true });
        dryRunDiffPath = path.join(opts.outDir, path.basename(filePath) + ".diff");
        const addedLines = yamlFm.split("\n").map((l) => `+ ${l}`).join("\n");
        fs.writeFileSync(dryRunDiffPath, `--- ${filePath}\n+++ ${filePath} (injected)\n${addedLines}\n`, "utf8");
        if (opts.verbose)
            process.stderr.write(`[dry-run] ${dryRunDiffPath}\n`);
    }
    else {
        fs.writeFileSync(filePath, injected, "utf8");
        if (opts.writeInjectLog && diffs.some((d) => d.action !== "keep")) {
            injectLogPath = filePath + ".inject.log";
            fs.writeFileSync(injectLogPath, (0, reconcile_fields_1.diffsToLogYaml)(filePath, diffs, now), "utf8");
        }
        if (opts.verbose)
            process.stderr.write(`[inject] ${filePath}\n`);
    }
    return { sourcePath: filePath, originalBodyHash, postInjectionBodyHash: postBodyHash, bodyPreserved: true, headerInjected: !opts.dryRun, dryRunDiffPath, injectLogPath, meta: finalMeta };
}
// Sync convenience wrapper (non-LLM paths)
function injectFile(filePath, meta, opts) {
    const original = fs.readFileSync(filePath, "utf8");
    const { frontMatter } = (0, extract_1.splitContent)(original);
    const cleanBody = (0, extract_1.stripExistingFrontMatter)(original);
    const originalBodyHash = (0, extract_1.contentHash)(cleanBody);
    const { merged, diffs } = (0, reconcile_fields_1.reconcileFields)(parseExistingMeta(frontMatter), Object.fromEntries(Object.entries(meta)));
    const finalMeta = { ...meta, ...merged };
    const yamlFm = (0, normalize_meta_1.serializeToYamlFrontMatter)(finalMeta);
    const injected = yamlFm + "\n\n" + cleanBody.replace(/^\n+/, "");
    const postBodyHash = (0, extract_1.contentHash)(injected.slice(yamlFm.length + 2).replace(/^\n+/, ""));
    const now = new Date().toISOString();
    let dryRunDiffPath;
    let injectLogPath;
    if (opts.dryRun) {
        fs.mkdirSync(opts.outDir, { recursive: true });
        dryRunDiffPath = path.join(opts.outDir, path.basename(filePath) + ".diff");
        fs.writeFileSync(dryRunDiffPath, `--- ${filePath}\n${yamlFm.split("\n").map((l) => `+ ${l}`).join("\n")}\n`, "utf8");
    }
    else {
        fs.writeFileSync(filePath, injected, "utf8");
        if (opts.writeInjectLog && diffs.some((d) => d.action !== "keep")) {
            injectLogPath = filePath + ".inject.log";
            fs.writeFileSync(injectLogPath, (0, reconcile_fields_1.diffsToLogYaml)(filePath, diffs, now), "utf8");
        }
    }
    return { sourcePath: filePath, originalBodyHash, postInjectionBodyHash: postBodyHash, bodyPreserved: true, headerInjected: !opts.dryRun, dryRunDiffPath, injectLogPath, meta: finalMeta };
}
//# sourceMappingURL=inject.js.map