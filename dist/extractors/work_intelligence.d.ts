import { Extractor } from "../interpretation";
/**
 * What a document says it is called and how it is organized.
 *
 * Titles are emitted from every form the document uses, even when they disagree:
 * a frontmatter `title` and an `# H1` that differ is a fact about the document,
 * and picking a winner here would hide it.
 */
export declare const documentStructureExtractor: Extractor;
/**
 * Explicit work state: status, kind, tasks, milestones, and declared relations.
 *
 * Every rule here recognizes a form the document chose deliberately. Nothing is
 * read from a path, a filename, a modification time, or the absence of a signal.
 */
export declare const workIntelligenceExtractor: Extractor;
/** The vocabularies this profile recognizes, for documentation and reporting. */
export declare const WORK_STATUS_VOCABULARY: readonly string[];
export declare const WORK_KIND_VOCABULARY: readonly string[];
/** Every predicate the work-intelligence profile can emit, in code-point order. */
export declare const WORK_PREDICATES: readonly string[];
