"use strict";
// git-binary.js — resolve the git executable once, to an absolute path.
//
// Spawning the bare name "git" makes the OS consult PATH at exec time, so a
// writable directory earlier in PATH decides which binary runs. Resolving to an
// absolute path up front removes that lookup from every later call, and pinning
// the result means a PATH edited midway through a run cannot swap the binary
// between two calls that are meant to describe the same repository.
//
// This lives here rather than in each caller because two scripts needed it and
// a copy in each is a second definition to keep in step — and, concretely, the
// duplication was large enough relative to the change that introduced it to
// fail the duplication gate.
const fs = require("node:fs");
const path = require("node:path");

let cached = null;

/**
 * Absolute path to `git`, resolved from PATH once and memoized.
 *
 * @param {(message: string) => never} onMissing called when no candidate is
 *   executable, so each caller reports through its own failure channel rather
 *   than this module choosing how to exit.
 */
function gitBinary(onMissing) {
  if (cached !== null) return cached;
  const names = process.platform === "win32" ? ["git.exe", "git.cmd"] : ["git"];
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        cached = candidate;
        return cached;
      } catch {
        // Not this directory; keep looking.
      }
    }
  }
  return onMissing("cannot locate a git executable on PATH");
}

module.exports = { gitBinary };
