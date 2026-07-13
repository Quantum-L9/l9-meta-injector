// placement_policy.ts — metadata placement compiler.
//
// Pure and advisory: given an artifact's source path (and optional body), it
// classifies the artifact and compiles a PlacementPlan describing *where* the
// artifact should live. It computes plans only — it performs NO file-system
// writes and mutates nothing. Downstream executors may act on a plan; this
// module never does.

import * as path from "path";
import {
  classifyArtifact,
  placementHintFor,
  QUARANTINE_DIRECTORY,
} from "./artifact_class";
import { SemanticArtifactClass, ClassConfidence } from "./schema";

export interface PlacementOptions {
  /** Namespace stamped onto the plan. Default: "l9". */
  namespace?: string;
  /** Optional root prefixed onto every target path (repo-relative). */
  rootDir?: string;
  /**
   * Confidence at or below which an artifact is routed to the quarantine
   * directory instead of its class directory. Default: "low".
   */
  quarantineAtOrBelow?: ClassConfidence;
}

export interface PlacementPlan {
  sourcePath: string;
  artifactClass: SemanticArtifactClass;
  confidence: ClassConfidence;
  layer: string;
  namespace: string;
  targetDirectory: string;
  targetPath: string;
  quarantined: boolean;
  /** Always false: this compiler emits plans, it never writes. */
  writesRequired: false;
  rationale: string[];
}

const CONFIDENCE_RANK: Record<ClassConfidence, number> = { low: 0, medium: 1, high: 2 };
const DEFAULT_NAMESPACE = "l9";

/** POSIX-join and strip any leading "./" so target paths are stable. */
function joinPosix(...parts: string[]): string {
  const joined = path.posix.join(...parts.filter((p) => p && p !== "."));
  return joined.replace(/^\.\//, "");
}

/**
 * Compile a single {@link PlacementPlan}. Pure: depends only on its arguments,
 * writes nothing, never throws on well-formed input.
 */
export function compilePlacementPlan(
  sourcePath: string,
  body = "",
  opts: PlacementOptions = {}
): PlacementPlan {
  const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
  const threshold = opts.quarantineAtOrBelow ?? "low";
  const rootDir = opts.rootDir ?? "";

  const { artifactClass, confidence, signals } = classifyArtifact(sourcePath, body);
  const hint = placementHintFor(artifactClass);

  const quarantined =
    artifactClass === "unknown" || CONFIDENCE_RANK[confidence] <= CONFIDENCE_RANK[threshold];

  const baseDir = quarantined ? QUARANTINE_DIRECTORY : hint.directory;
  const targetDirectory = joinPosix(rootDir, baseDir);
  const fileName = path.posix.basename(sourcePath.replace(/\\/g, "/"));
  const targetPath = joinPosix(targetDirectory, fileName);

  const rationale = [
    `classified as "${artifactClass}" (confidence: ${confidence})`,
    signals.length ? `signals: ${signals.join(", ")}` : "no distinctive signals",
    quarantined
      ? `routed to quarantine "${QUARANTINE_DIRECTORY}" (at/below threshold "${threshold}")`
      : `mapped to "${hint.directory}" on the "${hint.layer}" layer`,
  ];

  return {
    sourcePath,
    artifactClass,
    confidence,
    layer: quarantined ? "quarantine" : hint.layer,
    namespace,
    targetDirectory,
    targetPath,
    quarantined,
    writesRequired: false,
    rationale,
  };
}

/**
 * Compile plans for a batch of artifacts. Order-preserving and pure; a
 * convenience wrapper over {@link compilePlacementPlan}.
 */
export function compilePlacementPlans(
  inputs: Array<{ sourcePath: string; body?: string }>,
  opts: PlacementOptions = {}
): PlacementPlan[] {
  return inputs.map((i) => compilePlacementPlan(i.sourcePath, i.body ?? "", opts));
}
