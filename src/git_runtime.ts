// Internal Git runtime. The legacy ignored-file observer shares executable lookup
// only; exact-tree observation additionally uses the fail-closed, binary runner.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { TextDecoder } from "node:util";

let resolvedGit: string | null | undefined;

/** Resolve once from absolute PATH entries; never invoke a shell or relative git. */
export function gitExecutable(): string | null {
  if (resolvedGit !== undefined) return resolvedGit;
  const names = process.platform === "win32" ? ["git.exe", "git.cmd"] : ["git"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        resolvedGit = candidate;
        return resolvedGit;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  resolvedGit = null;
  return resolvedGit;
}

export interface GitReadLimits {
  readonly maxOutputBytes?: number;
  readonly timeoutMs?: number;
}

/** All inherited Git controls are removed, including future GIT_* overrides. */
function readOnlyEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith("GIT_")) env[key] = value;
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

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0 || result > 0x7fffffff) {
    throw new Error(`Git observation ${name} must be a positive bounded integer`);
  }
  return result;
}

/** Decode without replacement or BOM stripping. */
export function strictGitUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

type GitControlEntry = { kind: "directory" } | { kind: "file"; text: string } | null;

// These are Git control files, never tracked subject blobs. Read by descriptor
// before launching native Git: newer Git can load includes during bootstrap,
// before `config --no-includes` has parsed its command-specific switches.
function gitControlEntry(file: string): GitControlEntry {
  let fd: number;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Unsafe Git control file");
  }
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (before.isDirectory()) return { kind: "directory" };
    if (!before.isFile() || before.size > 1024n * 1024n)
      throw new Error("Unsupported Git control file");
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = fs.readSync(fd, buffer, count, buffer.length - count, null);
      if (read === 0) break;
      count += read;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    if (count > 1024 * 1024 || before.size !== after.size || before.mtimeNs !== after.mtimeNs)
      throw new Error("Git control file changed or exceeded its cap");
    return { kind: "file", text: strictGitUtf8(buffer.subarray(0, count)) };
  } finally {
    fs.closeSync(fd);
  }
}

function gitControlKind(file: string): "directory" | "file" | null {
  let fd: number;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Unsafe Git control marker");
  }
  try {
    const stat = fs.fstatSync(fd);
    if (stat.isDirectory()) return "directory";
    return stat.isFile() ? "file" : null;
  } finally {
    fs.closeSync(fd);
  }
}

