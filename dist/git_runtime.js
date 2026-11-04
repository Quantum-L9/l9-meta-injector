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
exports.gitExecutable = gitExecutable;
exports.strictGitUtf8 = strictGitUtf8;
exports.readOnlyGitRunner = readOnlyGitRunner;
// Internal Git runtime. The legacy ignored-file observer shares executable lookup
// only; exact-tree observation additionally uses the fail-closed, binary runner.
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_util_1 = require("node:util");
let resolvedGit;
/** Resolve once from absolute PATH entries; never invoke a shell or relative git. */
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
                // Not here; keep looking.
            }
        }
    }
    resolvedGit = null;
    return resolvedGit;
}
/** All inherited Git controls are removed, including future GIT_* overrides. */
function readOnlyEnvironment() {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (!key.toUpperCase().startsWith("GIT_"))
            env[key] = value;
    }
    const nullFile = process.platform === "win32" ? "NUL" : "/dev/null";
    return {
        ...env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_SYSTEM: nullFile,
        GIT_CONFIG_GLOBAL: nullFile,
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_NO_LAZY_FETCH: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        // Even Git versions predating GIT_NO_LAZY_FETCH cannot use any transport.
        GIT_ALLOW_PROTOCOL: "",
        GIT_PROTOCOL_FROM_USER: "0",
        LC_ALL: "C",
    };
}
function positiveLimit(value, fallback, name) {
    const result = value ?? fallback;
    if (!Number.isSafeInteger(result) || result <= 0 || result > 0x7fffffff) {
        throw new Error(`Git observation ${name} must be a positive bounded integer`);
    }
    return result;
}
/** Decode without replacement or BOM stripping. */
function strictGitUtf8(bytes) {
    return new node_util_1.TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}
/**
 * A single observation has one cumulative output budget and deadline. This runner
 * reads Git metadata only. Callers choose a narrow command vocabulary, not a shell.
 */
function readOnlyGitRunner(root, limits = {}) {
    const maxOutput = positiveLimit(limits.maxOutputBytes, 64 * 1024 * 1024, "maxOutputBytes");
    const timeout = positiveLimit(limits.timeoutMs, 30000, "timeoutMs");
    if (typeof root !== "string" || !root || root.includes("\0")) {
        throw new Error("Git observation requires a local repository root");
    }
    const git = gitExecutable();
    if (git === null)
        throw new Error("Git observation cannot locate an absolute Git executable");
    const cwd = path.resolve(root);
    const env = readOnlyEnvironment();
    const deadline = Date.now() + timeout;
    let remainingOutput = maxOutput;
    const config = [
        "--no-optional-locks", "--no-replace-objects", "--no-pager",
        "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
        "-c", "core.fsmonitor=false",
        "-c", "core.untrackedCache=false",
        "-c", "protocol.allow=never",
        "-c", "protocol.file.allow=never",
        "-c", "extensions.partialClone=",
    ];
    const run = (args, allowAbsent = false) => {
        const remainingTime = deadline - Date.now();
        if (remainingTime <= 0)
            throw new Error("Git observation timed out");
        if (remainingOutput <= 0)
            throw new Error("Git observation exceeded its output cap");
        const result = (0, node_child_process_1.spawnSync)(git, [...config, ...args], {
            cwd, env, shell: false,
            timeout: remainingTime, maxBuffer: remainingOutput,
            windowsHide: true,
        });
        if (result.error) {
            const code = result.error.code;
            if (code === "ETIMEDOUT")
                throw new Error("Git observation timed out");
            if (code === "ENOBUFS")
                throw new Error("Git observation exceeded its output cap");
            throw new Error("Git observation could not execute Git");
        }
        if (result.signal !== null || result.status === null) {
            throw new Error("Git observation was interrupted");
        }
        const stdout = result.stdout ?? Buffer.alloc(0);
        const stderr = result.stderr ?? Buffer.alloc(0);
        remainingOutput -= stdout.length + stderr.length;
        if (remainingOutput < 0)
            throw new Error("Git observation exceeded its output cap");
        if (Date.now() >= deadline)
            throw new Error("Git observation timed out");
        if (result.status !== 0 && !(allowAbsent && result.status === 1 && stdout.length === 0)) {
            throw new Error(`Git observation ${args[0]} failed (exit ${result.status})`);
        }
        return { status: result.status, stdout };
    };
    // Configuration is control metadata, but includes can redirect its loader to
    // tracked subject payloads. Inspect names without includes and hold that setup.
    const configKeys = (scope) => {
        const keys = run(["config", scope, "--no-includes", "--null", "--name-only", "--list"], true).stdout;
        if (keys.length === 0)
            return [];
        if (keys[keys.length - 1] !== 0)
            throw new Error("Malformed Git configuration names");
        return strictGitUtf8(keys.subarray(0, -1)).split("\0");
    };
    const keys = configKeys("--local");
    if (keys.some((key) => key.toLowerCase() === "extensions.worktreeconfig"))
        keys.push(...configKeys("--worktree"));
    if (keys.some((key) => /^(include|includeif)\./i.test(key))) {
        throw new Error("Git configuration includes are unsupported by content-free observation; use an isolated bare snapshot");
    }
    // Older Git lacks --no-lazy-fetch. Disable every local promisor remote before
    // object resolution; transport denial is defense in depth, not fetch permission.
    const seen = new Set();
    for (const key of keys.filter((key) => /^remote\..+\.promisor$/i.test(key))) {
        if (key.includes("\n") || key.includes("\r"))
            throw new Error("Malformed Git promisor configuration");
        if (!seen.has(key))
            config.push("-c", `${key}=false`);
        seen.add(key);
    }
    return (args) => run(args).stdout;
}
//# sourceMappingURL=git_runtime.js.map