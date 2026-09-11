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
exports.parseMetaYaml = parseMetaYaml;
exports.mergeHarvested = mergeHarvested;
exports.harvestExistingMeta = harvestExistingMeta;
// inventory_existing_meta.ts — harvest existing L9 meta before classify (ADR-049).
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const frontmatter_patch_1 = require("./frontmatter_patch");
const comment_1 = require("./comment");
const meta_schema_1 = require("./meta_schema");
const encoding_1 = require("./encoding");
const inventory_archive_member_1 = require("./inventory_archive_member");
function parseMetaYaml(text) {
    try {
        const obj = (0, meta_schema_1.parseCanonicalYaml)(text);
        return typeof obj === "object" && obj !== null ? obj : {};
    }
    catch {
        return {};
    }
}
function harvestInline(abs) {
    const encoding = (0, encoding_1.probeFileEncoding)(abs);
    if (encoding.status !== "utf8")
        return {};
    const raw = fs.readFileSync(abs, "utf8");
    const spec = (0, comment_1.resolveStrategy)(abs, raw);
    if (spec.strategy === "yaml-frontmatter") {
        const inspected = (0, frontmatter_patch_1.inspectFrontMatterDocument)(raw);
        return inspected.safe ? inspected.meta : {};
    }
    if (spec.strategy === "line-comment" || spec.strategy === "block-comment") {
        const yaml = (0, comment_1.extractInjectedYaml)(raw, spec);
        return yaml ? parseMetaYaml(yaml) : {};
    }
    return {};
}
function harvestSidecar(abs) {
    const sidecar = (0, comment_1.sidecarPathFor)(abs);
    if (!fs.existsSync(sidecar))
        return {};
    try {
        return parseMetaYaml(fs.readFileSync(sidecar, "utf8"));
    }
    catch {
        return {};
    }
}
function harvestFolder(dir) {
    const sidecar = path.join(dir, ".l9meta.yaml");
    if (!fs.existsSync(sidecar))
        return {};
    try {
        return parseMetaYaml(fs.readFileSync(sidecar, "utf8"));
    }
    catch {
        return {};
    }
}
/** Later sources win. Inventory clocks overwrite these after harvest. */
function mergeHarvested(...layers) {
    const out = {};
    for (const layer of layers) {
        for (const [key, value] of Object.entries(layer)) {
            if (value !== undefined)
                out[key] = value;
        }
    }
    return out;
}
function harvestExistingMeta(abs, isDir) {
    if (isDir) {
        return harvestFolder(abs);
    }
    const member = (0, inventory_archive_member_1.peekArchiveRootMeta)(abs);
    const fromMember = member ? parseMetaYaml(member) : {};
    const sidecar = harvestSidecar(abs);
    const inline = harvestInline(abs);
    return mergeHarvested(fromMember, sidecar, inline);
}
//# sourceMappingURL=inventory_existing_meta.js.map