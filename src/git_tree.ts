// Exact Git leaf-tree observation. No filesystem candidates, policy, or blob reads.
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ReadTrackedGitSnapshotInput,
  TrackedGitEntry,
  TrackedGitSnapshot,
} from "./discovery_contracts";
import { readOnlyGitRunner, strictGitUtf8 } from "./git_runtime";

function oidPattern(format: TrackedGitSnapshot["object_format"]): RegExp {
  return new RegExp(`^[0-9a-f]{${format === "sha1" ? 40 : 64}}$`);
}

function scalar(bytes: Buffer): string {
  // rev-parse emits one LF. Do not trim path spellings or silently accept extra rows.
  if (bytes.length === 0 || bytes[bytes.length - 1] !== 10) {
    throw new Error("Malformed Git scalar output");
  }
  return strictGitUtf8(bytes.subarray(0, -1));
}

function objectFormat(
  run: (args: readonly string[]) => Buffer,
): TrackedGitSnapshot["object_format"] {
  const format = scalar(run(["rev-parse", "--show-object-format=storage"]));
  if (format !== "sha1" && format !== "sha256") throw new Error("Unsupported Git object format");
  return format;
}

function objectOid(bytes: Buffer, format: TrackedGitSnapshot["object_format"]): string {
  const oid = scalar(bytes);
  if (!oidPattern(format).test(oid)) throw new Error("Malformed Git object identity");
  return oid;
}

function pathComponents(raw: Buffer): Buffer[] {
  if (raw.length === 0 || raw.includes(0)) throw new Error("Malformed Git leaf path");
  const components: Buffer[] = [];
  let start = 0;
  for (let end = 0; end <= raw.length; end += 1) {
    if (end !== raw.length && raw[end] !== 47) continue;
    const component = raw.subarray(start, end);
    if (
      component.length === 0 ||
      component.equals(Buffer.from(".")) ||
      component.equals(Buffer.from(".."))
    ) {
      throw new Error("Malformed Git repository-relative path");
    }
    components.push(component);
    start = end + 1;
  }
  return components;
}

function parseLeaf(
  row: Buffer,
  format: TrackedGitSnapshot["object_format"],
  seen: Set<string>,
): { raw: Buffer; entry: TrackedGitEntry } {
  const tab = row.indexOf(9);
  if (tab <= 0) throw new Error("Malformed Git tree row");
  const header = row.subarray(0, tab);
  if (header.some((byte) => byte > 127)) throw new Error("Non-ASCII Git tree header");
  const matched = /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]+)$/.exec(
    header.toString("ascii"),
  );
  if (!matched || !oidPattern(format).test(matched[3]))
    throw new Error("Malformed Git leaf mode/type/object identity");
  const mode = matched[1] as TrackedGitEntry["mode"];
  const type = matched[2] as TrackedGitEntry["object_type"];
  if ((mode === "160000") !== (type === "commit"))
    throw new Error("Invalid Git leaf mode/type combination");
  const raw = row.subarray(tab + 1);
  pathComponents(raw);
  const base64 = raw.toString("base64");
  if (seen.has(base64)) throw new Error("Duplicate Git leaf path");
  seen.add(base64);
  let decoded: string | null;
  try {
    decoded = strictGitUtf8(raw);
  } catch {
    decoded = null;
  }
  return {
    raw,
    entry: Object.freeze({
      path: decoded,
      path_bytes_base64: base64,
      mode,
      object_type: type,
      object_oid: matched[3],
    }),
  };
}

function parseLeaves(
  bytes: Buffer,
  format: TrackedGitSnapshot["object_format"],
): readonly TrackedGitEntry[] {
  if (bytes.length !== 0 && bytes[bytes.length - 1] !== 0) {
    throw new Error("Truncated Git tree output (missing NUL terminator)");
  }
  const entries: { raw: Buffer; entry: TrackedGitEntry }[] = [];
  const seen = new Set<string>();
  let start = 0;
  for (let end = 0; end < bytes.length; end += 1) {
    if (bytes[end] !== 0) continue;
    const row = bytes.subarray(start, end);
    start = end + 1;
    entries.push(parseLeaf(row, format, seen));
  }
  // Byte order is portable even for names which no host can decode/materialize.
  entries.sort((a, b) => Buffer.compare(a.raw, b.raw));
  return Object.freeze(entries.map(({ entry }) => entry));
}

