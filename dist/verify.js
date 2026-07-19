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
exports.verify = verify;
// verify.ts — Validate injected files; enforce sharing_scope invariants; fail on violation.
const fs = __importStar(require("fs"));
const schema_1 = require("./schema");
const extract_1 = require("./extract");
const comment_1 = require("./comment");
// Recover the clean body from an injected file, mirroring how inject.ts derived
// cleanBody per strategy, so the hash lines up with the recorded originalBodyHash.
function recoverBody(content, spec) {
    if (spec.strategy === "yaml-frontmatter")
        return (0, extract_1.stripExistingFrontMatter)(content);
    if (spec.strategy === "line-comment" || spec.strategy === "block-comment") {
        return (0, comment_1.stripInjectedBlock)(content, spec);
    }
    return content; // sidecar: the file body is left untouched by injection
}
// A metadata header is valid if it is present in whatever form the file's strategy
// dictates: YAML frontmatter, a comment-wrapped block, or a sidecar file.
function metaHeaderValid(filePath, content, issues) {
    const spec = (0, comment_1.resolveStrategy)(filePath, content);
    if (spec.strategy === "yaml-frontmatter") {
        if ((0, extract_1.splitContent)(content).headerConvention === "full-yaml")
            return true;
        issues.push("No full-YAML front matter detected");
        return false;
    }
    if (spec.strategy === "line-comment" || spec.strategy === "block-comment") {
        if ((0, comment_1.hasInjectedBlock)(content, spec))
            return true;
        issues.push("No l9:meta comment block detected");
        return false;
    }
    // sidecar
    const sidecar = (0, comment_1.sidecarPathFor)(filePath);
    if (fs.existsSync(sidecar) && fs.readFileSync(sidecar, "utf8").trim().length > 0)
        return true;
    issues.push("No l9meta sidecar file detected");
    return false;
}
function isPromptMeta(m) { return m.artifact_type === "prompt"; }
function checkSharingScope(meta) {
    const issues = [];
    if (meta.sharing_scope === "shared" && meta.namespace !== "shared" && meta.namespace !== "core") {
        issues.push(`sharing_scope=shared but namespace=${meta.namespace}; shared primitives must live in shared/ or core/ paths`);
    }
    return issues;
}
function verify(filePath, origHash, meta) {
    const issues = [];
    const content = fs.readFileSync(filePath, "utf8");
    const spec = (0, comment_1.resolveStrategy)(filePath, content);
    const yamlValid = metaHeaderValid(filePath, content, issues);
    // Body preservation: re-derive the clean body from disk and compare its hash to
    // the body hash captured before injection. A mismatch means injection altered
    // the body — a hard failure, not a silent pass.
    let bodyPreserved = true;
    if (origHash) {
        bodyPreserved = (0, extract_1.contentHash)(recoverBody(content, spec)) === origHash;
        if (!bodyPreserved)
            issues.push("Body content changed during injection (hash mismatch)");
    }
    let taxonomyValid = true;
    if (meta.callable && meta.mcp_primitive === "none") {
        issues.push("callable=true but mcp_primitive=none");
        taxonomyValid = false;
    }
    const scopeIssues = checkSharingScope(meta);
    scopeIssues.forEach((i) => issues.push(i));
    const sharingScopeValid = scopeIssues.length === 0;
    let promptSchemaComplete = true;
    if (isPromptMeta(meta)) {
        const pm = (0, schema_1.asRecord)(meta);
        for (const f of ["role", "objective", "input_variables", "output_format", "model_target"]) {
            if (pm[f] === schema_1.UNKNOWN) {
                issues.push(`Prompt schema '${f}' is Unknown`);
                promptSchemaComplete = false;
            }
        }
    }
    return { sourcePath: filePath, yamlValid, bodyPreserved, taxonomyValid, promptSchemaComplete, sharingScopeValid, issues };
}
//# sourceMappingURL=verify.js.map