"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CORPUS_PATH_SEPARATOR = exports.CORPUS_ROOTS_SCHEMA = void 0;
exports.corpusRootId = corpusRootId;
exports.corpusRootSnapshotId = corpusRootSnapshotId;
exports.defaultRootKey = defaultRootKey;
exports.corpusSnapshotId = corpusSnapshotId;
exports.corpusPath = corpusPath;
exports.splitCorpusPath = splitCorpusPath;
exports.virtualSourceId = virtualSourceId;
exports.parseRootArgument = parseRootArgument;
exports.readRootManifest = readRootManifest;
exports.bindCorpusRoots = bindCorpusRoots;
exports.rootIdentity = rootIdentity;
exports.resolveForContainment = resolveForContainment;
exports.containmentBoundary = containmentBoundary;
exports.isInsideContainer = isInsideContainer;
exports.assertOutsideRoots = assertOutsideRoots;
exports.corpusTextDigest = corpusTextDigest;
// corpus_roots.ts — several local roots read as one logical corpus.
//
// A real archive is not one folder. It is an old SSD, a backup volume and a
// directory of ZIPs, and the same document is often in all three. Analyzing each
// one separately answers the wrong question: the duplicate that matters is the
// one that spans the disks, and the project that matters is the one whose files
// are split across them.
//
// Two kinds of root identity live here, and conflating them is the mistake this
// comment exists to prevent:
//
//   root_snapshot_id   what the root contained on this run. Derived from the
//                      physical snapshot hash, so it changes the moment any byte
//                      under the root changes. It is what makes the corpus
//                      snapshot identity honest.
//
//   root_id            which root this is, across runs. Derived from the root's
//                      declared key — the operator's `--root PATH=NAME`, or the
//                      root's own final path segment. It has to survive a byte
//                      changing, or a second run could not tell an edited file
//                      from a deleted one and a new one.
//
// Neither one contains the mount point. `/Volumes/OldSSD` and
// `/mnt/recovered/OldSSD` are the same root: the drive letter, the volume prefix
// and the parent directories are operational, and they live where `observed_at`
// lives — the session manifest and the operator's terminal, never a semantic
// output.
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const ordering_1 = require("./ordering");
const repository_model_1 = require("./repository_model");
/** Schema of a roots manifest file accepted by `--root-manifest`. */
exports.CORPUS_ROOTS_SCHEMA = "l9.corpus-roots/v1";
/** Separator between a root label and a root-relative path in a corpus path. */
exports.CORPUS_PATH_SEPARATOR = "::";
/** Link hops followed before a chain is treated as unresolvable. */
const MAX_SYMLINK_HOPS = 64;
/** Root id of a declared key. Stable across runs, mounts and content changes. */
function corpusRootId(rootKey) {
    return (0, repository_model_1.stableId)("root", { root_key: rootKey });
}
/** Identity of one observation of a root. Changes whenever its bytes change. */
function corpusRootSnapshotId(physicalSnapshotHash) {
    return (0, repository_model_1.stableId)("root-snapshot", { physical_snapshot_hash: physicalSnapshotHash });
}
/**
 * The default key of a root path: its own final segment.
 *
 * `/Volumes/OldSSD` and `/mnt/recovered/OldSSD` both key as `OldSSD`, which is
 * the point — the segments above it describe where the drive is plugged in, and
 * that is not a fact about the corpus. An operator whose two disks share a final
 * segment declares distinct keys instead.
 */
function defaultRootKey(rootPath) {
    const absolute = path.resolve(rootPath);
    const base = path.basename(absolute);
    return base.length > 0 ? base : absolute;
}
/**
 * Identity of the corpus as a whole.
 *
 * `H(sorted(root source revisions), corpus profile)`. Sorted, so the order the
 * roots were typed in cannot change it; profile-bound, so a corpus analyzed under
 * different rules is a different snapshot even when the bytes are the same.
 */
function corpusSnapshotId(input) {
    return (0, repository_model_1.stableId)("corpus-snapshot", {
        corpus_profile_hash: input.corpusProfileHash,
        root_source_revisions: [...input.rootSourceRevisions].sort(ordering_1.compareCodePoints),
    });
}
/**
 * The corpus-scoped path of a root-relative path.
 *
 * `OldSSD::plans/deploy.md`. The root half is the declared key and the relative
 * half is exactly what acquisition recorded, so no mount point, parent directory
 * or drive letter can enter.
 */