/**
 * Resolve a commit selector exactly once, then enumerate only immutable tree OIDs.
 * Missing checkout files, ignored/untracked noise, and the index are irrelevant.
 * Missing required commit/tree objects, malformed output, caps and timeouts throw;
 * none is represented as an empty complete census. Blob/gitlink targets are never
 * opened or required locally, and no network, hooks, optional locks or shell run.
 */
export function readTrackedGitSnapshot(input: ReadTrackedGitSnapshotInput): TrackedGitSnapshot {
  if (
    typeof input.repositoryId !== "string" ||
    !input.repositoryId.trim() ||
    input.repositoryId.includes("\0")
  ) {
    throw new Error("Git census requires a declared repository identity");
  }
  if (typeof input.revision !== "string" || !input.revision || input.revision.includes("\0")) {
    throw new Error("Git census requires an explicit commit selector");
  }
  const run = readOnlyGitRunner(input.root, input);
  const format = objectFormat(run);
  const revision = objectOid(
    run(["rev-parse", "--verify", "--end-of-options", `${input.revision}^{commit}`]),
    format,
  );
  const tree = objectOid(
    run(["rev-parse", "--verify", "--end-of-options", `${revision}^{tree}`]),
    format,
  );
  const entries = parseLeaves(run(["ls-tree", "-r", "-z", "--full-tree", tree]), format);
  return Object.freeze({
    repository_id: input.repositoryId,
    revision,
    tree_oid: tree,
    object_format: format,
    entries,
  });
}

const INDEX_PATH = Buffer.from(".l9/metadata-index.jsonl");

function nulRows(bytes: Buffer): Buffer[] {
  if (bytes.length !== 0 && bytes[bytes.length - 1] !== 0)
    throw new Error("Truncated Git index output");
  const rows: Buffer[] = [];
  let start = 0;
  for (let end = 0; end < bytes.length; end += 1) {
    if (bytes[end] !== 0) continue;
    rows.push(bytes.subarray(start, end));
    start = end + 1;
  }
  return rows;
}

function trackedPathStat(current: Buffer, missingGitlinkAllowed: boolean): fs.Stats | null {
  try {
    return fs.lstatSync(current);
  } catch {
    // Gitlinks need not have an initialized checkout or referenced object.
    if (missingGitlinkAllowed) return null;
    throw new Error("Tracked source path is missing or inaccessible");
  }
}

function assertTrackedPathMode(
  stat: fs.Stats,
  mode: TrackedGitEntry["mode"],
  isAncestor: boolean,
): void {
  if (isAncestor) {
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Tracked source ancestor is not a safe directory");
  } else if (mode === "160000") {
    // Checking a checked-out submodule HEAD would traverse another repository.
    // Fail closed rather than silently ignore a possibly changed gitlink.
    throw new Error("Cannot verify an initialized gitlink without submodule traversal");
  } else if (mode === "120000") {
    if (!stat.isSymbolicLink()) throw new Error("Tracked source symlink mode changed");
  } else if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Tracked source file mode changed");
  }
}

function assertTrackedEntryAncestry(
  entry: TrackedGitEntry,
  raw: Buffer,
  root: string,
  checked: Set<string>,
): void {
  const components = pathComponents(raw);
  if (process.platform === "win32" && (entry.path === null || raw.includes(92))) {
    throw new Error("Tracked path cannot safely be checked on this host");
  }
  let current = Buffer.from(root);
  for (let i = 0; i < components.length; i += 1) {
    current = Buffer.concat([current, Buffer.from(path.sep), components[i]]);
    const key = current.toString("base64");
    if (checked.has(key)) continue;
    const isAncestor = i < components.length - 1;
    const stat = trackedPathStat(current, !isAncestor && entry.mode === "160000");
    if (stat === null) break;
    assertTrackedPathMode(stat, entry.mode, isAncestor);
    if (isAncestor) checked.add(key);
  }
}

