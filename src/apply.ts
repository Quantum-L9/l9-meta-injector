/** Governed carrier-aware whole-run transactional apply operation. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { inspectRepositoryAuthority } from "./authority_scan";
import {
  CANONICAL_METADATA_WRITER,
  planCarrierOperationAsync,
  unsatisfiedAuthorizationDrift,
  type CarrierOperationPlan,
} from "./carrier_operation";
import { METADATA_INDEX_RELATIVE_PATH } from "./metadata_index";
import {
  executeFileTransaction,
  recoverPendingTransactions,
  type FileMutationIntent,
} from "./file_transaction";
import type { ApplyResult, OperationResult } from "./operation_contracts";
import { injectFile } from "./inject";
import { emptyDiscoverySummary } from "./discovery_contracts";
import { verify } from "./verify";
import type { InjectionRecord, PipelineConfig } from "./schema";
import { compareCodePoints } from "./ordering";

export interface ApplyConfig extends Omit<PipelineConfig, "dryRun"> {
  dryRun?: false;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function relativePath(root: string, target: string): string {
  const rel = path.relative(root, target);
  if (!rel || rel === "." || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`apply target escapes or equals repository root: ${target}`);
  }
  return rel.split(path.sep).join("/");
}

function authorityFailure(
  conflicts: ApplyResult["authorityConflicts"],
  notices: ApplyResult["authorityNotices"],
  warnings: string[] = [],
): OperationResult {
  const apply: ApplyResult = {
    passed: false,
    repositoryMutated: false,
    scanned: 0,
    planned: 0,
    changed: 0,
    inlineChanged: [],
    metadataIndexChanged: false,
    authorityConflicts: conflicts,
    authorityNotices: notices,
    carrierDecisions: [],
    discovery: emptyDiscoverySummary(),
    transaction: {
      transactionId: null,
      plannedWrites: 0,
      committedWrites: 0,
      rolledBack: false,
      recoveredTransactions: [],
      finalizedTransactions: [],
    },
  };
  return {
    mode: "apply",
    passed: false,
    authorityRequired: true,
    authorityResolved: false,
    repositoryMutated: false,
    warnings,
    apply,
  };
}

/**
 * Render the already-reconciled canonical metadata against a disposable copy.
 * The repository remains untouched; the result must match the shared planner's
 * expected hash before it can enter the transaction.
 */
function renderInlineBytes(root: string, planned: InjectionRecord, outDir: string): Buffer {
  if (!planned.targetPath || planned.targetPath !== planned.sourcePath) {
    throw new Error(`inline mutation target must equal source: ${planned.sourcePath}`);
  }
  if (!planned.expectedContentHash || planned.wouldChange === undefined || planned.targetExists === undefined) {
    throw new Error(`inline mutation plan is incomplete: ${planned.sourcePath}`);
  }
  const renderRoot = fs.mkdtempSync(path.join(os.tmpdir(), "l9-meta-render-"));
  const renderTarget = path.join(renderRoot, path.basename(planned.sourcePath));
  try {
    fs.copyFileSync(planned.sourcePath, renderTarget);
    const rendered = injectFile(renderTarget, planned.meta, {
      dryRun: false,
      outDir,
      verbose: false,
      writeInjectLog: false,
      writeDryRunDiff: false,
    });
    if (rendered.injectionStrategy !== "yaml-frontmatter" || rendered.sidecarPath || rendered.injectLogPath) {
      throw new Error(`carrier policy violation while rendering ${planned.sourcePath}`);
    }
    const bytes = fs.readFileSync(renderTarget);
    const actualHash = sha256(bytes);
    if (actualHash !== planned.expectedContentHash) {
      throw new Error(`APPLY_RENDER_DIVERGENCE: ${relativePath(root, planned.sourcePath)} expected ${planned.expectedContentHash}, rendered ${actualHash}`);
    }
    return bytes;
  } finally {
    fs.rmSync(renderRoot, { recursive: true, force: true });
  }
}

function currentIntentState(target: string): { expectedExists: boolean; expectedHash?: string } {
  if (!fs.existsSync(target)) return { expectedExists: false };
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`apply target must be a regular file: ${target}`);
  return { expectedExists: true, expectedHash: sha256(fs.readFileSync(target)) };
}

function buildMutationIntents(root: string, plan: CarrierOperationPlan, outDir: string): FileMutationIntent[] {
  const intents: FileMutationIntent[] = [];
  for (const planned of plan.inlinePlans) {
    if (!planned.wouldChange) continue;
    const target = planned.targetPath;
    if (!target) throw new Error(`inline plan lacks targetPath: ${planned.sourcePath}`);
    const bytes = renderInlineBytes(root, planned, outDir);
    intents.push({
      path: relativePath(root, target),
      expectedExists: planned.targetExists === true,
      expectedHash: planned.targetExists ? planned.actualContentHash : undefined,
      bytes,
    });
  }

  const indexTarget = path.join(root, ...METADATA_INDEX_RELATIVE_PATH.split("/"));
  const indexState = currentIntentState(indexTarget);
  const desiredIndexHash = sha256(plan.metadataIndex.bytes);
  if (indexState.expectedHash !== desiredIndexHash) {
    intents.push({
      path: METADATA_INDEX_RELATIVE_PATH,
      ...indexState,
      bytes: plan.metadataIndex.bytes,
      mode: 0o644,
    });
  }
  return intents.sort((left, right) => compareCodePoints(left.path, right.path));
}

