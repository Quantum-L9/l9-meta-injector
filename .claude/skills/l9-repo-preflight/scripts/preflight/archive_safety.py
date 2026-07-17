from __future__ import annotations
from pathlib import PurePosixPath

def validate_members(names:list[str],max_files:int=10000)->None:
 if len(names)>max_files: raise ValueError('archive_file_count_limit_exceeded')
 for name in names:
  p=PurePosixPath(name.replace('\\','/'))
  if p.is_absolute() or '..' in p.parts: raise ValueError(f'unsafe_archive_member:{name}')
