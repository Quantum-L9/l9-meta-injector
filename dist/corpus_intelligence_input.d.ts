import type { BuildCorpusIntelligenceInput } from "./corpus_intelligence";
import type { CorpusScanResult } from "./corpus_scan";
export interface CorpusIntelligenceInputOptions {
    /** Version of the producer emitting this packet. */
    producerVersion: string;
    createdAt: string;
}
/**
 * Translate one completed corpus run into the packet builder's input.
 *
 * Reads only what the run already produced. Nothing here re-opens a disk,
 * recomputes an analysis, or supplies a value the run did not carry.
 */
export declare function corpusIntelligenceInput(result: CorpusScanResult, options: CorpusIntelligenceInputOptions): BuildCorpusIntelligenceInput;
