import math
from typing import Any, List, Dict, Optional

class VarianceGuard:
    @staticmethod
    def flatten_numbers(data: Any) -> List[float]:
        numbers: List[float] = []

        def walk(item: Any):
            if isinstance(item, (int, float)) and not isinstance(item, bool):
                numbers.append(float(item))
            elif isinstance(item, (list, tuple)):
                for sub in item:
                    walk(sub)
            elif hasattr(item, "tolist") and callable(getattr(item, "tolist")):
                # PyTorch tensor or NumPy array
                try:
                    walk(item.tolist())
                except Exception:
                    pass
            elif isinstance(item, dict):
                for val in item.values():
                    walk(val)

        walk(data)
        return numbers

    @classmethod
    def verify(
        cls,
        output: Any,
        execution_time_ms: Optional[float] = None,
        min_variance: float = 1e-9,
        min_execution_time_ms: float = 0.0,
        disallow_zeros: bool = False
    ) -> Dict[str, Any]:
        violations: List[str] = []
        values = cls.flatten_numbers(output)

        if not values:
            violations.append("Output contains no numerical values or is an empty tensor/array")
            return {
                "passed": False,
                "mean": 0.0,
                "variance": 0.0,
                "std_dev": 0.0,
                "violations": violations
            }

        # Check for NaN / Infinity
        if any(math.isnan(v) for v in values):
            violations.append("Numerical output contains NaN (unstable or uncomputed state)")
        if any(math.isinf(v) for v in values):
            violations.append("Numerical output contains infinite values (diverged calculation)")

        # Check for all zeros
        if disallow_zeros and all(v == 0.0 for v in values):
            violations.append("Output is an uninitialized tensor (all zero values)")

        n = len(values)
        finite_vals = [v for v in values if math.isfinite(v)]
        if finite_vals:
            mean = sum(finite_vals) / len(finite_vals)
            sq_diffs = [(v - mean) ** 2 for v in finite_vals]
            variance = sum(sq_diffs) / len(finite_vals)
            std_dev = math.sqrt(variance)
        else:
            mean = 0.0
            variance = 0.0
            std_dev = 0.0

        if variance < min_variance:
            violations.append(
                f"Output variance ({variance:.4e}) is below threshold ({min_variance:.4e}). Flat or synthetic constant array detected."
            )

        if execution_time_ms is not None and min_execution_time_ms > 0:
            if execution_time_ms < min_execution_time_ms:
                violations.append(
                    f"Execution time ({execution_time_ms:.1f}ms) was suspiciously instant (minimum required: {min_execution_time_ms:.1f}ms). Synthetic approximation detected."
                )

        return {
            "passed": len(violations) == 0,
            "mean": mean,
            "variance": variance,
            "std_dev": std_dev,
            "execution_time_ms": execution_time_ms,
            "violations": violations
        }
