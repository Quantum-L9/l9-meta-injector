"""Shared dedup gate — detect duplicate hashes and output_path collisions."""


def check(rows):
    """
    rows: list of dicts with content_hash and output_path.
    Returns rows with dedup_status filled in and a collisions list.
    """
    seen_hashes = {}
    seen_paths = {}
    collisions = []
    for r in rows:
        h = r["content_hash"]
        op = r["output_path"]
        if h in seen_hashes:
            r["dedup_status"] = "duplicate"
        elif op in seen_paths:
            r["dedup_status"] = "collision"
            collisions.append(op)
        else:
            r["dedup_status"] = "unique"
        seen_hashes.setdefault(h, r["source_path"])
        seen_paths.setdefault(op, r["source_path"])
    return rows, collisions
