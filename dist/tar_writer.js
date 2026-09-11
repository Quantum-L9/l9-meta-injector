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
exports.injectTarRootMeta = injectTarRootMeta;
exports.injectGzipTarRootMeta = injectGzipTarRootMeta;
exports.buildTarArchive = buildTarArchive;
exports.keptMembers = keptMembers;
// tar_writer.ts — inventory-only TAR rewrite: upsert root .l9meta.yaml (ADR-049).
const zlib = __importStar(require("node:zlib"));
const tar_format_1 = require("./tar_format");
const tar_reader_1 = require("./tar_reader");
function injectTarRootMeta(tarBytes, yaml) {
    const read = (0, tar_reader_1.readTarArchive)(tarBytes);
    if (!read.ok)
        return read;
    const kept = [];
    for (const member of read.members) {
        if ((0, tar_reader_1.rootMetaKind)(member.name) === "canonical")
            continue;
        kept.push(member.rawRecord);
    }
    const meta = (0, tar_format_1.encodeTarEntry)({ name: ".l9meta.yaml", content: yaml, mode: 0o644, type: "0" });
    const out = Buffer.concat([...kept, meta, Buffer.alloc(1024)]);
    return { ok: true, bytes: out };
}
function injectGzipTarRootMeta(gzBytes, yaml) {
    let tar;
    try {
        tar = zlib.gunzipSync(gzBytes);
    }
    catch (err) {
        return { ok: false, hold: `archive.gzip_unreadable:${err.message}` };
    }
    const injected = injectTarRootMeta(tar, yaml);
    if (!injected.ok)
        return injected;
    return { ok: true, bytes: zlib.gzipSync(injected.bytes) };
}
function buildTarArchive(members) {
    return (0, tar_format_1.encodeTarArchive)(members.map((m) => ({ name: m.name, content: m.content })));
}
function keptMembers(members) {
    return members.filter((m) => (0, tar_reader_1.rootMetaKind)(m.name) !== "canonical");
}
//# sourceMappingURL=tar_writer.js.map