/**
 * Shared carrier-aware planning for governed check/apply operations.
 *
 * This module is the single bridge from the canonical pipeline's metadata plan
 * to the carrier policy. It never writes source files, adjacent sidecars, logs,
 * reports, or indexes. Both check and apply consume the exact same plan.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { AuthorityConfig, CarrierDecision, CheckDrift } from "./operation_contracts";
import {
  compileMetadataIndex,
  METADATA_INDEX_RELATIVE_PATH,
  parseMetadataIndex,
  type MetadataIndexCompilation,
  type MetadataIndexRecord,
} from "./metadata_index";
import { resolveCarrierDecisions, assertCarrierDecisionCoverage, type CarrierSubject } from "./mutation_policy";
import { runPipelineAsync, type PipelineMetadataSubject, type PipelineResult } from "./pipeline";
import type { InjectionRecord, PipelineConfig } from "./schema";
import { compareCodePoints } from "./ordering";

export const CANONICAL_METADATA_WRITER = "Quantum-L9/l9-meta-injector" as const;

export type GovernedCarrierMode = "check" | "apply";

export interface CarrierOperationPlan {
  mode: GovernedCarrierMode;
  root: string;
  authority: AuthorityConfig;
  pipeline: PipelineResult;
  subjects: PipelineMetadataSubject[];
  carrierDecisions: CarrierDecision[];
  metadataIndex: MetadataIndexCompilation;
  /**
   * The existing index a scoped run merged with (ADR-058), or null for an unscoped run,
   * which never reads it. Apply binds the index intent's compare-and-swap to this base.
   * `unmergeableReason` is set when the base cannot be preserved: check reports it as a
   * conflict and apply refuses before any write.
   */
  metadataIndexBase: { exists: boolean; sha256?: string; unmergeableReason?: string } | null;
  inlinePlans: InjectionRecord[];
}

export interface PlanCarrierOperationInput {
  mode: GovernedCarrierMode;
  authority: AuthorityConfig;
  config: PipelineConfig;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function relativePath(root: string, target: string): string {
  const rel = path.relative(root, target);
  if (!rel || rel === ".") return ".";
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`carrier operation target escapes repository root: ${target}`);
  }
  return toPosix(rel);
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function decisionMap(decisions: readonly CarrierDecision[]): Map<string, CarrierDecision> {
  const out = new Map<string, CarrierDecision>();
  for (const item of decisions) {
    if (out.has(item.path)) throw new Error(`duplicate carrier decision path: ${item.path}`);
    out.set(item.path, item);
  }
  return out;
}

function assertInlinePlan(root: string, record: InjectionRecord, decision: CarrierDecision): void {
  const source = relativePath(root, record.sourcePath);
  if (source !== decision.path) throw new Error(`inline plan path mismatch: ${source} != ${decision.path}`);
  if (record.injectionStrategy !== "yaml-frontmatter") {
    throw new Error(`inline_managed requires yaml-frontmatter, got '${record.injectionStrategy ?? "unknown"}' for ${source}`);
  }
  if (!record.targetPath || relativePath(root, record.targetPath) !== source) {
    throw new Error(`inline_managed target must be the source file itself: ${source}`);
  }
  if (record.expectedContentHash === undefined || record.wouldChange === undefined || record.targetExists === undefined) {
    throw new Error(`inline_managed plan is incomplete for ${source}`);
  }
}

/** Fail if the metadata index and carrier operation disagree on decisions. */
function assertMetadataIndexParity(
  metadataIndex: MetadataIndexCompilation,
  carrierDecisions: readonly CarrierDecision[],
): void {
  if (metadataIndex.carrierDecisions.length !== carrierDecisions.length) {
    throw new Error("metadata index and carrier operation decision counts diverged");
  }
  for (let index = 0; index < carrierDecisions.length; index++) {
    if (JSON.stringify(metadataIndex.carrierDecisions[index]) !== JSON.stringify(carrierDecisions[index])) {
      throw new Error(`metadata index and carrier operation decisions diverged at ${carrierDecisions[index].path}`);
    }
  }
}

/** Index canonical injection plans by their repository-relative source path. */
function indexInjectionPlansBySource(
  root: string,
  injected: readonly InjectionRecord[],
): Map<string, InjectionRecord> {
  const planBySource = new Map<string, InjectionRecord>();
  for (const record of injected) {
    const source = relativePath(root, record.sourcePath);
    if (planBySource.has(source)) throw new Error(`duplicate pipeline injection plan for ${source}`);
    planBySource.set(source, record);
  }
  return planBySource;
}

