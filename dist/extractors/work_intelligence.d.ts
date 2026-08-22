import { Extractor } from "../interpretation";
/**
 * Title and heading structure, exactly as written.
 *
 * Every title form the document uses is emitted. Where two disagree the
 * disagreement is the finding — silently preferring frontmatter over the H1
 * would hide that the document contradicts itself.
 */
export declare const documentStructureExtractor: Extractor;
/**
 * Explicit work state: status, kind, tasks, milestones, and declared relations.
 *
 * Nothing here is inferred. Every assertion cites the line that states it, and a
 * document that declares nothing produces nothing rather than a default.
 */
export declare const workIntelligenceExtractor: Extractor;
/** The predicates these rules can emit. Documentation and report rendering read it. */
export declare const WORK_INTELLIGENCE_PREDICATES: readonly ["document.heading", "document.title", "work.blocked_by", "work.depends_on", "work.kind", "work.milestone", "work.references", "work.status", "work.superseded_by", "work.supersedes", "work.task.completed", "work.task.open"];
export declare const WORK_STATUS_VOCABULARY: readonly string[];
export declare const WORK_KIND_VOCABULARY: readonly string[];
