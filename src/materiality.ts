// materiality.ts — the single materiality-judgment contract with the LLM.
//
// The prompt wording and the yes/no reply parsing were previously duplicated
// verbatim in assist.ts and reconcile_fields.ts (finding ICC-003). Extracting them
// here makes the prompt/response contract single-sourced, so a change to the
// phrasing or expected reply format can never silently drift between call sites.

/** Build the "is B materially better than A?" prompt for a field. */
export function buildMaterialityPrompt(field: string, oldValue: unknown, newValue: unknown): string {
  return `Field: ${field}\nA: ${JSON.stringify(oldValue)}\nB: ${JSON.stringify(newValue)}\nIs B materially more informative than A? Reply only: yes or no`;
}

/** Parse an adapter reply into a boolean. Null/undefined/non-"yes" → false. */
export function parseMaterialityReply(reply: string | null | undefined): boolean {
  return reply?.trim().toLowerCase().startsWith("yes") ?? false;
}
