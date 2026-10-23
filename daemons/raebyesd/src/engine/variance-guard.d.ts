import { VarianceCheckOptions, VarianceCheckResult } from './types.js';
export declare class VarianceGuard {
    /**
     * Flattens any nested numerical structure (1D, 2D, 3D tensor or nested arrays)
     */
    flattenNumbers(data: unknown): number[];
    /**
     * Verifies variance, dimension integrity, and execution runtime
     */
    verify(output: unknown, executionTimeMs?: number, options?: VarianceCheckOptions): VarianceCheckResult;
    /**
     * Run custom invariant predicates against solver result
     */
    evaluateInvariants<T>(result: T, invariants: Array<(res: T) => boolean | string>): {
        passed: boolean;
        violations: string[];
    };
}
//# sourceMappingURL=variance-guard.d.ts.map