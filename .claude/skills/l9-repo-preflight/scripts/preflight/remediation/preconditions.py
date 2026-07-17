from __future__ import annotations
def validate(required,observed): return {k:bool(observed.get(k,False)) for k in required}
