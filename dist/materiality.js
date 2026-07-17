"use strict";
// materiality.ts — the single materiality-judgment contract with the LLM.
//
// The prompt wording and the yes/no reply parsing were previously duplicated
// verbatim in assist.ts and reconcile_fields.ts (finding ICC-003). Extracting them
// here makes the prompt/response contract single-sourced, so a change to the
// phrasing or expected reply format can never silently drift between call sites.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMaterialityPrompt = buildMaterialityPrompt;
exports.parseMaterialityReply = parseMaterialityReply;
/** Build the "is B materially better than A?" prompt for a field. */
function buildMaterialityPrompt(field, oldValue, newValue) {
    return `Field: ${field}\nA: ${JSON.stringify(oldValue)}\nB: ${JSON.stringify(newValue)}\nIs B materially more informative than A? Reply only: yes or no`;
}
/** Parse an adapter reply into a boolean. Null/undefined/non-"yes" → false. */
function parseMaterialityReply(reply) {
    return reply?.trim().toLowerCase().startsWith("yes") ?? false;
}
//# sourceMappingURL=materiality.js.map