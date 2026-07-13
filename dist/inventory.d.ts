import { MetaSchema } from "./meta_schema";
export type InventoryArtifactType = "spec" | "code" | "schema" | "prompt" | "research_markdown" | "research_pdf" | "config" | "test" | "documentation" | "archive" | "folder" | "unknown";
export type SourceSystem = "dropbox" | "github" | "local" | "upload" | "unknown";
export interface InventoryRecord {
    artifact_id: string;
    source_system: SourceSystem;
    absolute_path: string | null;
    relative_path: string;
    file_name: string;
    extension: string | null;
    artifact_type: InventoryArtifactType;
    mime_type: string | null;
    size_bytes: number | null;
    modified_at: string | null;
    content_hash: string | null;
    parent_folder: string | null;
    depth: number;
    classification_confidence: number;
    evidence_excerpt: string | null;
    unknowns: string[];
    created_at: string | null;
    meta?: Record<string, unknown>;
}
export interface InventoryConfig {
    root: string;
    outDir: string;
    sourceSystem?: SourceSystem;
    dryRun?: boolean;
    injectHeaders?: boolean;
    folderSidecars?: boolean;
    hashMaxBytes?: number;
    ignore?: string[];
    now?: string;
    schema?: MetaSchema;
}
export interface DuplicateCluster {
    content_hash: string;
    count: number;
    wasted_bytes: number;
    keeper: string;
    paths: string[];
}
export interface InventoryResult {
    root: string;
    total: number;
    files: number;
    folders: number;
    typeDistribution: Record<string, number>;
    manifestPaths: {
        json: string;
        csv: string;
        md: string;
        duplicates: string;
    };
    duplicates: DuplicateCluster[];
    records: InventoryRecord[];
}
/** Load and validate a canonical meta-schema YAML file. */
export declare function loadMetaSchema(filePath: string): MetaSchema;
/** Group records by content_hash to surface duplicate clusters across the whole tree. */
export declare function buildDuplicateClusters(records: InventoryRecord[]): DuplicateCluster[];
interface Classification {
    type: InventoryArtifactType;
    confidence: number;
    evidence: string;
    unknowns: string[];
}
/** Deterministic, evidence-based classification into the ArtifactInventory taxonomy. */
export declare function classifyInventory(relPath: string, fileName: string, ext: string, isDir: boolean): Classification;
export declare function buildRecord(root: string, abs: string, isDir: boolean, cfg: Required<Pick<InventoryConfig, "sourceSystem" | "hashMaxBytes" | "now">>): InventoryRecord;
/** Run a non-destructive inventory over a filesystem root. */
export declare function inventoryTree(config: InventoryConfig): InventoryResult;
export {};
