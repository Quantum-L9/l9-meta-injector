import { CorpusIndex } from "./corpus_analysis";
/**
 * Render a corpus index as Markdown.
 *
 * Deterministic: the same index always produces the same bytes. No timestamp is
 * emitted, because a generation time would make every run differ while nothing
 * about the corpus had changed.
 */
export declare function renderCorpusReport(index: CorpusIndex): string;
