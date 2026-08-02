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
import { compileMetadataIndex, METADATA_INDEX_RELATIVE_PATH, type MetadataIndexCompilation } from "./metadata_index";
import { resolveCarrierDecisions, assertCarrierDecisionCoverage, type CarrierSubject } from "./mutation_policy";
import { runPipelineAsync, type PipelineMetadataSubject, type PipelineResult } from "./pipeline";
import type { InjectionRecord, PipelineConfig } from "./schema";

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

export function buildCarrierOperationPlan(
  mode: GovernedCarrierMode,
  rootInput: string,
  authority: AuthorityConfig,
  pipeline: PipelineResult,
): CarrierOperationPlan {
  const root = path.resolve(rootInput);
  const subjects = [...pipeline.metadataSubjects].sort((a, b) => a.path.localeCompare(b.path));
  const carrierSubjects: CarrierSubject[] = subjects.map(({ path: subjectPath, artifactType, strategy }) => ({
    path: subjectPath,
    artifactType,
    strategy,
  }));
  const carrierDecisions = resolveCarrierDecisions({ authority, mode, subjects: carrierSubjects });
  assertCarrierDecisionCoverage(carrierSubjects, carrierDecisions);
  const byPath = decisionMap(carrierDecisions);

  const metadataIndex = compileMetadataIndex({ authority, mode, subjects });
  if (metadataIndex.carrierDecisions.length !== carrierDecisions.length) {
    throw new Error("metadata index and carrier operation decision counts diverged");
  }
  for (let index = 0; index < carrierDecisions.length; index++) {
    if (JSON.stringify(metadataIndex.carrierDecisions[index]) !== JSON.stringify(carrierDecisions[index])) {
      throw new Error(`metadata index and carrier operation decisions diverged at ${carrierDecisions[index].path}`);
    }
  }

  const inlinePlans: InjectionRecord[] = [];
  const planBySource = new Map<string, InjectionRecord>();
  for (const record of pipeline.injected) {
    const source = relativePath(root, record.sourcePath);
    if (planBySource.has(source)) throw new Error(`duplicate pipeline injection plan for ${source}`);
    planBySource.set(source, record);
  }

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

  return {
    mode,
    root,
    authority,
    pipeline,
    subjects,
    carrierDecisions,
    metadataIndex,
    inlinePlans: inlinePlans.sort((a, b) => relativePath(root, a.sourcePath).localeCompare(relativePath(root, b.sourcePath))),
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
