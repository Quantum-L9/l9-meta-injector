import { CorpusIndex } from "./corpus_analysis";
/**
 * Render the report.
 *
 * Section order, row order and wording are fixed, so re-rendering the same index
 * produces the same bytes. No timestamp is written: an observation instant is
 * operational, and putting one here would make every regeneration a diff.
 */
export declare function renderCorpusReport(index: CorpusIndex): string;
