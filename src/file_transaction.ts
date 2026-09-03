/**
 * Whole-run filesystem transaction for governed repository mutations.
 *
 * Every desired file is staged beside its final target, all original states are
 * compare-and-swap checked, and the set is committed with same-directory rename.
 * Backups remain available until post-commit validation succeeds. Any failure
 * rolls the complete set back in reverse order. A durable repository-relative
 * journal permits recovery after process interruption.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { compareCodePoints } from "./ordering";

export const FILE_TRANSACTION_SCHEMA = "l9.file-transaction/v1" as const;
export const TRANSACTION_DIRECTORY = ".l9/.transactions" as const;
/** Paths no transaction may target: the authority document and the journal root. */
const PROTECTED_TRANSACTION_PATHS: ReadonlySet<string> = new Set([".l9/meta-authority.yaml", TRANSACTION_DIRECTORY]);

export interface FileMutationIntent {
  /** Canonical repository-relative POSIX path. */
  path: string;
  /** State observed by the immutable plan. */
  expectedExists: boolean;
  /** Required when expectedExists is true. */
  expectedHash?: string;
  /** Complete replacement bytes. */
  bytes: string | Buffer;
  /** Optional mode for a newly-created target. Existing files preserve their mode. */
  mode?: number;
}

export type TransactionFaultStage =
  | "journal_created"
  | "target_staged"
  | "before_commit"
  | "original_backed_up"
  | "target_committed"
  | "before_validation"
  | "validation_succeeded";

export interface TransactionFaultContext {
  stage: TransactionFaultStage;
  transactionId: string;
  path?: string;
  index?: number;
}

export interface ExecuteFileTransactionOptions {
  /** Called while backups still exist. Throwing triggers a complete rollback. */
  validate?: () => void;
  /** Test hook. Production callers normally omit this. */
  faultInjector?: (context: TransactionFaultContext) => void;
  /** Deterministic test override. */
  transactionId?: string;
}

export interface FileTransactionResult {
  transactionId: string | null;
  plannedWrites: number;
  committedWrites: number;
  changedPaths: string[];
  rolledBack: false;
  journalPath: string | null;
}

export interface RecoveryResult {
  /** Transactions rolled back to their journaled original state. */
  recovered: string[];
  /** Validated transactions whose interrupted cleanup was safely completed. */
  finalized: string[];
}

type EntryState = "planned" | "staged" | "backed_up" | "committed" | "validated";

interface JournalEntry {
  path: string;
  tempPath: string;
  backupPath: string;
  originalExists: boolean;
  originalHash?: string;
  originalMode?: number;
  newHash: string;
  state: EntryState;
}

interface TransactionJournal {
  schema: typeof FILE_TRANSACTION_SCHEMA;
  transaction_id: string;
  state: "preparing" | "staged" | "committing" | "validating" | "complete" | "rolling_back" | "rollback_failed";
  entries: JournalEntry[];
}

interface PreparedEntry extends JournalEntry {
  target: string;
  temp: string;
  backup: string;
  bytes: Buffer;
}

function hashBytes(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function toBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, "utf8");
}

function normalizeRelativePath(value: string): string {
  if (!value || value.trim() !== value || value.length > 4096) throw new Error(`invalid transaction path: ${value || "<empty>"}`);
  if (value.includes("\\") || value.includes("\u0000") || value.startsWith("/") || value.startsWith("./") || value.includes("//")) {
    throw new Error(`transaction path must be canonical repository-relative POSIX: ${value}`);
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`transaction path contains unsafe segment: ${value}`);
  const normalized = parts.join("/");
  // The transaction primitive never writes Git internals, the authority that licenses it,
  // or its own journal directory, whatever a caller plans (ADR-047).
  if (parts.includes(".git")) throw new Error(`transaction path targets Git internal state: ${value}`);
  if (PROTECTED_TRANSACTION_PATHS.has(normalized) || normalized.startsWith(`${TRANSACTION_DIRECTORY}/`)) {
    throw new Error(`transaction path targets protected repository state: ${value}`);
  }
  return normalized;
}

function ensureRoot(rootInput: string): string {
  const root = path.resolve(rootInput);
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`transaction root must be a real directory: ${root}`);
  return root;
}

