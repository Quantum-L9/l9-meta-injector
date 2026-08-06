from __future__ import annotations
import shutil,sys
from pathlib import Path
def main():
 if len(sys.argv)!=2:raise SystemExit('usage: integrate-agent-a.py /path/to/auditor')
 auditor=Path(sys.argv[1]).resolve();addon=Path(__file__).resolve().parent;dest=auditor/'src'/'l9_auditor'/'node_typescript_addon'
 if dest.exists():raise SystemExit(f'destination already exists: {dest}')
 shutil.copytree(addon/'l9_node_ts',dest);print(dest);return 0
if __name__=='__main__':raise SystemExit(main())