function validateCommittedPlan(root: string, plan: CarrierOperationPlan): void {
  for (const planned of plan.inlinePlans) {
    if (!planned.wouldChange) continue;
    if (!planned.targetPath || !planned.expectedContentHash) throw new Error(`inline validation plan incomplete: ${planned.sourcePath}`);
    const actualHash = sha256(fs.readFileSync(planned.targetPath));
    if (actualHash !== planned.expectedContentHash) {
      throw new Error(`APPLY_POSTCONDITION_FAILED: ${relativePath(root, planned.sourcePath)} hash mismatch`);
    }
    const verified = verify(planned.sourcePath, planned.originalBodyHash, planned.meta);
    if (verified.issues.length > 0) {
      throw new Error(`APPLY_VERIFICATION_FAILED: ${relativePath(root, planned.sourcePath)}: ${verified.issues.join("; ")}`);
    }
  }
  const indexTarget = path.join(root, ...METADATA_INDEX_RELATIVE_PATH.split("/"));
  if (!fs.existsSync(indexTarget) || fs.readFileSync(indexTarget, "utf8") !== plan.metadataIndex.bytes) {
    throw new Error("APPLY_POSTCONDITION_FAILED: canonical metadata index differs from planned bytes");
  }
}

export async function runApplyAsync(config: ApplyConfig): Promise<OperationResult> {
  const root = path.resolve(config.root);
  // Recovery precedes authority inspection so journal or backup artifacts from an
  // interrupted commit cannot poison the authority scan and strand partial state.
  const recovery = recoverPendingTransactions(root);
  const warnings = [
    ...recovery.recovered.map((id) => `rolled back interrupted metadata transaction ${id}`),
    ...recovery.finalized.map((id) => `finalized validated metadata transaction ${id}`),
  ];
  const inspection = inspectRepositoryAuthority(root, {
    expectedWriter: { repository: CANONICAL_METADATA_WRITER },
  });
  if (inspection.conflicts.length > 0 || !inspection.authority) {
    return authorityFailure(inspection.conflicts, inspection.notices, warnings);
  }
  if (config.localFiles) throw new Error("apply does not expand archives; local-files requires a separate import workflow");
  if (config.normalizeFilenames) throw new Error("apply does not normalize filenames; rename work must be reviewed separately");

  const plan = await planCarrierOperationAsync({
    mode: "apply",
    authority: inspection.authority,
    config: {
      ...config,
      root,
      dryRun: true,
      localFiles: false,
      normalizeFilenames: false,
      writeInjectLog: false,
      persistOutputs: false,
    },
  });
  if (plan.pipeline.coverage.discovery.blocking > 0) {
    throw new Error(`DISCOVERY_INCOMPLETE: apply refused with ${plan.pipeline.coverage.discovery.blocking} blocking path(s)`);
  }
  const unsatisfied = unsatisfiedAuthorizationDrift(plan);
  if (unsatisfied.length > 0) {
    // The repository authorized inline metadata for a file whose header cannot be
    // rewritten byte-safely. Preserving those bytes wins; apply holds and names the files.
    return authorityFailure(
      unsatisfied.map((item) => ({
        code: "META_AUTHORITY_CONFLICT" as const,
        message: item.message,
        path: item.path,
      })),
      inspection.notices,
      warnings,
    );
  }

  const intents = buildMutationIntents(root, plan, config.outDir);
  const transaction = executeFileTransaction(root, intents, {
    validate: () => validateCommittedPlan(root, plan),
  });
  const inlineChanged = transaction.changedPaths.filter((item) => item !== METADATA_INDEX_RELATIVE_PATH);
  const metadataIndexChanged = transaction.changedPaths.includes(METADATA_INDEX_RELATIVE_PATH);
  const repositoryMutated = transaction.changedPaths.length > 0;
  const apply: ApplyResult = {
    passed: true,
    repositoryMutated,
    scanned: plan.pipeline.coverage.scanned,
    planned: plan.subjects.length,
    changed: transaction.changedPaths.length,
    inlineChanged,
    metadataIndexChanged,
    authorityConflicts: [],
    authorityNotices: inspection.notices,
    carrierDecisions: plan.carrierDecisions,
    discovery: plan.pipeline.coverage.discovery,
    transaction: {
      transactionId: transaction.transactionId,
      plannedWrites: transaction.plannedWrites,
      committedWrites: transaction.committedWrites,
      rolledBack: transaction.rolledBack,
      recoveredTransactions: recovery.recovered,
      finalizedTransactions: recovery.finalized,
    },
  };
  return {
    mode: "apply",
    passed: true,
    authorityRequired: true,
    authorityResolved: true,
    repositoryMutated,
    warnings,
    apply,
  };
}
