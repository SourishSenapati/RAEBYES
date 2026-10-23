import { VarianceCheckOptions, VarianceCheckResult } from './types.js';

export class VarianceGuard {
  /**
   * Flattens any nested numerical structure (1D, 2D, 3D tensor or nested arrays)
   */
  public flattenNumbers(data: unknown): number[] {
    const numbers: number[] = [];
    const walk = (item: unknown) => {
      if (typeof item === 'number') {
        numbers.push(item);
      } else if (Array.isArray(item)) {
        for (const sub of item) {
          walk(sub);
        }
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        if (Array.isArray(obj.data)) {
          walk(obj.data);
        } else if (Array.isArray(obj.values)) {
          walk(obj.values);
        } else {
          for (const val of Object.values(obj)) {
            walk(val);
          }
        }
      }
    };
    walk(data);
    return numbers;
  }

  /**
   * Verifies variance, dimension integrity, and execution runtime
   */
  public verify(
    output: unknown,
    executionTimeMs?: number,
    options: VarianceCheckOptions = {}
  ): VarianceCheckResult {
    const violations: string[] = [];
    const minVariance = options.minVariance ?? 1e-9;
    const minTime = options.minExecutionTimeMs ?? 0;

    const values = this.flattenNumbers(output);

    if (values.length === 0) {
      violations.push('Output contains no numerical values or is an empty tensor/array');
      return {
        passed: false,
        mean: 0,
        variance: 0,
        stdDev: 0,
        executionTimeMs,
        violations
      };
    }

    // 1. Check for NaN or Infinity
    const hasNaN = values.some(v => Number.isNaN(v));
    const hasInf = values.some(v => !Number.isFinite(v));
    if (hasNaN) {
      violations.push('Numerical output contains NaN (unstable or uncomputed state)');
    }
    if (hasInf) {
      violations.push('Numerical output contains infinite values (diverged calculation)');
    }

    // 2. Check for all zeros if disallowed
    if (options.disallowZeros && values.every(v => v === 0)) {
      violations.push('Output is an uninitialized tensor (all zero values)');
    }

    // 3. Calculate Mean and Variance
    const n = values.length;
    const sum = values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
    const mean = sum / n;

    const sqDiffSum = values.reduce((acc, v) => {
      const diff = (Number.isFinite(v) ? v : 0) - mean;
      return acc + diff * diff;
    }, 0);
    const variance = sqDiffSum / n;
    const stdDev = Math.sqrt(variance);

    if (variance < minVariance) {
      violations.push(
        `Output variance (${variance.toExponential(4)}) is below threshold (${minVariance.toExponential(4)}). Flat or synthetic constant array detected.`
      );
    }

    // 4. Execution Time Check (Reject instant synthetic approximations)
    if (executionTimeMs !== undefined && minTime > 0) {
      if (executionTimeMs < minTime) {
        violations.push(
          `Execution time (${executionTimeMs}ms) was suspiciously instant (minimum required: ${minTime}ms). Synthetic shortcut detected.`
        );
      }
    }

    return {
      passed: violations.length === 0,
      mean,
      variance,
      stdDev,
      executionTimeMs,
      violations
    };
  }

  /**
   * Run custom invariant predicates against solver result
   */
  public evaluateInvariants<T>(
    result: T,
    invariants: Array<(res: T) => boolean | string>
  ): { passed: boolean; violations: string[] } {
    const violations: string[] = [];

    for (let i = 0; i < invariants.length; i++) {
      const inv = invariants[i];
      try {
        const check = inv(result);
        if (check === false) {
          violations.push(`Invariant #${i + 1} failed predicate assertion`);
        } else if (typeof check === 'string' && check.length > 0) {
          violations.push(`Invariant #${i + 1} failed: ${check}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        violations.push(`Invariant #${i + 1} threw exception during verification: ${msg}`);
      }
    }

    return {
      passed: violations.length === 0,
      violations
    };
  }
}
