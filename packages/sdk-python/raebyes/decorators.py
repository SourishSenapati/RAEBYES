import time
import functools
import inspect
import os
import hashlib
from typing import Callable, Any, List, Optional
from .ledger import AntibodyLedger
from .variance import VarianceGuard
from .spasm import trigger_spasm

def enforced(
    func: Optional[Callable] = None,
    *,
    id: str = "INVARIANT-TASK",
    invariants: Optional[List[Callable[[Any], Any]]] = None,
    min_variance: Optional[float] = None,
    min_execution_time_ms: float = 0.0,
    disallow_zeros: bool = False,
    mode: str = "FATAL_SPASM",
    workspace_dir: Optional[str] = None
):
    ws = os.path.abspath(workspace_dir or os.getcwd())

    def decorator(fn: Callable) -> Callable:
        if inspect.iscoroutinefunction(fn):
            @functools.wraps(fn)
            async def async_wrapper(*args, **kwargs):
                _verify_ledger_safe(ws, mode)
                start_time = time.perf_counter()
                try:
                    res = await fn(*args, **kwargs)
                except Exception as e:
                    trigger_spasm(
                        mode,
                        f"Task {id} crashed with exception: {e}",
                        [str(e)],
                        ws,
                        layer="CIRCUIT_BREAKER",
                        details={"task": id, "error": str(e)}
                    )
                    raise

                elapsed_ms = (time.perf_counter() - start_time) * 1000.0
                _evaluate_invariants(
                    res,
                    id=id,
                    invariants=invariants or [],
                    min_variance=min_variance,
                    min_execution_time_ms=min_execution_time_ms,
                    disallow_zeros=disallow_zeros,
                    elapsed_ms=elapsed_ms,
                    mode=mode,
                    workspace_dir=ws
                )
                _record_receipt(ws, id, elapsed_ms)
                return res
            return async_wrapper
        else:
            @functools.wraps(fn)
            def sync_wrapper(*args, **kwargs):
                _verify_ledger_safe(ws, mode)
                start_time = time.perf_counter()
                try:
                    res = fn(*args, **kwargs)
                except Exception as e:
                    trigger_spasm(
                        mode,
                        f"Task {id} crashed with exception: {e}",
                        [str(e)],
                        ws,
                        layer="CIRCUIT_BREAKER",
                        details={"task": id, "error": str(e)}
                    )
                    raise

                elapsed_ms = (time.perf_counter() - start_time) * 1000.0
                _evaluate_invariants(
                    res,
                    id=id,
                    invariants=invariants or [],
                    min_variance=min_variance,
                    min_execution_time_ms=min_execution_time_ms,
                    disallow_zeros=disallow_zeros,
                    elapsed_ms=elapsed_ms,
                    mode=mode,
                    workspace_dir=ws
                )
                _record_receipt(ws, id, elapsed_ms)
                return res
            return sync_wrapper

    if func is not None:
        return decorator(func)
    return decorator

def _verify_ledger_safe(workspace_dir: str, mode: str):
    ledger_path = os.path.join(workspace_dir, ".raebyes", "antibodies.json")
    if os.path.exists(ledger_path):
        ledger = AntibodyLedger(workspace_dir)
        v = ledger.verify_ledger_integrity()
        if not v["valid"]:
            trigger_spasm(
                mode,
                f"Immutable failure ledger tampered at {v.get('broken_at')}: {v.get('reason')}",
                [v.get("reason", "Hash chain mismatch")],
                workspace_dir,
                layer="PRE_FLIGHT",
                details=v
            )

def _evaluate_invariants(
    result: Any,
    *,
    id: str,
    invariants: List[Callable[[Any], Any]],
    min_variance: Optional[float],
    min_execution_time_ms: float,
    disallow_zeros: bool,
    elapsed_ms: float,
    mode: str,
    workspace_dir: str
):
    violations: List[str] = []

    if min_execution_time_ms > 0 and elapsed_ms < min_execution_time_ms:
        violations.append(
            f"Execution time ({elapsed_ms:.1f}ms) was below required minimum ({min_execution_time_ms:.1f}ms). Instant approximation detected."
        )

    if min_variance is not None or disallow_zeros:
        v_check = VarianceGuard.verify(
            result,
            execution_time_ms=elapsed_ms,
            min_variance=min_variance if min_variance is not None else 1e-9,
            min_execution_time_ms=min_execution_time_ms,
            disallow_zeros=disallow_zeros
        )
        if not v_check["passed"]:
            violations.extend(v_check["violations"])

    for idx, inv in enumerate(invariants):
        try:
            check = inv(result)
            if check is False:
                violations.append(f"Invariant #{idx + 1} failed predicate assertion")
            elif isinstance(check, str) and len(check) > 0:
                violations.append(f"Invariant #{idx + 1} failed: {check}")
        except Exception as e:
            violations.append(f"Invariant #{idx + 1} threw exception during verification: {e}")

    if violations:
        trigger_spasm(
            mode,
            f"Invariant breach in task {id}",
            violations,
            workspace_dir,
            layer="VARIANCE",
            details={"task": id, "elapsed_ms": elapsed_ms, "violations": violations}
        )

def _record_receipt(workspace_dir: str, task_id: str, elapsed_ms: float):
    try:
        ledger = AntibodyLedger(workspace_dir)
        tree_hash = hashlib.sha256(f"{task_id}:{elapsed_ms}".encode("utf-8")).hexdigest()
        stdout_hash = hashlib.sha256(b"VERIFIED_SOLVER_OUTPUT").hexdigest()
        receipt = ledger.append_run_receipt(
            command=f"python_enforced:{task_id}",
            tree_hash=tree_hash,
            stdout_hash=stdout_hash,
            duration_ms=elapsed_ms,
            status="VERIFIED"
        )
        print(f"\nRAEBYES_PROOF[{receipt['run_id']}:{receipt['proof_hmac']}:VERIFIED]")
    except Exception:
        pass
