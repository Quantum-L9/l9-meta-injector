/** Read-only carrier-aware expected-versus-actual drift evaluation. */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { listZipMembers } from "./archives";
import { isArchivePath, isExpandableArchivePath } from "./archive_formats";
import { BLOCKING_DISCOVERY_DISPOSITIONS, emptyDiscoverySummary } from "./discovery_contracts";
import { inspectRepositoryAuthority } from "./authority_scan";
import {
  CANONICAL_METADATA_WRITER,
  inlinePlanDrift,
  metadataIndexDrift,
  planCarrierOperationAsync,
  unsatisfiedAuthorizationDrift,
} from "./carrier_operation";
import type { CheckDrift, CheckResult, OperationResult } from "./operation_contracts";
import type { PipelineConfig } from "./schema";
import { compareCodePoints } from "./ordering";

export { CANONICAL_METADATA_WRITER } from "./carrier_operation";

export interface CheckConfig extends Omit<PipelineConfig, "dryRun"> {
  dryRun?: true;
}

interface SnapshotEntry {
  kind: "file" | "directory" | "symlink" | "other" | "unreadable";
  mode: number;
  size?: number;
  hash?: string;
  target?: string;
  /** Why the entry could not be observed; the discovery ledger reports it as blocking. */
  error?: string;
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
  const failure = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  const walk = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      // An unreadable directory is evidence the check must report, not a crash that
      // discards the report; discovery records the same path as a blocking disposition.
      snapshot.set(toPosix(path.relative(repositoryRoot, directory)) || ".", { kind: "unreadable", mode: 0, error: failure(error) });
      return;
    }
    entries.sort((a, b) => compareCodePoints(a.name, b.name));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const absolute = path.join(directory, entry.name);
      const relative = toPosix(path.relative(repositoryRoot, absolute));
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(absolute);
      } catch (error) {
        snapshot.set(relative, { kind: "unreadable", mode: 0, error: failure(error) });
        continue;
      }
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
    .sort(compareCodePoints)
    .filter((item) => JSON.stringify(before.get(item)) !== JSON.stringify(after.get(item)));
}

/**
 * Every archive the snapshot saw is reported as drift the governed check cannot resolve.
 * A ZIP is listed read-only; one that is hostile or unreadable is reported with the
 * reason rather than thrown, because a thrown check loses the whole report; a format the
 * product never expands is reported by name and never opened (ADR-036, ADR-047).
 */
function inspectArchivesWithoutExtraction(root: string, snapshot: RepositorySnapshot): CheckDrift[] {
  const drift: CheckDrift[] = [];
  for (const [relative, entry] of snapshot) {
    if (entry.kind !== "file" || !isArchivePath(relative)) continue;
    if (!isExpandableArchivePath(relative)) {
      drift.push({ path: relative, kind: "unsupported", message: "archive format is never expanded; governed check reports it and never opens it" });
      continue;
    }
    try {
      const members = listZipMembers(path.join(root, relative)).length;
      drift.push({ path: relative, kind: "unsupported", message: `archive inspected read-only (${members} member(s)); governed check never extracts archives` });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      drift.push({ path: relative, kind: "unsupported", message: `archive could not be inspected read-only: ${reason}` });
    }
  }
  return drift;
}

function authorityFailureResult(
  conflicts: CheckResult["authorityConflicts"],
  notices: CheckResult["authorityNotices"],
  archiveDrift: CheckDrift[],
): OperationResult {
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
    authorityNotices: notices,
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
    const archiveDrift = config.localFiles ? inspectArchivesWithoutExtraction(root, before) : [];
    if (inspection.conflicts.length > 0 || !inspection.authority) {
      return authorityFailureResult(inspection.conflicts, inspection.notices, archiveDrift);
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
      ...unsatisfiedAuthorizationDrift(plan),
      ...inlinePlanDrift(plan),
      ...(indexDrift ? [indexDrift] : []),
    ].sort((a, b) => compareCodePoints(`${a.path}:${a.kind}`, `${b.path}:${b.kind}`));

    const check: CheckResult = {
      passed: drift.length === 0,
      repositoryMutated: false,
      scanned: plan.pipeline.coverage.scanned,
      planned: plan.subjects.length,
      drift,
      authorityConflicts: [],
      authorityNotices: inspection.notices,
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
