"""repo-pack mode adapter — in-place L9_META stamping (idempotent, catalog/delta)."""
import os, csv, datetime
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from core.scanner import scan
from core.hasher  import sha256
from core.classifier import classify
from core.dedup_gate import check

TEXT_EXT = {".md",".txt",".yaml",".yml",".py",".json",".toml",".ini",".cfg",".rst"}

L9_META_HEADER = """<!-- L9_META
l9_schema: 1
origin: {origin}
layer: docs
tags: []
owner: unknown
status: active
/L9_META -->
"""

def already_stamped(path):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            head = fh.read(500)
        return "L9_META" in head
    except OSError:
        return False

def run(source, dry_run, threshold):
    rows = []
    for rel, abs_path, ext in scan(source):
        h = sha256(abs_path)
        sample = ""
        if ext in TEXT_EXT:
            try:
                with open(abs_path,"r",encoding="utf-8",errors="ignore") as fh:
                    sample = fh.read(2000)
            except OSError:
                pass
        atype, domain, dest, conf = classify(rel, sample)
        rows.append({
            "source_path": rel, "content_hash": h, "artifact_type": atype,
            "l9_domain": domain, "node_name": "unknown",
            "output_path": dest + "/" + os.path.basename(rel),
            "renamed_from": os.path.basename(rel),
            "classification_confidence": f"{conf:.2f}",
            "path_confidence": f"{conf:.2f}", "dedup_status": "unknown",
        })
    rows, _ = check(rows)
    stamped = skipped = 0
    for r in rows:
        abs_path = os.path.join(source, r["source_path"])
        ext = os.path.splitext(abs_path)[1].lower()
        if ext not in TEXT_EXT or r["dedup_status"] == "duplicate":
            skipped += 1
            continue
        if already_stamped(abs_path):
            skipped += 1
            continue
        if not dry_run:
            with open(abs_path,"r",encoding="utf-8",errors="ignore") as fh:
                body = fh.read()
            header = L9_META_HEADER.format(origin=os.path.basename(source))
            with open(abs_path,"w",encoding="utf-8") as fh:
                fh.write(header + "\n" + body)
        stamped += 1
    print(f"[repo-pack] stamped={stamped} skipped={skipped} dry_run={dry_run}")
