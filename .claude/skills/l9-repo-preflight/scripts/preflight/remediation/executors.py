from __future__ import annotations
EXECUTORS={'patch_yaml_scalar','patch_shell_command','exception_record'}
def executor_registered(name:str)->bool:return name in EXECUTORS