/** Resolve the sorted inline-managed injection plans, validating each subject's decision. */
function collectInlinePlans(
  root: string,
  subjects: readonly PipelineMetadataSubject[],
  byPath: Map<string, CarrierDecision>,
  planBySource: Map<string, InjectionRecord>,
): InjectionRecord[] {
  const inlinePlans: InjectionRecord[] = [];
  for (const subject of subjects) {
    const decision = byPath.get(subject.path);
    if (!decision) throw new Error(`missing carrier decision for ${subject.path}`);
    const record = planBySource.get(subject.path);
    if (decision.carrier === "inline_managed") {
      if (!record) throw new Error(`inline_managed subject lacks canonical injection plan: ${subject.path}`);
      assertInlinePlan(root, record, decision);
      inlinePlans.push(record);
    } else if (record?.sidecarPath) {
      // The historical syntax planner may have proposed a sidecar. Carrier policy
      // owns the final destination, so that sidecar proposal is deliberately ignored.
      const sidecar = relativePath(root, record.sidecarPath);
      if (!sidecar.endsWith(".l9meta.yaml")) throw new Error(`unexpected legacy sidecar target: ${sidecar}`);
    }
  }
  inlinePlans.sort((a, b) => compareCodePoints(relativePath(root, a.sourcePath), relativePath(root, b.sourcePath)));
  return inlinePlans;
}

const SCOPE_FILTERED_DISPOSITIONS: ReadonlySet<string> = new Set(["glob_filtered", "extension_filtered"]);

/** Paths the run's own discovery ledger recorded as outside the requested scope. */
function scopeFilteredPaths(pipeline: PipelineResult): Set<string> {
  return new Set(
    pipeline.coverage.discovery.entries
      .filter((entry) => entry.kind === "file" && SCOPE_FILTERED_DISPOSITIONS.has(entry.disposition))
      .map((entry) => entry.path),
  );
}

const UNSCOPED_REBUILD_ADVICE = "a scoped run cannot preserve out-of-scope records; run an unscoped check/apply to rebuild the index";

/**
 * Read the existing index for a scoped run. Only the records of scope-filtered paths are
 * carried forward; every other path's record comes from the current subjects.
 */
