/**
 * Whole-run filesystem transaction for governed repository mutations.
 *
 * Every desired file is staged beside its final target, all original states are
 * compare-and-swap checked, and the set is committed with same-directory rename.
 * Backups remain available until post-commit validation succeeds. Any failure
 * rolls the complete set back in reverse order. A durable repository-relative
 * journal permits recovery after process interruption.
 */
export declare const FILE_TRANSACTION_SCHEMA: "l9.file-transaction/v1";
export declare const TRANSACTION_DIRECTORY: ".l9/.transactions";
export interface FileMutationIntent {
    /** Canonical repository-relative POSIX path. */
    path: string;
    /** State observed by the immutable plan. */
    expectedExists: boolean;
    /** Required when expectedExists is true. */
    expectedHash?: string;
    /** Complete replacement bytes. */
    bytes: string | Buffer;
    /** Optional mode for a newly-created target. Existing files preserve their mode. */
    mode?: number;
}
export type TransactionFaultStage = "journal_created" | "target_staged" | "before_commit" | "original_backed_up" | "target_committed" | "before_validation" | "validation_succeeded";
export interface TransactionFaultContext {
    stage: TransactionFaultStage;
    transactionId: string;
    path?: string;
    index?: number;
}
export interface ExecuteFileTransactionOptions {
    /** Called while backups still exist. Throwing triggers a complete rollback. */
    validate?: () => void;
    /** Test hook. Production callers normally omit this. */
    faultInjector?: (context: TransactionFaultContext) => void;
    /** Deterministic test override. */
    transactionId?: string;
}
export interface FileTransactionResult {
    transactionId: string | null;
    plannedWrites: number;
    committedWrites: number;
    changedPaths: string[];
    rolledBack: false;
    journalPath: string | null;
}
export interface RecoveryResult {
    /** Transactions rolled back to their journaled original state. */
    recovered: string[];
    /** Validated transactions whose interrupted cleanup was safely completed. */
    finalized: string[];
}
export declare function executeFileTransaction(rootInput: string, intents: readonly FileMutationIntent[], options?: ExecuteFileTransactionOptions): FileTransactionResult;
export declare function recoverPendingTransactions(rootInput: string): RecoveryResult;
