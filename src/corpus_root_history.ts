// corpus_root_history.ts — whether "the same root as last time" is a claim worth making.
//
// A root's identity comes from its declared key. When the operator names it —
// `--root OldSSD=/Volumes/OldSSD`, or a corpus manifest — the key is a person's
// statement, and "this is the same root as last run" means what it says. When
// nobody names it, the key is the mount point's final path segment, and the same
// sentence is a guess: `/Volumes/Backup` and an unrelated `/mnt/usb/Backup`
// produce the same root id, and nothing in the bytes distinguishes them.
//
// A guess is a fine basis for looking at a disk once. It is a bad basis for
// history. Comparing against a previous snapshot, resuming a session, or reusing
// a hash because "that path had these bytes last time" all rest on continuity
// being real; if it is not, the diff describes changes that never happened, the
// resume adopts another disk's completions, and the incremental scan reports a
// hash nobody read for a file nobody looked at.
//
// This module is the one place that decides. It exists as one function rather
// than three because the diff path, the resume path and the incremental path
// would otherwise each grow their own nearly-identical rule, and the one nobody
// reads would be the one that drifted.
//
// It refuses by default and takes an explicit override. A warning would not do:
// a warning that scrolls past is indistinguishable from no warning, and the
// operator is exactly the person who knows whether two disks called `Backup` are
// the same disk.
import { compareCodePoints } from "./ordering";
import type { RootIdentityClass } from "./corpus_roots";

/** A longitudinal operation, named as the refusal will name it. */
export const LONGITUDINAL_OPERATIONS = [
  "previous-snapshot diff",
  "resume",
  "incremental hash reuse",
] as const;

export type LongitudinalOperation = (typeof LONGITUDINAL_OPERATIONS)[number];

/** One root as either side of a continuity claim knows it. */
export interface RootIdentityRecord {
  root_id: string;
  root_key: string;
  /**
   * How the key was chosen.
   *
   * Optional because a snapshot or session written before the class was recorded
   * says nothing about it. Absent is read as `inferred`: the weaker reading, and
   * the only honest one — a document that does not say the operator named the
   * root is not evidence that they did.
   */
  root_identity_class?: RootIdentityClass;
}

/** One root whose continuity this run would be asserting. */
export interface RootContinuityClaim {
  root_id: string;
  root_key: string;
  previous_identity_class: RootIdentityClass;
  current_identity_class: RootIdentityClass;
}

/** What the operator authorized, recorded where the run's provenance is recorded. */
export interface InferredRootHistoryOverride {
  enabled: boolean;
  /** Roots whose continuity rested on an inferred key. */
  affected_root_ids: string[];
  /** Operations the override was applied to, in code-point order. */
  operations: string[];
}

export interface LongitudinalAuthorization {
  /** Roots matched across the two observations, whatever their identity class. */
  matched_root_ids: string[];
  /** Of those, the ones whose continuity rests on an inferred key. */
  weak_claims: RootContinuityClaim[];
  /** True when a weak claim was allowed only because the operator said so. */
  override_used: boolean;
}

/**
 * Refusal to make a continuity claim the operator has not underwritten.
 *
 * Carries the roots rather than only a message so a caller can report several
 * without re-deriving them, and so a test can assert the reason rather than a
 * string.
 */
export class InferredRootHistoryError extends Error {
  readonly operation: LongitudinalOperation;
  readonly claims: RootContinuityClaim[];

  constructor(operation: LongitudinalOperation, claims: RootContinuityClaim[]) {
    super(refusalMessage(operation, claims));
    this.name = "InferredRootHistoryError";
    this.operation = operation;
    this.claims = claims;
  }
}

/** A document that does not say how its key was chosen did not have one declared. */
export function identityClassOf(record: RootIdentityRecord): RootIdentityClass {
  return record.root_identity_class ?? "inferred";
}

/**
 * The continuity claim between two observations of one root.
 *
 * Both sides must be declared. A root the operator named this run and did not
 * name last run is still only as good as the weaker side: the previous key was
 * a basename, so the thing being matched against may not be this root at all.
 */
