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
    /** Optional mode for a newly-created target. Existing files preserve their permission bits. */
    mode?: number;
}
export type TransactionFaultStage = "journal_created" | "target_staged" | "before_commit" | "original_backed_up" | "target_committed" | "before_validation" | "validation_succeeded"
/** After `complete` is durable, before one entry's backup is deleted. */
 | "backup_cleanup"
/** After `complete` is durable, before the journal itself is deleted. */
 | "journal_cleanup";
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
export interface FileTransactionCleanupPending {
    /** Repository-relative journal left in state `complete` for recoverPendingTransactions to finalize. */
    journalPath: string;
    /** Repository-relative backups kept because they no longer hold the journaled original bytes. */
    retainedBackups: string[];
    /** Cleanup steps that failed after `complete`; none of them rolled the transaction back. */
    errors: string[];
}
export interface FileTransactionResult {
    transactionId: string | null;
    plannedWrites: number;
    committedWrites: number;
    changedPaths: string[];
    rolledBack: false;
    journalPath: string | null;
    /**
     * Present only when cleanup after the durable `complete` state did not finish.
     * The validated bytes are committed; the leftover journal is finalized (or, for a
     * retained backup, refused) by the next recoverPendingTransactions.
     */
    cleanupPending?: FileTransactionCleanupPending;
}
export interface RecoveryResult {
    /** Transactions rolled back to their journaled original state. */
    recovered: string[];
    /** Validated transactions whose interrupted cleanup was safely completed. */
    finalized: string[];
}
export declare function executeFileTransaction(rootInput: string, intents: readonly FileMutationIntent[], options?: ExecuteFileTransactionOptions): FileTransactionResult;
export declare function recoverPendingTransactions(rootInput: string): RecoveryResult;
