import { ArtifactType, SemanticArtifactClass } from "./schema";
import { InventoryArtifactType } from "./inventory";
/** Map a v3 SemanticArtifactClass onto the canonical coarse ArtifactType. */
export declare function semanticClassToArtifactType(cls: SemanticArtifactClass): ArtifactType;
/** Map an InventoryArtifactType onto the canonical coarse ArtifactType. */
export declare function inventoryTypeToArtifactType(t: InventoryArtifactType): ArtifactType;