function corpusPath(rootLabel, rootRelativePath) {
    return `${rootLabel}${exports.CORPUS_PATH_SEPARATOR}${rootRelativePath}`;
}
/** Split a corpus path back into its root label and root-relative half. */
function splitCorpusPath(value) {
    const index = value.indexOf(exports.CORPUS_PATH_SEPARATOR);
    if (index < 0)
        throw new Error(`corpus: '${value}' is not a corpus path`);
    return {
        rootLabel: value.slice(0, index),
        rootRelativePath: value.slice(index + exports.CORPUS_PATH_SEPARATOR.length),
    };
}
/**
 * Identity of one artifact inside the corpus.
 *
 * Binds the root id and the root-relative path, and nothing else. Two roots
 * holding an identical `README.md` produce two ids; one root read from two mount
 * points produces one; and the id survives the file's bytes changing, which is
 * what lets the next run report a change rather than a deletion and an addition.
 */
function virtualSourceId(rootId, rootRelativePath) {
    return (0, repository_model_1.stableId)("vsrc", { root_id: rootId, root_relative_path: rootRelativePath });
}
// ───────────────────────────── root specs ─────────────────────────────
/** Parse a `--root PATH` or `--root PATH=NAME` argument. */
function parseRootArgument(value) {
    const separator = value.lastIndexOf("=");
    // A path containing `=` and no name is ambiguous; the trailing `=NAME` form is
    // the one an operator can always fall back to.
    if (separator > 0 && separator < value.length - 1) {
        return { path: value.slice(0, separator), name: value.slice(separator + 1) };
    }
    return { path: value.replace(/=$/, "") };
}
/**
 * Read a roots manifest.
 *
 * Two forms are accepted, because both are things an operator already has: a JSON
 * document declaring `l9.corpus-roots/v1`, and a plain list of paths one per line
 * with `#` comments. Relative paths resolve against the manifest's own directory.
 */
function readRootManifest(manifestPath) {
    const absolute = path.resolve(manifestPath);
    const text = fs.readFileSync(absolute, "utf8");
    const base = path.dirname(absolute);
    const resolveSpec = (spec) => ({
        ...spec,
        path: path.resolve(base, spec.path),
    });
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) {
        const parsed = JSON.parse(trimmed);
        if (parsed.schema !== exports.CORPUS_ROOTS_SCHEMA) {
            throw new Error(`corpus: ${absolute} declares schema '${String(parsed.schema)}'; expected '${exports.CORPUS_ROOTS_SCHEMA}'`);
        }
        if (!Array.isArray(parsed.roots))
            throw new Error(`corpus: ${absolute} has no 'roots' array`);
        return parsed.roots.map((entry, index) => {
            if (typeof entry === "string")
                return resolveSpec({ path: entry });
            if (entry === null || typeof entry !== "object") {
                throw new Error(`corpus: ${absolute} root #${index} is neither a path nor an object`);
            }
            const record = entry;
            if (typeof record.path !== "string" || record.path.length === 0) {
                throw new Error(`corpus: ${absolute} root #${index} has no 'path'`);
            }
            return resolveSpec({
                path: record.path,
                ...(typeof record.name === "string" && record.name.length > 0 ? { name: record.name } : {}),
            });
        });
    }
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => resolveSpec(parseRootArgument(line)));
}
/**
 * Order roots by identity and fold any that repeats one already bound.
 *
 * The same disk mounted twice is one root: keeping both would double every count
 * in the corpus and invent a duplicate cluster for every file on it, which is a
 * fact about the operator's mount table rather than about their work. Two roots
 * that share a key while holding different bytes are not that case, and are
 * refused rather than silently merged into a corpus that describes neither.
 */
