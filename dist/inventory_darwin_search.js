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
exports.L9_COMMENT_PREFIX = void 0;
exports.versionTokenFromFileName = versionTokenFromFileName;
exports.buildFinderComment = buildFinderComment;
exports.buildFinderTags = buildFinderTags;
exports.isInventoryFinderComment = isInventoryFinderComment;
exports.harvestDarwinSearch = harvestDarwinSearch;
exports.projectDarwinSearch = projectDarwinSearch;
// inventory_darwin_search.ts — derived Finder Comment + Tags projection (ADR-049).
// Not an L9 source of truth. Inventory-only. Fail-soft off Darwin.
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
exports.L9_COMMENT_PREFIX = "L9:";
const COMMENT_MAX = 200;
const FINDER_COMMENT = "com.apple.metadata:kMDItemFinderComment";
const USER_TAGS = "com.apple.metadata:_kMDItemUserTags";
const VERSION_IN_NAME = /(?:^|[._-])(v?\d+\.\d+(?:\.\d+)?)/i;
function versionTokenFromFileName(fileName) {
    const match = fileName.match(VERSION_IN_NAME);
    return match?.[1] ?? null;
}
function buildFinderComment(input) {
    const stem = input.fileName.replace(/\.(tar\.gz|tgz|zip|tar)$/i, "");
    const parts = [stem, input.kind, "archive"];
    const title = input.harvestedTitle?.trim();
    if (title && title !== stem && title !== input.fileName)
        parts.push(title);
    const line = `${exports.L9_COMMENT_PREFIX} ${parts.filter(Boolean).join(" · ")}`;
    return line.length <= COMMENT_MAX ? line : line.slice(0, COMMENT_MAX);
}
function buildFinderTags(input) {
    const tags = new Set(["l9", "archive", input.kind]);
    for (const tag of input.harvestedTags ?? []) {
        const clean = String(tag).trim();
        if (clean && clean.length <= 40 && !/^[0-9a-f]{16,}$/i.test(clean))
            tags.add(clean);
    }
    const version = versionTokenFromFileName(input.fileName);
    if (version)
        tags.add(version);
    return [...tags];
}
function isInventoryFinderComment(value) {
    if (value === null || value.trim() === "")
        return true;
    return value.trimStart().startsWith(exports.L9_COMMENT_PREFIX);
}
function escapeXml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function stringPlistXml(value) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><string>${escapeXml(value)}</string></plist>\n`;
}
function tagsPlistXml(tags) {
    const items = tags.map((tag) => `  <string>${escapeXml(`${tag}\n0`)}</string>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<array>\n${items}\n</array>\n</plist>\n`;
}
function toBinaryPlist(xml) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-plist-"));
    const file = path.join(dir, "x.plist");
    try {
        fs.writeFileSync(file, xml, "utf8");
        (0, node_child_process_1.execFileSync)("plutil", ["-convert", "binary1", file], { stdio: "pipe" });
        return fs.readFileSync(file);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
function readXattrHex(abs, key) {
    try {
        const hex = (0, node_child_process_1.execFileSync)("xattr", ["-px", key, abs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
        if (!hex)
            return null;
        return Buffer.from(hex.replace(/\s+/g, ""), "hex");
    }
    catch {
        return null;
    }
}
function writeXattrHex(abs, key, bytes) {
    (0, node_child_process_1.execFileSync)("xattr", ["-wx", key, bytes.toString("hex"), abs], { stdio: "pipe" });
}
function plistStringFromBinary(bytes) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-plist-"));
    const file = path.join(dir, "x.plist");
    try {
        fs.writeFileSync(file, bytes);
        (0, node_child_process_1.execFileSync)("plutil", ["-convert", "xml1", file], { stdio: "pipe" });
        const xml = fs.readFileSync(file, "utf8");
        const match = xml.match(/<string>([\s\S]*?)<\/string>/);
        return match ? match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : null;
    }
    catch {
        return null;
    }
}
function existingComment(abs) {
    const bytes = readXattrHex(abs, FINDER_COMMENT);
    if (!bytes)
        return null;
    return plistStringFromBinary(bytes);
}
function existingTags(abs) {
    const bytes = readXattrHex(abs, USER_TAGS);
    if (!bytes)
        return [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-plist-"));
    const file = path.join(dir, "x.plist");
    try {
        fs.writeFileSync(file, bytes);
        (0, node_child_process_1.execFileSync)("plutil", ["-convert", "xml1", file], { stdio: "pipe" });
        const xml = fs.readFileSync(file, "utf8");
        return [...xml.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1].split("\n")[0]).filter(Boolean);
    }
    catch {
        return [];
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
/** Read current Finder Comment/Tags before any rewrite that replaces the inode. */
function harvestDarwinSearch(abs) {
    if (process.platform !== "darwin")
        return { comment: null, tags: [] };
    return { comment: existingComment(abs), tags: existingTags(abs) };
}
function projectDarwinSearch(abs, input, prior = harvestDarwinSearch(abs)) {
    if (process.platform !== "darwin")
        return null;
    try {
        const comment = buildFinderComment(input);
        const replaceComment = isInventoryFinderComment(prior.comment);
        if (replaceComment) {
            writeXattrHex(abs, FINDER_COMMENT, toBinaryPlist(stringPlistXml(comment)));
        }
        else if (prior.comment) {
            writeXattrHex(abs, FINDER_COMMENT, toBinaryPlist(stringPlistXml(prior.comment)));
        }
        const merged = [...new Set([...prior.tags, ...buildFinderTags(input)])];
        writeXattrHex(abs, USER_TAGS, toBinaryPlist(tagsPlistXml(merged)));
        return null;
    }
    catch (err) {
        return `darwin_search_write_failed:${err.message}`;
    }
}
//# sourceMappingURL=inventory_darwin_search.js.map