function isWeak(claim: RootContinuityClaim): boolean {
  return claim.previous_identity_class !== "declared"
    || claim.current_identity_class !== "declared";
}

function refusalMessage(
  operation: LongitudinalOperation,
  claims: readonly RootContinuityClaim[],
): string {
  const roots = claims
    .map((claim) =>
      `'${claim.root_key}' (previously ${claim.previous_identity_class}, `
      + `now ${claim.current_identity_class})`)
    .join(", ");
  return (
    `corpus: refusing ${operation} for ${claims.length === 1 ? "root" : "roots"} ${roots}: `
    + "root continuity depends on an inferred basename identity, which two unrelated "
    + "directories can share. Name the root explicitly with --root <path>=<key> or a "
    + "corpus manifest. If you intentionally accept this weaker identity, pass "
    + "--allow-inferred-root-history."
  );
}

export interface AssertLongitudinalRootIdentityInput {
  operation: LongitudinalOperation;
  /** Roots as this run keyed them. */
  currentRoots: readonly RootIdentityRecord[];
  /** Roots as the snapshot or session being continued from keyed them. */
  previousRoots: readonly RootIdentityRecord[];
  /** The operator's explicit acceptance of a weaker identity. */
  allowInferredRootHistory: boolean;
}

/**
 * Decide whether this run may claim continuity with a previous observation.
 *
 * Only *matched* roots are considered. A root that appears on one side and not
 * the other makes no continuity claim — it was added or it was removed, and
 * neither statement depends on the key being trustworthy — so an added root
 * never forces an override the operator would have no way to reason about.
 *
 * Throws `InferredRootHistoryError` when a matched root's continuity rests on an
 * inferred key and the operator has not accepted that. Returns what was matched
 * and what was weak otherwise, so a caller can record the override it used.
 */
export function assertLongitudinalRootIdentityAuthorized(
  input: AssertLongitudinalRootIdentityInput,
): LongitudinalAuthorization {
  const previousById = new Map(input.previousRoots.map((root) => [root.root_id, root]));
  const claims: RootContinuityClaim[] = [];
  for (const current of input.currentRoots) {
    const previous = previousById.get(current.root_id);
    if (previous === undefined) continue;
    claims.push({
      root_id: current.root_id,
      root_key: current.root_key,
      previous_identity_class: identityClassOf(previous),
      current_identity_class: identityClassOf(current),
    });
  }
  claims.sort((a, b) => compareCodePoints(a.root_id, b.root_id));

  const weak = claims.filter(isWeak);
  if (weak.length > 0 && !input.allowInferredRootHistory) {
    throw new InferredRootHistoryError(input.operation, weak);
  }

  return {
    matched_root_ids: claims.map((claim) => claim.root_id),
    weak_claims: weak,
    override_used: weak.length > 0,
  };
}

/**
 * The provenance record for an override that was used.
 *
 * Null when no weak claim was made, so a run that needed nothing records nothing
 * — an `enabled: false` entry on every ordinary run would train a reader to skip
 * the field that matters.
 */
export function inferredRootHistoryOverride(
  authorizations: readonly { operation: LongitudinalOperation; result: LongitudinalAuthorization }[],
): InferredRootHistoryOverride | null {
  const rootIds = new Set<string>();
  const operations = new Set<string>();
  for (const entry of authorizations) {
    if (!entry.result.override_used) continue;
    operations.add(entry.operation);
    for (const claim of entry.result.weak_claims) rootIds.add(claim.root_id);
  }
  if (operations.size === 0) return null;
  return {
    enabled: true,
    affected_root_ids: [...rootIds].sort(compareCodePoints),
    operations: [...operations].sort(compareCodePoints),
  };
}

/** The caution a run states when it proceeded on an identity it was told to accept. */
export function inferredRootHistoryWarning(override: InferredRootHistoryOverride): string {
  return (
    `--allow-inferred-root-history was supplied: ${override.operations.join(", ")} `
    + `proceeded for root(s) ${override.affected_root_ids.join(", ")} on an inferred `
    + "basename identity. Continuity across runs is the operator's claim here, not this "
    + "tool's."
  );
}
