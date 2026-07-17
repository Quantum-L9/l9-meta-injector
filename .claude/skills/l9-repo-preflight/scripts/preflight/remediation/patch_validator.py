from __future__ import annotations
import yaml
def validate_yaml_patch(text:str)->bool:
 try: yaml.safe_load(text); return True
 except Exception: return False
