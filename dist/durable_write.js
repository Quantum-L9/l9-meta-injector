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
exports.nodeFileOps = void 0;
exports.writeFileDurably = writeFileDurably;
exports.syncDirectory = syncDirectory;
exports.commitFileDurably = commitFileDurably;
// durable_write.ts — staged, synced, renamed, synced.
//
// Several places in this package write a file that a later run will read back and
// trust: a cache entry, a session manifest, an output projection. All of them
// wrote to a sibling and renamed, which is the right shape and only half the
// guarantee.
//
// A rename is atomic, so no reader ever sees a half-written file *while the
// system is running*. It says nothing about what survives the system stopping.
// `writeFileSync` returns once the bytes are in the page cache; the rename
// records a directory entry that is itself only in the page cache. A power cut
// between either of those and the flush can leave, on a real filesystem, a file
// of exactly the right length full of zeros, or a name pointing at contents that
// were never written. Both parse. Both would be read back as complete.
//
// So the full sequence is: write the staging file, fsync it, rename, fsync the
// parent directory. Each step covers a failure the previous one does not.
//
// The directory sync is best-effort by design. Windows will not open a directory
// as a file and some filesystems refuse the sync; both are tolerated rather than
// thrown, because the alternative is a package that cannot write on those
// platforms in exchange for a durability improvement they cannot offer anyway.
// Nothing about the in-system atomicity depends on it.
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
/** The real thing, which every caller outside a test uses. */
exports.nodeFileOps = {
    openSync: (target, flags, mode) => (mode === undefined ? fs.openSync(target, flags) : fs.openSync(target, flags, mode)),
    writeSync: (handle, contents) => {
        fs.writeFileSync(handle, contents, "utf8");
    },
    fsyncSync: (handle) => fs.fsyncSync(handle),
    closeSync: (handle) => fs.closeSync(handle),
    renameSync: (from, to) => fs.renameSync(from, to),
};
/**
 * Write bytes and make sure they reached the device before returning.
 *
 * `between` runs while the descriptor is still open, so a caller applying
 * permissions is applying them to the file that is about to be synced rather
 * than to whatever the path names by then.
 */
function writeFileDurably(target, contents, options = {}) {
    const ops = options.ops ?? exports.nodeFileOps;
    const handle = ops.openSync(target, "w", options.mode);
    try {
        ops.writeSync(handle, contents);
        options.between?.();
        ops.fsyncSync(handle);
    }
    finally {
        ops.closeSync(handle);
    }
}
/**
 * Flush a directory's own contents, so a rename into it is on the device.
 *
 * Failure is swallowed: see the file header. A caller that needs to know
 * whether the flush happened is asking a question this function deliberately
 * does not answer, because the answer differs per filesystem and no correctness
 * property here depends on it.
 */
function syncDirectory(directory, ops = exports.nodeFileOps) {
    let handle = null;
    try {
        handle = ops.openSync(directory, "r");
        ops.fsyncSync(handle);
    }
    catch {
        // Not supported here. In-system atomicity is unaffected.
    }
    finally {
        if (handle !== null) {
            try {
                ops.closeSync(handle);
            }
            catch {
                // Nothing useful remains to do with a descriptor that will not close.
            }
        }
    }
}
/**
 * The whole sequence: stage, sync, rename, sync the parent.
 *
 * `staging` must be a sibling of `target`, because a rename across filesystems
 * is a copy and is not atomic. Callers pick the name — the cache disambiguates
 * concurrent writers with a pid and a counter — so this function does not invent
 * one and quietly collide with theirs.
 */
function commitFileDurably(input) {
    const ops = input.ops ?? exports.nodeFileOps;
    const directory = path.dirname(input.target);
    writeFileDurably(input.staging, input.contents, {
        ops,
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
        ...(input.between !== undefined ? { between: input.between } : {}),
    });
    ops.renameSync(input.staging, input.target);
    syncDirectory(directory, ops);
}
//# sourceMappingURL=durable_write.js.map