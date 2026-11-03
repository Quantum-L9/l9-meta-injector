"use strict";
// git_ignored.ts - the paths git itself ignores in a target work tree (ADR-078).
//
// Git ignore rules apply only to untracked files: a tracked or force-added file that
// matches .gitignore is still the repository's. So the observation does not evaluate
// ignore files itself; it asks git for the untracked-and-ignored set, which also covers
// nested .gitignore files, .git/info/exclude, core.excludesFile and linked worktrees
// exactly as git does.
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
exports.listGitIgnoredUntracked = listGitIgnoredUntracked;
exports.isGitIgnored = isGitIgnored;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
let resolvedGit;
/**
 * Absolute path to git from PATH, resolved once (WU-069 / S4036): spawning the bare
 * name would let a writable PATH entry choose the binary. Relative PATH entries are
 * skipped. Returns null when no executable git is found.
 */
function gitExecutable() {
    if (resolvedGit !== undefined)
        return resolvedGit;
    const names = process.platform === "win32" ? ["git.exe", "git.cmd"] : ["git"];
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        if (!dir || !path.isAbsolute(dir))
            continue;
        for (const name of names) {
            const candidate = path.join(dir, name);
            try {
                if (!fs.statSync(candidate).isFile())
                    continue;
                fs.accessSync(candidate, fs.constants.X_OK);
                resolvedGit = candidate;
                return resolvedGit;
            }
            catch {
                // not here; keep looking
            }
        }
    }
    resolvedGit = null;
    return resolvedGit;
}
function runGit(root, args) {
    const git = gitExecutable();
    if (git === null)
        return { status: null, stdout: "", stderr: "git not found" };
    const result = (0, node_child_process_1.spawnSync)(git, args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
/**
 * The untracked, ignored paths under `root`, or `undefined` when `root` is not inside a
 * git work tree or no git executable is available (a non-git target has no ignore
 * semantics to honour). Inside a work tree a failing listing throws: guessing would
 * make the packet depend on the machine.
 */
function listGitIgnoredUntracked(root) {
    const absolute = path.resolve(root);
    const probe = runGit(absolute, ["rev-parse", "--is-inside-work-tree"]);
    if (probe.status !== 0 || probe.stdout.trim() !== "true")
        return undefined;
    const listed = runGit(absolute, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
    if (listed.status !== 0) {
        throw new Error(`git ls-files failed under ${absolute}: ${listed.stderr.trim() || `exit ${listed.status}`}`);
    }
    const files = new Set();
    const directories = [];
    for (const entry of listed.stdout.split("\0")) {
        if (!entry)
            continue;
        if (entry.endsWith("/"))
            directories.push(entry.slice(0, -1));
        else
            files.add(entry);
    }
    directories.sort();
    return { files, directories };
}
/** True when `relPath` is, or lies under, a path git reports as ignored and untracked. */
function isGitIgnored(ignored, relPath) {
    if (ignored.files.has(relPath))
        return true;
    return ignored.directories.some((dir) => relPath === dir || relPath.startsWith(`${dir}/`));
}
//# sourceMappingURL=git_ignored.js.map