function bindCorpusRoots(bindings) {
    const ordered = [...bindings].sort((a, b) => (0, ordering_1.compareCodePoints)(a.root_id, b.root_id) || (0, ordering_1.compareCodePoints)(a.absolute_path, b.absolute_path));
    const roots = [];
    const folded = [];
    const seen = new Map();
    for (const binding of ordered) {
        const existing = seen.get(binding.root_id);
        if (existing === undefined) {
            seen.set(binding.root_id, binding);
            roots.push(binding);
            continue;
        }
        if (existing.physical_snapshot_hash !== binding.physical_snapshot_hash) {
            throw new Error(`corpus: two roots declare the key '${binding.root_key}' but hold different content `
                + `(${existing.absolute_path} and ${binding.absolute_path}); `
                + "give each one a distinct key with --root PATH=NAME");
        }
        folded.push({
            root_id: binding.root_id,
            root_key: binding.root_key,
            absolute_path: binding.absolute_path,
            kept_absolute_path: existing.absolute_path,
        });
    }
    return { roots, folded };
}
/** The identity half of a binding, with every operational field dropped. */
function rootIdentity(binding) {
    return {
        root_id: binding.root_id,
        root_key: binding.root_key,
        root_label: binding.root_label,
        root_snapshot_id: binding.root_snapshot_id,
        source_kind: binding.source_kind,
        source_revision: binding.source_revision,
        physical_snapshot_hash: binding.physical_snapshot_hash,
    };
}
/**
 * The path a write to `target` would actually land on.
 *
 * `path.resolve` normalizes `..` and `.` and stops there, which is not enough to
 * decide containment: a symlink at `/tmp/out` pointing into an observed root
 * resolves to `/tmp/out` lexically and to the root in fact, and a check that only
 * looked at the former would approve writes straight into the tree this package
 * promises not to touch.
 *
 * The nearest existing ancestor is resolved through `realpath` and the
 * not-yet-existing remainder is re-appended, so a target that has not been
 * created yet is still judged by where it would be created.
 */
function resolveForContainment(target) {
    const missing = [];
    const rejoin = (base) => missing.length === 0 ? base : path.join(base, ...[...missing].reverse());
    let cursor = path.resolve(target);
    let hops = 0;
    for (;;) {
        try {
            return rejoin(fs.realpathSync(cursor));
        }
        catch {
            // Not fully present. Either this component is a link that does not resolve,
            // or it does not exist at all.
        }
        // A dangling symlink is the case that matters: `--out` pointing at a
        // directory that does not exist *yet*, inside a tree this run is observing.
        // `realpath` refuses it, so the link is read directly.
        let linkTarget = null;
        try {
            if (fs.lstatSync(cursor).isSymbolicLink())
                linkTarget = fs.readlinkSync(cursor);
        }
        catch {
            // Not a link, or unreadable; fall through to walking up.
        }
        if (linkTarget !== null && hops < MAX_SYMLINK_HOPS) {
            hops += 1;
            cursor = path.resolve(path.dirname(cursor), linkTarget);
            continue;
        }
        const parent = path.dirname(cursor);
        // The filesystem root itself could not be resolved, or a link chain is longer
        // than any legitimate one: nothing better than the lexical answer is
        // available, and it is the conservative one to compare against.
        if (parent === cursor)
            return rejoin(cursor);
        missing.push(path.basename(cursor));
        cursor = parent;
    }
}
/**
 * The directory an observed root's outputs must stay out of.
 *
 * A root that is a file protects its parent directory, because that is where a
 * sibling write would land.
 */
function containmentBoundary(rootPath) {
    const resolved = resolveForContainment(rootPath);
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
        ? resolved
        : path.dirname(resolved);
}
/** True when `target` is `container` or lies beneath it, both already resolved. */
function isInsideContainer(container, target) {
    return target === container || target.startsWith(container + path.sep);
}
/**
 * Refuse a path that lies inside any observed root.
 *
 * Used for every writable location the corpus layer owns — the cache, the session
 * manifest, the projections. Writing under an observed root would mutate what was
 * just observed and make the next run read this run's output as user content.
 *
 * Both sides are resolved through `realpath` first. Comparing lexical paths would
 * let a symlink walk straight through this check.
 */
function assertOutsideRoots(target, rootPaths, what) {
    const resolvedTarget = resolveForContainment(target);
    for (const rootPath of rootPaths) {
        if (isInsideContainer(containmentBoundary(rootPath), resolvedTarget)) {
            throw new Error(`corpus: refusing to write ${what} inside an observed root: ${resolvedTarget}`
                + (resolvedTarget === path.resolve(target) ? "" : ` (reached through ${path.resolve(target)})`));
        }
    }
    return resolvedTarget;
}
/** Digest of a text payload, used by callers that need a profile hash. */
function corpusTextDigest(value) {
    return (0, repository_model_1.sha256TextPrefixed)(value);
}
//# sourceMappingURL=corpus_roots.js.map