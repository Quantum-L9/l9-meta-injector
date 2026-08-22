import { LocalArchivePolicy } from "./local_archive_policy";
import { ZipCentralEntry, ZipDirectory } from "./zip_reader";
/** Codes are stable identifiers; message text may change, codes may not. */
export type ArchiveHoldCode = "archive.path_absolute" | "archive.path_drive_absolute" | "archive.path_unc" | "archive.path_traversal" | "archive.path_nul" | "archive.path_escapes_root" | "archive.path_too_long" | "archive.path_empty" | "archive.entry_symlink" | "archive.entry_special" | "archive.entry_kind_unknown" | "archive.member_encrypted" | "archive.compression_unsupported" | "archive.duplicate_member" | "archive.case_collision" | "archive.unicode_collision" | "archive.member_count_exceeded" | "archive.member_too_large" | "archive.total_uncompressed_exceeded" | "archive.compression_ratio_exceeded" | "archive.nesting_depth_exceeded" | "archive.session_budget_exceeded" | "archive.extracted_bytes_exceeded" | "archive.member_integrity_failed" | "archive.format_unreadable" | "archive.format_not_expanded";
export interface ArchiveHold {
    code: ArchiveHoldCode;
    /** Member the violation was found on, when it is member-scoped. */
    memberPath?: string;
    message: string;
}
export interface PreflightMember {
    /** Canonical POSIX member path with no leading separator and no trailing slash. */
    canonicalPath: string;
    entry: ZipCentralEntry;
}
export interface ArchivePreflightResult {
    /** True when every rule passed and the archive may be expanded. */
    accepted: boolean;
    /** Violations that held the archive. Empty when accepted. */
    holds: ArchiveHold[];
    /** File members eligible for extraction, in central-directory order. */
    members: PreflightMember[];
    /** Directory entries, retained so an empty declared directory is still observable. */
    directories: string[];
    /** Sum of the declared uncompressed sizes of `members`. */
    declaredUncompressedBytes: number;
    /** Sum of the declared compressed sizes of `members`. */
    declaredCompressedBytes: number;
}
/**
 * Normalize a stored member name to a canonical POSIX path.
 *
 * Backslashes become separators first: a member named `..\escape.txt` is a
 * traversal on Windows, and treating the backslash as an ordinary filename
 * character would let it through the `..` check.
 *
 * `.` segments are dropped, because the canonical path decides both duplicate
 * detection and where a member is staged. Leaving them in would let `./a.txt`
 * and `a.txt` pass as two distinct members and then resolve to one staged file,
 * so the second would silently overwrite the first and the first member's
 * recorded digest would no longer describe the bytes on disk. `..` is preserved
 * so the traversal rule still sees it.
 */
export declare function canonicalMemberPath(name: string): string;
/**
 * Collision key for a member path.
 *
 * NFC folds canonically equivalent spellings together (a precomposed `é` and
 * `e` plus a combining acute are the same filename on macOS), and the case fold
 * folds `A.txt` onto `a.txt`. Two members sharing a key cannot both be
 * materialized faithfully on every filesystem, so the archive is held rather
 * than resolved by whichever one happened to be written last.
 */
export declare function memberCollisionKey(canonicalPath: string): string;
export interface ArchivePreflightInput {
    directory: ZipDirectory;
    policy: LocalArchivePolicy;
    /** Depth of this archive; the outermost archive is 0. */
    depth: number;
    /** Size of the archive file on disk, for the compression-ratio check. */
    archiveCompressedBytes: number;
}
/**
 * Judge an archive against every path, entry-type, encryption, compression,
 * collision and resource rule. Never touches the filesystem.
 */
export declare function preflightArchive(input: ArchivePreflightInput): ArchivePreflightResult;
