#!/usr/bin/env python3
"""l9-folder-artifact-consolidation - B -> C pipeline (copy-only, source immutable).

Phase B (read-only): scan -> hash -> classify -> plan_paths -> dedup -> manifest.
Manifest gate validates B output.
Phase C (manifest-driven): copy -> inject headers / sidecars -> reports.
"""
import argparse, csv, hashlib, os, shutil, sys, datetime

TEXT_EXT = {".md", ".txt", ".yaml", ".yml", ".py", ".json", ".toml", ".ini", ".cfg"}

DOMAIN_HINTS = {
    "constellation": "01_ARCHITECTURE/constellation",
    "packet": "01_ARCHITECTURE/packet-envelope",
    "chassis": "01_ARCHITECTURE/chassis",
    "control-plane": "01_ARCHITECTURE/control-plane",
    "registration": "02_NODE_CONTRACTS/registration",
    "infrastructure": "04_INFRASTRUCTURE",
    "template": "05_TEMPLATES_AND_SKILLS/templates",
    "skill": "05_TEMPLATES_AND_SKILLS/skills",
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def classify(rel, text_sample):
    low = (rel + " " + text_sample).lower()
    for key, dest in DOMAIN_HINTS.items():
        if key in low:
            atype = ("infra" if "infrastructure" in dest else
                     "contract" if "CONTRACT" in dest.upper() else
                     "template" if "templates" in dest else
                     "skill" if "skills" in dest else "architecture")
            return atype, key, dest, 0.85
    return "unknown", "generic", "99_CONFLICTS_AND_UNKNOWN/low-confidence", 0.40


def phase_b(source, output, threshold):
    rows, seen = [], {}
    for root, _, names in os.walk(source):
        for name in names:
            if name.startswith("."):
                continue
            sp = os.path.join(root, name)
            rel = os.path.relpath(sp, source)
            ext = os.path.splitext(name)[1].lower()
            sample = ""
            if ext in TEXT_EXT:
                try:
                    with open(sp, "r", encoding="utf-8", errors="ignore") as fh:
                        sample = fh.read(2000)
                except OSError:
                    sample = ""
            h = sha256(sp)
            atype, domain, dest, conf = classify(rel, sample)
            if conf < threshold:
                dest = "99_CONFLICTS_AND_UNKNOWN/low-confidence"
            dedup = "duplicate" if h in seen else "unique"
            seen.setdefault(h, rel)
            out_path = os.path.join(dest, name)
            rows.append({
                "source_path": rel, "content_hash": h, "artifact_type": atype,
                "l9_domain": domain, "node_name": "unknown", "output_path": out_path,
                "renamed_from": name, "classification_confidence": f"{conf:.2f}",
                "path_confidence": f"{conf:.2f}", "dedup_status": dedup,
            })
    man_dir = os.path.join(output, "00_MANIFESTS")
    os.makedirs(man_dir, exist_ok=True)
    cols = ["source_path", "content_hash", "artifact_type", "l9_domain", "node_name",
            "output_path", "renamed_from", "classification_confidence",
            "path_confidence", "dedup_status"]
    with open(os.path.join(man_dir, "move_map.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    with open(os.path.join(man_dir, "inventory.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["source_path", "content_hash", "dedup_status"])
        w.writeheader()
        for r in rows:
            w.writerow({k: r[k] for k in ["source_path", "content_hash", "dedup_status"]})
    with open(os.path.join(man_dir, "conflicts.md"), "w") as fh:
        dupes = [r for r in rows if r["dedup_status"] == "duplicate"]
        fh.write("# Conflicts\n\n## Duplicates\n")
        for r in dupes:
            fh.write(f"- {r['source_path']} (hash {r['content_hash'][:12]})\n")
        if not dupes:
            fh.write("- none\n")
    print(f"[B] scanned {len(rows)} files -> {man_dir}/move_map.csv")
    return os.path.join(man_dir, "move_map.csv")


def manifest_gate(move_map):
    if not os.path.exists(move_map):
        sys.exit("[GATE] FAIL: move_map.csv missing")
    with open(move_map) as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        if not r["source_path"] or not r["content_hash"] or not r["output_path"]:
            sys.exit("[GATE] FAIL: incomplete row")
    print(f"[GATE] PASS: {len(rows)} rows validated")
    return rows


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


def phase_c(source, output, move_map, copy_files, inject):
    rows = manifest_gate(move_map)
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
        meta = dict(r, source_path=r["source_path"], created_at=now)
        if inject and ext in TEXT_EXT:
            with open(dp, "r", encoding="utf-8", errors="ignore") as fh:
                body = fh.read()
            with open(dp, "w", encoding="utf-8") as fh:
                fh.write(HEADER.format(**meta) + "\n" + body)
        elif inject:
            with open(dp + ".l9meta.yaml", "w") as fh:
                for k, v in meta.items():
                    fh.write(f"{k}: {v}\n")
    with open(os.path.join(output, "00_MANIFESTS", "dedup_report.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["content_hash", "dedup_status", "source_path"])
        for r in rows:
            w.writerow([r["content_hash"], r["dedup_status"], r["source_path"]])
    with open(os.path.join(output, "CHANGE_SUMMARY.md"), "w") as fh:
        fh.write(f"# Change Summary\n\nCopied {copied} files. Source untouched.\n")
    print(f"[C] copied {copied} files -> {output} (source immutable)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ingress", default="consolidate_request")
    ap.add_argument("--source")
    ap.add_argument("--output")
    ap.add_argument("--from-manifest", dest="manifest")
    ap.add_argument("--phase", choices=["B", "C"], required=True)
    ap.add_argument("--emit-manifest", default="true")
    ap.add_argument("--copy-files", default="false")
    ap.add_argument("--inject-headers", default="false")
    ap.add_argument("--threshold", type=float, default=0.60)
    a = ap.parse_args()
    truth = lambda x: str(x).lower() == "true"

    if a.phase == "B":
        if not a.source or not a.output:
            sys.exit("Phase B requires --source and --output")
        if os.path.abspath(a.output).startswith(os.path.abspath(a.source) + os.sep):
            sys.exit("FAIL: output nested inside source (would risk mutation)")
        phase_b(a.source, a.output, a.threshold)
    else:
        mm = a.manifest
        if not mm:
            sys.exit("Phase C requires --from-manifest")
        out = a.output or os.path.dirname(os.path.dirname(os.path.abspath(mm)))
        src = a.source
        if not src:
            sys.exit("Phase C requires --source for copy integrity")
        phase_c(src, out, mm, truth(a.copy_files), truth(a.inject_headers))


if __name__ == "__main__":
    main()
