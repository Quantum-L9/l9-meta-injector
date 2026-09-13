export declare function parseMetaYaml(text: string): Record<string, unknown>;
/** Later sources win. Inventory clocks overwrite these after harvest. */
export declare function mergeHarvested(...layers: Record<string, unknown>[]): Record<string, unknown>;
export declare function harvestExistingMeta(abs: string, isDir: boolean): Record<string, unknown>;
