"""folder-artifact mode adapter — copy-only, B->C, source immutable."""
import os, csv, shutil, datetime
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from core.scanner    import scan
from core.hasher     import sha256
from core.classifier import classify
from core.dedup_gate import check

TEXT_EXT = {".md",".txt",".yaml",".yml",".py",".json",".toml",".ini",".cfg",".rst"}

HEADER = """<!-- L9_ARTIFACT_META
schema: 1
mode: folder_artifact_consolidation
source_path: "{source_path}"
output_path: "{output_path}"
artifact_type: {artifact_type}
l9_domain: {l9_domain}
content_hash: "{content_hash}"
classification_confidence: {classification_confidence}
renamed_from: "{renamed_from}"
created_at: "{created_at}"
/L9_ARTIFACT_META -->
"""

def _manifest_gate(move_map):
    if not os.path.exists(move_map):
        sys.exit(f"[GATE] FAIL: {move_map} not found")
    with open(move_map) as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        if not r.get("source_path") or not r.get("content_hash") or not r.get("output_path"):
            sys.exit("[GATE] FAIL: incomplete row in move_map.csv")
    print(f"[GATE] PASS: {len(rows)} rows")
    return rows

def phase_b(source, output, threshold):
    rows = []
    man_dir = os.path.join(output, "00_MANIFESTS")
    os.makedirs(man_dir, exist_ok=True)
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
        if conf < threshold:
            dest = "99_CONFLICTS_AND_UNKNOWN/low-confidence"
        rows.append({
            "source_path": rel, "content_hash": h, "artifact_type": atype,
            "l9_domain": domain, "node_name": "unknown",
            "output_path": os.path.join(dest, os.path.basename(rel)),
            "renamed_from": os.path.basename(rel),
            "classification_confidence": f"{conf:.2f}",
            "path_confidence": f"{conf:.2f}", "dedup_status": "unknown",
        })
    rows, collisions = check(rows)
    cols = ["source_path","content_hash","artifact_type","l9_domain","node_name",
            "output_path","renamed_from","classification_confidence","path_confidence","dedup_status"]
    with open(os.path.join(man_dir,"move_map.csv"),"w",newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols); w.writeheader(); w.writerows(rows)
    with open(os.path.join(man_dir,"inventory.csv"),"w",newline="") as fh:
        w = csv.DictWriter(fh,fieldnames=["source_path","content_hash","dedup_status"])
        w.writeheader(); w.writerows({k:r[k] for k in ["source_path","content_hash","dedup_status"]} for r in rows)
    with open(os.path.join(man_dir,"conflicts.md"),"w") as fh:
        dupes=[r for r in rows if r["dedup_status"]=="duplicate"]
        fh.write("# Conflicts\n\n## Duplicates\n")
        for r in dupes: fh.write(f"- {r['source_path']} ({r['content_hash'][:12]})\n")
        if not dupes: fh.write("- none\n")
    print(f"[B] scanned {len(rows)} files -> {man_dir}/move_map.csv")
    return os.path.join(man_dir,"move_map.csv")

def phase_c(source, output, move_map_path, copy_files, inject):
    rows = _manifest_gate(move_map_path)
    now = datetime.datetime.utcnow().isoformat()
    copied = 0
    for r in rows:
        sp = os.path.join(source, r["source_path"])
        dp = os.path.join(output, r["output_path"])
        os.makedirs(os.path.dirname(dp), exist_ok=True)
        if not copy_files:
            continue
        shutil.copy2(sp, dp)
        copied += 1
        ext = os.path.splitext(dp)[1].lower()
        meta = dict(r, created_at=now)
        if inject and ext in TEXT_EXT:
            with open(dp,"r",encoding="utf-8",errors="ignore") as fh: body=fh.read()
            with open(dp,"w",encoding="utf-8") as fh: fh.write(HEADER.format(**meta)+"\n"+body)
        elif inject:
            with open(dp+".l9meta.yaml","w") as fh:
                for k,v in meta.items(): fh.write(f"{k}: {v}\n")
    with open(os.path.join(output,"00_MANIFESTS","dedup_report.csv"),"w",newline="") as fh:
        w=csv.writer(fh); w.writerow(["content_hash","dedup_status","source_path"])
        for r in rows: w.writerow([r["content_hash"],r["dedup_status"],r["source_path"]])
    with open(os.path.join(output,"CHANGE_SUMMARY.md"),"w") as fh:
        fh.write(f"# Change Summary\n\nCopied {copied} files. Source untouched.\n")
    print(f"[C] copied {copied} files -> {output} (source immutable)")

def run(a):
    truth = lambda x: str(x).lower()=="true"
    if a.phase=="B":
        phase_b(a.source, a.output, a.threshold)
    elif a.phase=="C":
        if not a.manifest: sys.exit("[C] FAIL: --from-manifest required")
        out = a.output or os.path.dirname(os.path.dirname(os.path.abspath(a.manifest)))
        phase_c(a.source, out, a.manifest, truth(a.copy_files), truth(a.inject_headers))
    else:
        sys.exit("[folder-artifact] FAIL: --phase B or C required")
