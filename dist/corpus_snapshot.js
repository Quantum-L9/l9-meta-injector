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
exports.CORPUS_SNAPSHOT_SCHEMA = void 0;
exports.orderCorpusSnapshot = orderCorpusSnapshot;
exports.renderCorpusSnapshot = renderCorpusSnapshot;
exports.readCorpusSnapshot = readCorpusSnapshot;
exports.snapshotPrechecks = snapshotPrechecks;
// corpus_snapshot.ts — what the corpus was, written down so the next run can tell.
//
// A snapshot is the minimum a later run needs in order to say "these bytes did not
// move": every artifact's corpus identity, its content hash, and the roots those
// identities were computed under. It carries no absolute path, no timestamp and no
// analysis, because none of those are needed to answer that question and each of
// them would make two equal corpora look unequal.
//
// The one thing here that is not identity is `stat_precheck`. It is the size and
// mtime a file had, recorded so the next run can say in advance which files it
// expects to be unchanged and then check itself against the hashes. It decides
// nothing. A run that reads a snapshot still hashes every byte it observes.
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const corpus_analysis_1 = require("./corpus_analysis");
const ordering_1 = require("./ordering");
exports.CORPUS_SNAPSHOT_SCHEMA = "l9.corpus-snapshot/v1";
/** Order a snapshot's contents so two equal corpora render identically. */
function orderCorpusSnapshot(snapshot) {
    return {
        ...snapshot,
        roots: [...snapshot.roots].sort((a, b) => (0, ordering_1.compareCodePoints)(a.root_id, b.root_id)),
        artifacts: [...snapshot.artifacts].sort((a, b) => (0, ordering_1.compareCodePoints)(a.corpus_path, b.corpus_path)
            || (0, ordering_1.compareCodePoints)(a.virtual_source_id, b.virtual_source_id)),
        archives: [...snapshot.archives].sort((a, b) => (0, ordering_1.compareCodePoints)(a.corpus_path, b.corpus_path)),
    };
}
/** Canonical bytes of a snapshot. */
function renderCorpusSnapshot(snapshot) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(orderCorpusSnapshot(snapshot))}\n`;
}
/** Read a snapshot written by an earlier run, refusing anything else. */
function readCorpusSnapshot(snapshotPath) {
    const absolute = path.resolve(snapshotPath);
    const parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
    if (parsed.schema !== exports.CORPUS_SNAPSHOT_SCHEMA) {
        throw new Error(`corpus: ${absolute} declares schema '${String(parsed.schema)}'; expected '${exports.CORPUS_SNAPSHOT_SCHEMA}'`);
    }
    if (!Array.isArray(parsed.artifacts) || !Array.isArray(parsed.archives) || !Array.isArray(parsed.roots)) {
        throw new Error(`corpus: ${absolute} is not a complete corpus snapshot`);
    }
    return parsed;
}
/** The stat prechecks in a snapshot, keyed by virtual source id. */
function snapshotPrechecks(snapshot) {
    const out = new Map();
    for (const artifact of snapshot.artifacts) {
        if (artifact.stat_precheck !== undefined)
            out.set(artifact.virtual_source_id, artifact.stat_precheck);
    }
    return out;
}
//# sourceMappingURL=corpus_snapshot.js.map