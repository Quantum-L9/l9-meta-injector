#!/usr/bin/env python3
"""l9-consolidation single ingress — validates request and routes to mode adapter."""

import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

MODES = {"repo-pack", "folder-artifact"}


def validate(a):
    if a.mode not in MODES:
        sys.exit(f"[INGRESS] FAIL: unknown mode {a.mode!r}. Supported: {MODES}")
    if not a.source or not os.path.exists(a.source):
        sys.exit(f"[INGRESS] FAIL: source not found: {a.source!r}")
    if a.mode == "folder-artifact":
        if a.phase == "B" and not a.output:
            sys.exit("[INGRESS] FAIL: folder-artifact phase B requires --output")
        if a.phase == "B":
            src_abs = os.path.abspath(a.source)
            out_abs = os.path.abspath(a.output)
            if out_abs == src_abs or out_abs.startswith(src_abs + os.sep):
                sys.exit(
                    "[INGRESS] FAIL: output must not be inside source (mutation guard)"
                )
    print(f"[INGRESS] PASS mode={a.mode} source={a.source} dry_run={a.dry_run}")


def main():
    ap = argparse.ArgumentParser(description="l9-consolidation ingress")
    ap.add_argument("--mode", required=True, choices=list(MODES))
    ap.add_argument("--source", required=True)
    ap.add_argument("--output")
    ap.add_argument("--from-manifest", dest="manifest")
    ap.add_argument("--phase", choices=["B", "C"])
    ap.add_argument("--dry-run", default="true")
    ap.add_argument("--copy-files", default="false")
    ap.add_argument("--inject-headers", default="false")
    ap.add_argument("--threshold", type=float, default=0.60)
    a = ap.parse_args()
    validate(a)

    if a.mode == "repo-pack":
        from modes.repo_pack.injector import run as rp_run

        rp_run(a.source, a.dry_run.lower() == "true", a.threshold)
    else:
        from modes.folder_artifact.injector import run as fa_run

        fa_run(a)


if __name__ == "__main__":
    main()
