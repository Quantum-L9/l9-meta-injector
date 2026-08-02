/** Read-only carrier-aware expected-versus-actual drift evaluation. */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { findArchives, listZipMembers } from "./archives";
import { BLOCKING_DISCOVERY_DISPOSITIONS, emptyDiscoverySummary } from "./discovery_contracts";
import { inspectRepositoryAuthority } from "./authority_scan";
import {
  CANONICAL_METADATA_WRITER,
  inlinePlanDrift,
  metadataIndexDrift,
  planCarrierOperationAsync,
} from "./carrier_operation";
import type { CheckDrift, CheckResult, OperationResult } from "./operation_contracts";
import type { PipelineConfig } from "./schema";

export { CANONICAL_METADATA_WRITER } from "./carrier_operation";

export interface CheckConfig extends Omit<PipelineConfig, "dryRun"> {
  dryRun?: true;
}

interface SnapshotEntry {
  kind: "file" | "directory" | "symlink" | "other";
  mode: number;
  size?: number;
  hash?: string;
  target?: string;
}

type RepositorySnapshot = Map<string, SnapshotEntry>;

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function hashBytes(value: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function snapshotRepository(root: string): RepositorySnapshot {
  const repositoryRoot = path.resolve(root);
  const snapshot: RepositorySnapshot = new Map();
  const walk = (directory: string): void => {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const absolute = path.join(directory, entry.name);
      const relative = toPosix(path.relative(repositoryRoot, absolute));
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) snapshot.set(relative, { kind: "symlink", mode: stat.mode, target: fs.readlinkSync(absolute) });
      else if (stat.isDirectory()) { snapshot.set(relative, { kind: "directory", mode: stat.mode }); walk(absolute); }
      else if (stat.isFile()) snapshot.set(relative, { kind: "file", mode: stat.mode, size: stat.size, hash: hashBytes(fs.readFileSync(absolute)) });
      else snapshot.set(relative, { kind: "other", mode: stat.mode, size: stat.size });
    }
  };
  walk(repositoryRoot);
  return snapshot;
}

function snapshotDifferences(before: RepositorySnapshot, after: RepositorySnapshot): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((item) => JSON.stringify(before.get(item)) !== JSON.stringify(after.get(item)));
}

function inspectArchivesWithoutExtraction(root: string): CheckDrift[] {
  return findArchives(root).archives.map((archivePath) => ({
    path: toPosix(path.relative(root, archivePath)),
    kind: "unsupported" as const,
    message: `archive inspected read-only (${listZipMembers(archivePath).length} member(s)); governed check never extracts archives`,
  }));
}

function authorityFailureResult(conflicts: CheckResult["authorityConflicts"], archiveDrift: CheckDrift[]): OperationResult {
  const check: CheckResult = {
    passed: false,
    repositoryMutated: false,
    scanned: 0,
    planned: 0,
    drift: [
      ...archiveDrift,
      ...conflicts.map((item) => ({ path: item.path ?? ".", kind: "conflict" as const, message: item.message })),
    ],
    authorityConflicts: conflicts,
    carrierDecisions: [],
    discovery: emptyDiscoverySummary(),
  };
  return { mode: "check", passed: false, authorityRequired: true, authorityResolved: false, repositoryMutated: false, warnings: [], check };
}

export async function runCheckAsync(config: CheckConfig): Promise<OperationResult> {
  const root = path.resolve(config.root);
  const before = snapshotRepository(root);
  try {
    const inspection = inspectRepositoryAuthority(root, { expectedWriter: { repository: CANONICAL_METADATA_WRITER } });
    const archiveDrift = config.localFiles ? inspectArchivesWithoutExtraction(root) : [];
    if (inspection.conflicts.length > 0 || !inspection.authority) {
      return authorityFailureResult(inspection.conflicts, archiveDrift);
    }

    const warnings: string[] = [];
    const deterministicDrift: CheckDrift[] = [...archiveDrift];
    if (config.llmEnabled) {
      warnings.push("LLM assistance is disabled in check mode because expected state must be deterministic");
      deterministicDrift.push({ path: ".", kind: "unsupported", message: "check cannot prove expected state while LLM assistance is requested" });
    }

    const plan = await planCarrierOperationAsync({
      mode: "check",
      authority: inspection.authority,
      config: {
        ...config,
        root,
        dryRun: true,
        llmEnabled: false,
        localFiles: false,
        normalizeFilenames: false,
        writeInjectLog: false,
        persistOutputs: false,
      },
    });

    const discoveryDrift: CheckDrift[] = plan.pipeline.coverage.discovery.entries
      .filter((entry) => BLOCKING_DISCOVERY_DISPOSITIONS.has(entry.disposition))
      .map((entry) => ({ path: entry.path, kind: "unsupported" as const, message: `discovery ${entry.disposition}: ${entry.reason}` }));
    const indexDrift = metadataIndexDrift(plan);
    const drift = [
      ...deterministicDrift,
      ...discoveryDrift,
      ...inlinePlanDrift(plan),
      ...(indexDrift ? [indexDrift] : []),
    ].sort((a, b) => `${a.path}:${a.kind}`.localeCompare(`${b.path}:${b.kind}`));

    const check: CheckResult = {
      passed: drift.length === 0,
      repositoryMutated: false,
      scanned: plan.pipeline.coverage.scanned,
      planned: plan.subjects.length,
      drift,
      authorityConflicts: [],
      carrierDecisions: plan.carrierDecisions,
      discovery: plan.pipeline.coverage.discovery,
    };
    return {
      mode: "check",
      passed: check.passed,
      authorityRequired: true,
      authorityResolved: true,
      repositoryMutated: false,
      warnings,
      check,
    };
  } finally {
    const changed = snapshotDifferences(before, snapshotRepository(root));
    if (changed.length > 0) {
      throw new Error(`CHECK_MUTATION_DETECTED: read-only check changed ${changed.length} repository path(s): ${changed.slice(0, 20).join(", ")}`);
    }
  }
}
