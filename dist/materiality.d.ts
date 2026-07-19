/** Build the "is B materially better than A?" prompt for a field. */
export declare function buildMaterialityPrompt(field: string, oldValue: unknown, newValue: unknown): string;
/** Parse an adapter reply into a boolean. Null/undefined/non-"yes" → false. */
export declare function parseMaterialityReply(reply: string | null | undefined): boolean;