function rejectGitControlIncludes(cwd: string): void {
  const dotGit = gitControlEntry(path.join(cwd, ".git"));
  if (
    !dotGit &&
    (gitControlKind(path.join(cwd, "HEAD")) !== "file" ||
      gitControlKind(path.join(cwd, "objects")) !== "directory")
  )
    return;
  let gitDir = cwd;
  if (dotGit?.kind === "directory") gitDir = path.join(cwd, ".git");
  if (dotGit?.kind === "file") {
    const match = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(dotGit.text);
    if (!match) throw new Error("Unsupported Git directory control");
    gitDir = path.resolve(cwd, match[1]);
  }
  const common = gitControlEntry(path.join(gitDir, "commondir"));
  const commonDir = common?.kind === "file" ? path.resolve(gitDir, common.text.trim()) : gitDir;
  for (const file of new Set([
    path.join(commonDir, "config"),
    path.join(gitDir, "config.worktree"),
    path.join(commonDir, "config.worktree"),
  ])) {
    const entry = gitControlEntry(file);
    if (
      entry?.kind === "file" &&
      /^[\t \uFEFF]*\[[\t ]*include(?:if)?(?:[\t ."\]]|$)/im.test(entry.text)
    ) {
      throw new Error(
        "Git configuration includes are unsupported by content-free observation; use an isolated bare snapshot",
      );
    }
  }
}

/**
 * A single observation has one cumulative output budget and deadline. This runner
 * reads Git metadata only. Callers choose a narrow command vocabulary, not a shell.
 */
export function readOnlyGitRunner(
  root: string,
  limits: GitReadLimits = {},
): (args: readonly string[]) => Buffer {
  const maxOutput = positiveLimit(limits.maxOutputBytes, 64 * 1024 * 1024, "maxOutputBytes");
  const timeout = positiveLimit(limits.timeoutMs, 30_000, "timeoutMs");
  if (typeof root !== "string" || !root || root.includes("\0")) {
    throw new Error("Git observation requires a local repository root");
  }
  const git = gitExecutable();
  if (git === null) throw new Error("Git observation cannot locate an absolute Git executable");
  const cwd = path.resolve(root);
  const env = readOnlyEnvironment();
  const deadline = Date.now() + timeout;
  let remainingOutput = maxOutput;
  const config = [
    "--no-optional-locks",
    "--no-replace-objects",
    "--no-pager",
    "-c",
    "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "-c",
    "protocol.allow=never",
    "-c",
    "protocol.file.allow=never",
    "-c",
    "extensions.partialClone=",
  ];

  const run = (
    args: readonly string[],
    allowAbsent = false,
  ): { status: number; stdout: Buffer } => {
    const remainingTime = deadline - Date.now();
    if (remainingTime <= 0) throw new Error("Git observation timed out");
    if (remainingOutput <= 0) throw new Error("Git observation exceeded its output cap");
    rejectGitControlIncludes(cwd);
    const result = spawnSync(git, [...config, ...args], {
      cwd,
      env,
      shell: false,
      timeout: remainingTime,
      maxBuffer: remainingOutput,
      windowsHide: true,
    });
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === "ETIMEDOUT") throw new Error("Git observation timed out");
      if (code === "ENOBUFS") throw new Error("Git observation exceeded its output cap");
      throw new Error("Git observation could not execute Git");
    }
    if (result.signal !== null || result.status === null) {
      throw new Error("Git observation was interrupted");
    }
    const stdout = result.stdout ?? Buffer.alloc(0);
    const stderr = result.stderr ?? Buffer.alloc(0);
    remainingOutput -= stdout.length + stderr.length;
    if (remainingOutput < 0) throw new Error("Git observation exceeded its output cap");
    if (Date.now() >= deadline) throw new Error("Git observation timed out");
    if (result.status !== 0 && !(allowAbsent && result.status === 1 && stdout.length === 0)) {
      throw new Error(`Git observation ${args[0]} failed (exit ${result.status})`);
    }
    return { status: result.status, stdout };
  };

  // Configuration is control metadata, but includes can redirect its loader to
  // tracked subject payloads. Inspect names without includes and hold that setup.
  const configKeys = (scope: "--local" | "--worktree"): string[] => {
    const keys = run(
      ["config", scope, "--no-includes", "--null", "--name-only", "--list"],
      true,
    ).stdout;
    if (keys.length === 0) return [];
    if (keys[keys.length - 1] !== 0) throw new Error("Malformed Git configuration names");
    return strictGitUtf8(keys.subarray(0, -1)).split("\0");
  };
  const keys = configKeys("--local");
  if (keys.some((key) => key.toLowerCase() === "extensions.worktreeconfig"))
    keys.push(...configKeys("--worktree"));
  if (keys.some((key) => /^(include|includeif)\./i.test(key))) {
    throw new Error(
      "Git configuration includes are unsupported by content-free observation; use an isolated bare snapshot",
    );
  }
  // Older Git lacks --no-lazy-fetch. Disable every local promisor remote before
  // object resolution; transport denial is defense in depth, not fetch permission.
  const seen = new Set<string>();
  for (const key of keys.filter((key) => /^remote\..+\.promisor$/i.test(key))) {
    if (key.includes("\n") || key.includes("\r"))
      throw new Error("Malformed Git promisor configuration");
    if (!seen.has(key)) config.push("-c", `${key}=false`);
    seen.add(key);
  }
  return (args) => run(args).stdout;
}
