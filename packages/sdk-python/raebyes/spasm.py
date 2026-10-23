import os
import sys
import json
import datetime
from typing import List, Dict, Any, Optional

class RaebyesSpasmError(Exception):
    def __init__(self, message: str, violations: Optional[List[str]] = None, breach_id: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.violations = violations or []
        self.breach_id = breach_id
        self.exit_code = 137

def record_breach(
    workspace_dir: str,
    layer: str,
    reason: str,
    details: Dict[str, Any]
) -> str:
    traj_dir = os.path.join(workspace_dir, ".raebyes", "trajectories")
    os.makedirs(traj_dir, exist_ok=True)

    breach_id = f"BREACH-{int(datetime.datetime.now().timestamp() * 1000) % 100000:04d}"
    record = {
        "id": breach_id,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "reason": reason,
        "layer": layer,
        "details": details,
        "fatalExitCode": 137
    }

    try:
        out_file = os.path.join(traj_dir, f"{breach_id}.json")
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2)
    except Exception:
        pass

    return breach_id

def trigger_spasm(
    mode: str,
    message: str,
    violations: List[str],
    workspace_dir: str,
    layer: str = "VARIANCE",
    details: Optional[Dict[str, Any]] = None
):
    breach_id = record_breach(workspace_dir, layer, message, details or {"violations": violations})

    if mode == "FATAL_SPASM":
        sys.stderr.write("\n===============================================================\n")
        sys.stderr.write(" [RAEBYES PHARYNGEAL SPASM] INVOLUNTARY REFLEX TRIGGERED\n")
        sys.stderr.write(f" Violation: {message}\n")
        if violations:
            sys.stderr.write(" Violations:\n")
            for v in violations:
                sys.stderr.write(f"   - {v}\n")
        sys.stderr.write(f" Logged Trajectory: .raebyes/trajectories/{breach_id}.json\n")
        sys.stderr.write(" SEVERING EXECUTION IMMEDIATELY. EXIT CODE 137.\n")
        sys.stderr.write("===============================================================\n\n")
        sys.stderr.flush()
        os._exit(137)
    elif mode == "THROW_ERROR":
        raise RaebyesSpasmError(message, violations, breach_id)
    else:
        sys.stderr.write(f"[RAEBYES WARNING] {message}\n")
