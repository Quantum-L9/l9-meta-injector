from pathlib import Path
EXTENSIONS={'.py':'python','.js':'javascript','.jsx':'javascript','.mjs':'javascript','.cjs':'javascript','.ts':'typescript','.tsx':'typescript','.sh':'bash','.bash':'bash'}
EXCLUDED={'.git','.venv','node_modules','__pycache__','.pytest_cache','dist','build'}
def detect(path:Path)->str|None: return EXTENSIONS.get(path.suffix.lower())
def eligible(path:Path,repo:Path)->bool:
    try: parts=path.relative_to(repo).parts
    except ValueError: return False
    return not any(part in EXCLUDED for part in parts) and detect(path) is not None