function absoluteTarget(root: string, relative: string): string {
  const target = path.resolve(root, ...normalizeRelativePath(relative).split("/"));
  const rel = path.relative(root, target);
  if (!rel || rel === "." || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`transaction target escapes or equals repository root: ${relative}`);
  }
  return target;
}

function assertExistingPathSafety(root: string, target: string): void {
  const rel = path.relative(root, target);
  const segments = rel.split(path.sep);
  let cursor = root;
  for (let index = 0; index < segments.length - 1; index++) {
    cursor = path.join(cursor, segments[index]);
    if (!fs.existsSync(cursor)) break;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`transaction parent is not a real directory: ${cursor}`);
  }
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`transaction target must be a regular file: ${target}`);
  }
}

function ensureDirectory(directory: string, created: string[]): void {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`transaction directory is unsafe: ${directory}`);
    return;
  }
  const parent = path.dirname(directory);
  if (parent !== directory) ensureDirectory(parent, created);
  fs.mkdirSync(directory);
  created.push(directory);
}

function fsyncDirectory(directory: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(directory, "r");
    fs.fsyncSync(fd);
  } catch {
    // Some platforms do not permit directory fsync. Same-directory rename still
    // supplies the atomicity boundary; validation and rollback remain mandatory.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function durableWrite(filePath: string, bytes: string, mode = 0o600): void {
  const fd = fs.openSync(filePath, "w", mode);
  try {
    fs.writeFileSync(fd, bytes, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeJournal(journalPath: string, journal: TransactionJournal): void {
  const temp = `${journalPath}.next`;
  if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  durableWrite(temp, `${JSON.stringify(journal, null, 2)}\n`);
  fs.renameSync(temp, journalPath);
  fsyncDirectory(path.dirname(journalPath));
}

function readState(target: string): { exists: boolean; hash?: string; mode?: number } {
  if (!fs.existsSync(target)) return { exists: false };
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`transaction target must remain a regular file: ${target}`);
  return { exists: true, hash: hashBytes(fs.readFileSync(target)), mode: stat.mode & 0o777 };
}

function assertExpected(entry: PreparedEntry): void {
  const current = readState(entry.target);
  if (current.exists !== entry.originalExists) {
    throw new Error(`TRANSACTION_CONCURRENT_DRIFT: ${entry.path} existence changed after planning`);
  }
  if (entry.originalExists && current.hash !== entry.originalHash) {
    throw new Error(`TRANSACTION_CONCURRENT_DRIFT: ${entry.path} bytes changed after planning`);
  }
}

function removeIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
}

function cleanupEmptyDirectories(created: readonly string[]): void {
  for (const directory of [...created].reverse()) {
    try { fs.rmdirSync(directory); } catch { /* retained because non-empty */ }
  }
}

function rollbackEntries(entries: PreparedEntry[], journalPath: string, journal: TransactionJournal, createdDirectories: string[]): void {
  journal.state = "rolling_back";
  try { writeJournal(journalPath, journal); } catch { /* continue restoring data */ }
  const failures: string[] = [];
  for (const entry of [...entries].reverse()) {
    try {
      if (fs.existsSync(entry.backup)) {
        removeIfExists(entry.target);
        fs.renameSync(entry.backup, entry.target);
        fsyncDirectory(path.dirname(entry.target));
      } else if (!entry.originalExists && fs.existsSync(entry.target)) {
        const current = readState(entry.target);
        if (current.hash === entry.newHash || entry.state === "committed" || entry.state === "validated") {
          fs.rmSync(entry.target, { force: true });
          fsyncDirectory(path.dirname(entry.target));
        }
      }
      removeIfExists(entry.temp);
      const transactionOwnedState = entry.state === "backed_up" || entry.state === "committed" || entry.state === "validated" || fs.existsSync(entry.backup);
      if (transactionOwnedState) {
        const restored = readState(entry.target);
        if (restored.exists !== entry.originalExists || (entry.originalExists && restored.hash !== entry.originalHash)) {
          throw new Error("restored state does not match journaled original");
        }
      }
    } catch (error) {
      failures.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    journal.state = "rollback_failed";
    try { writeJournal(journalPath, journal); } catch { /* preserve best available evidence */ }
    throw new Error(`TRANSACTION_ROLLBACK_FAILED: ${failures.join("; ")}`);
  }
  removeIfExists(journalPath);
  removeIfExists(`${journalPath}.next`);
  cleanupEmptyDirectories(createdDirectories);
}

function prepareEntries(root: string, intents: readonly FileMutationIntent[], id: string): PreparedEntry[] {
  const seen = new Set<string>();
  const prepared: PreparedEntry[] = [];
  for (const [index, intent] of [...intents].sort((a, b) => compareCodePoints(a.path, b.path)).entries()) {
    const relative = normalizeRelativePath(intent.path);
    if (seen.has(relative)) throw new Error(`duplicate transaction target: ${relative}`);
    seen.add(relative);
    const target = absoluteTarget(root, relative);
    assertExistingPathSafety(root, target);
    const state = readState(target);
    if (state.exists !== intent.expectedExists) throw new Error(`TRANSACTION_PLAN_STALE: ${relative} existence differs from plan`);
    if (intent.expectedExists) {
      if (!intent.expectedHash || !/^[a-f0-9]{64}$/.test(intent.expectedHash)) throw new Error(`transaction expectedHash missing or invalid for ${relative}`);
      if (state.hash !== intent.expectedHash) throw new Error(`TRANSACTION_PLAN_STALE: ${relative} hash differs from plan`);
    } else if (intent.expectedHash !== undefined) {
      throw new Error(`transaction expectedHash must be omitted for a missing target: ${relative}`);
    }
    const bytes = toBuffer(intent.bytes);
    const newHash = hashBytes(bytes);
    if (state.exists && state.hash === newHash) continue;
    const basename = path.basename(target);
    const token = `${id}-${String(index).padStart(4, "0")}`;
    prepared.push({
      path: relative,
      target,
      temp: path.join(path.dirname(target), `.${basename}.l9txn-${token}.tmp`),
      backup: path.join(path.dirname(target), `.${basename}.l9txn-${token}.bak`),
      tempPath: normalizeRelativePath(path.relative(root, path.join(path.dirname(target), `.${basename}.l9txn-${token}.tmp`)).split(path.sep).join("/")),
      backupPath: normalizeRelativePath(path.relative(root, path.join(path.dirname(target), `.${basename}.l9txn-${token}.bak`)).split(path.sep).join("/")),
      originalExists: state.exists,
      originalHash: state.hash,
      originalMode: state.mode,
      newHash,
      bytes,
      state: "planned",
    });
  }
  return prepared;
}

function journalEntry(entry: PreparedEntry): JournalEntry {
  return {
    path: entry.path,
    tempPath: entry.tempPath,
    backupPath: entry.backupPath,
    originalExists: entry.originalExists,
    originalHash: entry.originalHash,
    originalMode: entry.originalMode,
    newHash: entry.newHash,
    state: entry.state,
  };
}

interface TransactionContext {
  id: string;
  journal: TransactionJournal;
  journalPath: string;
  options: ExecuteFileTransactionOptions;
}

/** Stage every intent into its temp file, verifying bytes and journaling progress. */
function stageEntries(ctx: TransactionContext, entries: PreparedEntry[], intents: readonly FileMutationIntent[], createdDirectories: string[]): void {
  for (const [index, entry] of entries.entries()) {
    ensureDirectory(path.dirname(entry.target), createdDirectories);
    if (fs.existsSync(entry.temp) || fs.existsSync(entry.backup)) throw new Error(`transaction staging collision for ${entry.path}`);
    const mode = entry.originalMode ?? intents.find((item) => normalizeRelativePath(item.path) === entry.path)?.mode ?? 0o644;
    const fd = fs.openSync(entry.temp, "wx", mode);
    try {
      // `open` applies the process umask to `mode`; the recorded original mode (or the
      // intent's mode) is the contract, so it is restored on the descriptor before commit.
      fs.fchmodSync(fd, mode);
      fs.writeFileSync(fd, entry.bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (hashBytes(fs.readFileSync(entry.temp)) !== entry.newHash) throw new Error(`transaction staged bytes failed verification for ${entry.path}`);
    entry.state = "staged";
    ctx.journal.entries[index] = journalEntry(entry);
    writeJournal(ctx.journalPath, ctx.journal);
    ctx.options.faultInjector?.({ stage: "target_staged", transactionId: ctx.id, path: entry.path, index });
  }
}

/** Back up originals and rename staged temps into place, journaling each commit. */
function commitEntries(ctx: TransactionContext, entries: PreparedEntry[]): void {
  for (const [index, entry] of entries.entries()) {
    if (entry.originalExists) {
      fs.renameSync(entry.target, entry.backup);
      fsyncDirectory(path.dirname(entry.target));
      entry.state = "backed_up";
      ctx.journal.entries[index] = journalEntry(entry);
      writeJournal(ctx.journalPath, ctx.journal);
      ctx.options.faultInjector?.({ stage: "original_backed_up", transactionId: ctx.id, path: entry.path, index });
    }
    fs.renameSync(entry.temp, entry.target);
    fsyncDirectory(path.dirname(entry.target));
    entry.state = "committed";
    ctx.journal.entries[index] = journalEntry(entry);
    writeJournal(ctx.journalPath, ctx.journal);
    ctx.options.faultInjector?.({ stage: "target_committed", transactionId: ctx.id, path: entry.path, index });
  }
}

/** Confirm every committed target exists with the expected content hash. */
function assertPostconditions(entries: PreparedEntry[]): void {
  for (const entry of entries) {
    const state = readState(entry.target);
    if (!state.exists || state.hash !== entry.newHash) throw new Error(`TRANSACTION_POSTCONDITION_FAILED: ${entry.path}`);
  }
}

export function executeFileTransaction(
  rootInput: string,
  intents: readonly FileMutationIntent[],
  options: ExecuteFileTransactionOptions = {},
): FileTransactionResult {
  const root = ensureRoot(rootInput);
  const id = (options.transactionId ?? randomUUID().replace(/-/g, "")).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(id)) throw new Error(`invalid transaction id: ${id}`);
  const entries = prepareEntries(root, intents, id);
  if (entries.length === 0) {
    options.validate?.();
    return { transactionId: null, plannedWrites: 0, committedWrites: 0, changedPaths: [], rolledBack: false, journalPath: null };
  }

  const createdDirectories: string[] = [];
  const journalDirectory = path.join(root, ...TRANSACTION_DIRECTORY.split("/"));
  ensureDirectory(journalDirectory, createdDirectories);
  const journalPath = path.join(journalDirectory, `${id}.json`);
  if (fs.existsSync(journalPath)) throw new Error(`transaction journal already exists: ${id}`);
  const journal: TransactionJournal = {
    schema: FILE_TRANSACTION_SCHEMA,
    transaction_id: id,
    state: "preparing",
    entries: entries.map(journalEntry),
  };
  const ctx: TransactionContext = { id, journal, journalPath, options };
  try {
    writeJournal(journalPath, journal);
    options.faultInjector?.({ stage: "journal_created", transactionId: id });
    stageEntries(ctx, entries, intents, createdDirectories);
    journal.state = "staged";
    writeJournal(journalPath, journal);
    options.faultInjector?.({ stage: "before_commit", transactionId: id });
    for (const entry of entries) assertExpected(entry);

    journal.state = "committing";
    writeJournal(journalPath, journal);
    commitEntries(ctx, entries);

    assertPostconditions(entries);
    journal.state = "validating";
    writeJournal(journalPath, journal);
    options.faultInjector?.({ stage: "before_validation", transactionId: id });
    options.validate?.();
    options.faultInjector?.({ stage: "validation_succeeded", transactionId: id });
    for (const [index, entry] of entries.entries()) {
      entry.state = "validated";
      journal.entries[index] = journalEntry(entry);
    }
    // `complete` is durable before backups are removed. Recovery may therefore
    // finish cleanup without rolling a successfully validated transaction back.
    journal.state = "complete";
    writeJournal(journalPath, journal);

    for (const entry of entries) removeIfExists(entry.backup);
    removeIfExists(journalPath);
    removeIfExists(`${journalPath}.next`);
    // The target parent directories remain by design; only ephemeral journal
    // directories are removed when empty.
    cleanupEmptyDirectories(createdDirectories.filter((item) => item.startsWith(journalDirectory)));
    return {
      transactionId: id,
      plannedWrites: entries.length,
      committedWrites: entries.length,
      changedPaths: entries.map((entry) => entry.path),
      rolledBack: false,
      journalPath: path.relative(root, journalPath).split(path.sep).join("/"),
    };
  } catch (error) {
    try {
      rollbackEntries(entries, journalPath, journal, createdDirectories);
    } catch (rollbackError) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
    throw error;
  }
}

function journalToPrepared(root: string, journal: TransactionJournal, journalName: string): PreparedEntry[] {
  if (journal.schema !== FILE_TRANSACTION_SCHEMA || !journal.transaction_id || !Array.isArray(journal.entries)) {
    throw new Error("invalid transaction journal");
  }
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(journal.transaction_id)) throw new Error("invalid transaction journal id");
  if (journalName !== `${journal.transaction_id}.json`) throw new Error("transaction journal filename/id mismatch");
  const allowedJournalStates = new Set(["preparing", "staged", "committing", "validating", "complete", "rolling_back", "rollback_failed"]);
  const allowedEntryStates = new Set<EntryState>(["planned", "staged", "backed_up", "committed", "validated"]);
  if (!allowedJournalStates.has(journal.state)) throw new Error("invalid transaction journal state");
  return journal.entries.map((entry, index) => {
    if (!allowedEntryStates.has(entry.state)) throw new Error(`invalid transaction entry state at ${index}`);
    if (!/^[a-f0-9]{64}$/.test(entry.newHash)) throw new Error(`invalid transaction new hash at ${index}`);
    if (entry.originalExists && (!entry.originalHash || !/^[a-f0-9]{64}$/.test(entry.originalHash))) {
      throw new Error(`invalid transaction original hash at ${index}`);
    }
    const target = absoluteTarget(root, entry.path);
    const basename = path.basename(target);
    const token = `${journal.transaction_id}-${String(index).padStart(4, "0")}`;
    const expectedTemp = path.relative(root, path.join(path.dirname(target), `.${basename}.l9txn-${token}.tmp`)).split(path.sep).join("/");
    const expectedBackup = path.relative(root, path.join(path.dirname(target), `.${basename}.l9txn-${token}.bak`)).split(path.sep).join("/");
    if (entry.tempPath !== expectedTemp || entry.backupPath !== expectedBackup) {
      throw new Error(`transaction journal staging path mismatch at ${index}`);
    }
    const temp = absoluteTarget(root, entry.tempPath);
    const backup = absoluteTarget(root, entry.backupPath);
    assertExistingPathSafety(root, target);
    return { ...entry, target, temp, backup, bytes: Buffer.alloc(0) };
  });
}

export function recoverPendingTransactions(rootInput: string): RecoveryResult {
  const root = ensureRoot(rootInput);
  const directory = path.join(root, ...TRANSACTION_DIRECTORY.split("/"));
  if (!fs.existsSync(directory)) return { recovered: [], finalized: [] };
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`transaction journal directory is unsafe: ${directory}`);
  const recovered: string[] = [];
  const finalized: string[] = [];
  const journals = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort(compareCodePoints);
  for (const name of journals) {
    const journalPath = path.join(directory, name);
    const parsed = JSON.parse(fs.readFileSync(journalPath, "utf8")) as TransactionJournal;
    const entries = journalToPrepared(root, parsed, name);
    if (parsed.state === "complete") {
      for (const entry of entries) {
        const current = readState(entry.target);
        if (!current.exists || current.hash !== entry.newHash) {
          throw new Error(`TRANSACTION_FINALIZATION_FAILED: ${entry.path} does not match completed journal`);
        }
        removeIfExists(entry.backup);
        removeIfExists(entry.temp);
      }
      removeIfExists(journalPath);
      removeIfExists(`${journalPath}.next`);
      finalized.push(parsed.transaction_id);
    } else {
      rollbackEntries(entries, journalPath, parsed, []);
      recovered.push(parsed.transaction_id);
    }
  }
  // A crash during the first durable journal rename can leave only a `.next`
  // file. No repository target can have been committed before a primary journal
  // exists, so these orphan journal temporaries are safe to remove.
  for (const name of fs.readdirSync(directory).filter((item) => item.endsWith(".json.next"))) {
    fs.rmSync(path.join(directory, name), { force: true });
  }
  try { fs.rmdirSync(directory); } catch { /* keep non-empty directory */ }
  try { fs.rmdirSync(path.dirname(directory)); } catch { /* keep .l9 when used */ }
  return { recovered, finalized };
}