function readScopedIndexBase(
  root: string,
  outOfScope: ReadonlySet<string>,
): { base: NonNullable<CarrierOperationPlan["metadataIndexBase"]>; preserved: MetadataIndexRecord[] } {
  const target = path.join(root, ...METADATA_INDEX_RELATIVE_PATH.split("/"));
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { base: { exists: false }, preserved: [] };
    const reason = error instanceof Error ? error.message : String(error);
    return { base: { exists: true, unmergeableReason: `existing ${METADATA_INDEX_RELATIVE_PATH} cannot be inspected (${reason}); ${UNSCOPED_REBUILD_ADVICE}` }, preserved: [] };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { base: { exists: true, unmergeableReason: `existing ${METADATA_INDEX_RELATIVE_PATH} is not a regular file; ${UNSCOPED_REBUILD_ADVICE}` }, preserved: [] };
  }
  const raw = fs.readFileSync(target);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  try {
    const records = parseMetadataIndex(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    return { base: { exists: true, sha256 }, preserved: records.filter((record) => outOfScope.has(record.path)) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { base: { exists: true, sha256, unmergeableReason: `existing ${METADATA_INDEX_RELATIVE_PATH} cannot be parsed (${reason}); ${UNSCOPED_REBUILD_ADVICE}` }, preserved: [] };
  }
}

export function buildCarrierOperationPlan(
  mode: GovernedCarrierMode,
  rootInput: string,
  authority: AuthorityConfig,
  pipeline: PipelineResult,
): CarrierOperationPlan {
  const root = path.resolve(rootInput);
  const subjects = [...pipeline.metadataSubjects].sort((a, b) => compareCodePoints(a.path, b.path));
  const carrierSubjects: CarrierSubject[] = subjects.map(({ path: subjectPath, artifactType, strategy, inlineCarrierBlock }) => ({
    path: subjectPath,
    artifactType,
    strategy,
    ...(inlineCarrierBlock ? { inlineCarrierBlock: { code: inlineCarrierBlock.code, malformed: inlineCarrierBlock.malformed } } : {}),
  }));
  const carrierDecisions = resolveCarrierDecisions({ authority, mode, subjects: carrierSubjects });
  assertCarrierDecisionCoverage(carrierSubjects, carrierDecisions);
  const byPath = decisionMap(carrierDecisions);

  // ADR-058: a scoped run (its ledger recorded scope-filtered files) merges with the
  // existing index; an unscoped run never reads it and compiles exactly as before.
  const outOfScope = scopeFilteredPaths(pipeline);
  const scopedBase = outOfScope.size > 0 ? readScopedIndexBase(root, outOfScope) : null;
  const metadataIndex = compileMetadataIndex({
    authority,
    mode,
    subjects,
    ...(scopedBase && scopedBase.preserved.length > 0 ? { preservedRecords: scopedBase.preserved } : {}),
  });
  assertMetadataIndexParity(metadataIndex, carrierDecisions);

  const planBySource = indexInjectionPlansBySource(root, pipeline.injected);
  const inlinePlans = collectInlinePlans(root, subjects, byPath, planBySource);

  return {
    mode,
    root,
    authority,
    pipeline,
    subjects,
    carrierDecisions,
    metadataIndex,
    metadataIndexBase: scopedBase ? scopedBase.base : null,
    inlinePlans,
  };
}

export async function planCarrierOperationAsync(input: PlanCarrierOperationInput): Promise<CarrierOperationPlan> {
  const root = path.resolve(input.config.root);
  const pipeline = await runPipelineAsync({
    ...input.config,
    root,
    dryRun: true,
    localFiles: false,
    normalizeFilenames: false,
    writeInjectLog: false,
    persistOutputs: false,
  });
  return buildCarrierOperationPlan(input.mode, root, input.authority, pipeline);
}

export function metadataIndexDrift(plan: CarrierOperationPlan): CheckDrift | null {
  const target = path.join(plan.root, METADATA_INDEX_RELATIVE_PATH);
  if (!fs.existsSync(target)) {
    return {
      path: METADATA_INDEX_RELATIVE_PATH,
      kind: "missing",
      message: "canonical central metadata index is missing",
      expectedHash: plan.metadataIndex.sha256,
    };
  }
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return {
      path: METADATA_INDEX_RELATIVE_PATH,
      kind: "conflict",
      message: "canonical central metadata index is not a regular file",
      expectedHash: plan.metadataIndex.sha256,
    };
  }
  if (plan.metadataIndexBase?.unmergeableReason) {
    return {
      path: METADATA_INDEX_RELATIVE_PATH,
      kind: "conflict",
      message: plan.metadataIndexBase.unmergeableReason,
      expectedHash: plan.metadataIndex.sha256,
      ...(plan.metadataIndexBase.sha256 ? { actualHash: plan.metadataIndexBase.sha256 } : {}),
    };
  }
  const actualBytes = fs.readFileSync(target, "utf8");
  const actualHash = sha256Text(actualBytes);
  if (actualBytes === plan.metadataIndex.bytes) return null;
  return {
    path: METADATA_INDEX_RELATIVE_PATH,
    kind: "stale",
    message: "canonical central metadata index differs from expected bytes",
    expectedHash: plan.metadataIndex.sha256,
    actualHash,
  };
}

/**
 * Drift for decisions the repository's own authority asked for but cannot receive.
 *
 * A malformed header under an explicit `inline_allow` authorization is reported here, not
 * repaired: preserving the file's bytes outranks satisfying the authorization.
 */
export function unsatisfiedAuthorizationDrift(plan: CarrierOperationPlan): CheckDrift[] {
  return plan.carrierDecisions
    .filter((decision) => decision.unsatisfiedInlineAuthorization === true)
    .map((decision) => ({
      path: decision.path,
      kind: "conflict" as const,
      message: `inline metadata is explicitly authorized (${decision.authorityRule ?? "inline_allow"}) but the existing frontmatter cannot be patched safely: ${decision.reason}`,
    }));
}

export function inlinePlanDrift(plan: CarrierOperationPlan): CheckDrift[] {
  const drift: CheckDrift[] = [];
  for (const record of plan.inlinePlans) {
    if (record.wouldChange === false) continue;
    const source = relativePath(plan.root, record.sourcePath);
    drift.push({
      path: source,
      kind: record.targetExists ? "stale" : "missing",
      message: record.targetExists
        ? "authorized inline metadata differs from canonical expected bytes"
        : "authorized inline metadata target is missing",
      expectedHash: record.expectedContentHash,
      actualHash: record.actualContentHash,
    });
  }
  return drift;
}