/** Check ancestry using lstat only; never let Git follow a changed directory link. */
function assertTrackedAncestry(snapshot: TrackedGitSnapshot, root: string): void {
  const checked = new Set<string>();
  for (const entry of snapshot.entries) {
    const raw = Buffer.from(entry.path_bytes_base64, "base64");
    if (raw.toString("base64") !== entry.path_bytes_base64)
      throw new Error("Noncanonical snapshot path identity");
    if (raw.equals(INDEX_PATH)) continue;
    assertTrackedEntryAncestry(entry, raw, root, checked);
  }
}

/**
 * Apply-only guard, NOT the content-free census. Git may inspect tracked checkout
 * bytes to compare them to its index; external diff/textconv/fsmonitor are disabled.
 * HEAD is checked before and after the observations. Call again around index CAS:
 * this is a fail-closed concurrency check, not a filesystem lock or atomic proof.
 * Only the root index output is excluded; untracked/ignored noise is not inspected.
 */
export function assertTrackedGitTopLevel(root: string): void {
  // The census always enumerates the whole commit tree (`ls-tree --full-tree`), so
  // the index base, authority and transaction must sit at the same top level. A
  // subdirectory root would write a nested index that claims root-level records.
  const topLevel = scalar(
    readOnlyGitRunner(root)(["rev-parse", "--path-format=absolute", "--show-toplevel"]),
  );
  if (!path.isAbsolute(topLevel) || topLevel.includes("\0"))
    throw new Error("Invalid Git worktree root");
  if (fs.realpathSync(path.resolve(root)) !== fs.realpathSync(topLevel)) {
    throw new Error("Tracked check/apply root must be the Git top-level directory");
  }
}

export function assertTrackedWorktreeCurrent(snapshot: TrackedGitSnapshot, root: string): void {
  if (!oidPattern(snapshot.object_format).test(snapshot.revision))
    throw new Error("Invalid snapshot revision");
  const probe = readOnlyGitRunner(root);
  if (objectFormat(probe) !== snapshot.object_format)
    throw new Error("Snapshot Git object format changed");
  const head = () =>
    objectOid(
      probe(["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"]),
      snapshot.object_format,
    );
  if (head() !== snapshot.revision) throw new Error("Tracked snapshot is not current HEAD");
  const worktreeRoot = scalar(probe(["rev-parse", "--path-format=absolute", "--show-toplevel"]));
  if (!path.isAbsolute(worktreeRoot) || worktreeRoot.includes("\0"))
    throw new Error("Invalid Git worktree root");
  const run = readOnlyGitRunner(worktreeRoot);
  // Git checkout comparison may invoke clean/process drivers even with external
  // diff/textconv disabled. This seam never runs repository-configured programs.
  for (const key of nulRows(run(["config", "--null", "--name-only", "--list"]))) {
    if (/^filter\./i.test(strictGitUtf8(key))) {
      throw new Error(
        "Configured Git filters require a separately trusted source-currentness proof",
      );
    }
  }
  const scope = ["--", ":(top,glob)**", ":(top,exclude,literal).l9/metadata-index.jsonl"];
  const common = ["--raw", "-z", "--no-renames", "--no-ext-diff", "--no-textconv"];
  if (
    run([
      "diff-index",
      "--cached",
      ...common,
      "--ignore-submodules=none",
      snapshot.revision,
      ...scope,
    ]).length !== 0
  ) {
    throw new Error("Tracked source has staged changes");
  }
  for (const row of nulRows(run(["ls-files", "-v", "--full-name", "-z"]))) {
    if (row.length < 3 || row[1] !== 32) throw new Error("Malformed Git index flags");
    if (row.subarray(2).equals(INDEX_PATH)) continue;
    if (row[0] !== 72)
      throw new Error("Tracked source index flags prevent a trustworthy currentness check");
  }
  assertTrackedAncestry(snapshot, worktreeRoot);
  if (run(["diff-files", ...common, "--ignore-submodules=all", ...scope]).length !== 0) {
    throw new Error("Tracked source has unstaged changes");
  }
  if (head() !== snapshot.revision)
    throw new Error("Tracked HEAD changed during currentness check");
}
