export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export interface HydrophobiaViolation {
    file: string;
    line?: number;
    type: 'DELETED_TEST_ASSERTION' | 'STATIC_CONSTANT_RETURN' | 'EMPTY_FUNCTION_BODY' | 'SHORTCUT_MOCK_DETECTED' | 'LINEAR_APPROXIMATION_STUB';
    message: string;
    snippet?: string;
    severity: 'CRITICAL' | 'FATAL';
}
export interface HydrophobiaReport {
    passed: boolean;
    violations: HydrophobiaViolation[];
    scannedFiles: number;
    timestamp: string;
}
export interface VarianceCheckOptions {
    minVariance?: number;
    minExecutionTimeMs?: number;
    expectedDimensions?: number[];
    disallowZeros?: boolean;
}
export interface VarianceCheckResult {
    passed: boolean;
    mean: number;
    variance: number;
    stdDev: number;
    executionTimeMs?: number;
    dimensions?: number[];
    violations: string[];
}
export interface DependencyNode {
    path: string;
    dependencies: string[];
    dependents: string[];
    isHub: boolean;
    hubId?: string;
}
export interface CoreHubGraphReport {
    timestamp: string;
    totalFiles: number;
    hubs: Array<{
        hubId: string;
        path: string;
        dependentCount: number;
        dependents: string[];
    }>;
}
export interface ToolCallLog {
    toolName: string;
    argsHash: string;
    timestamp: number;
    error?: string;
    stateChanged?: boolean;
}
export interface BreachRecord {
    id: string;
    timestamp: string;
    agent?: string;
    reason: string;
    layer: 'PRE_FLIGHT' | 'HYDROPHOBIA' | 'VARIANCE' | 'CIRCUIT_BREAKER' | 'HUB_LOCK';
    details: Record<string, unknown>;
    fatalExitCode: number;
}
export interface AntibodyRule {
    id: string;
    timestamp: string;
    description: string;
    assertionType: 'PREDICATE_JS' | 'SHELL_EXIT' | 'AST_RULE' | 'VARIANCE_RULE';
    assertionPayload: string;
    prev_hash: string;
    hash: string;
}
//# sourceMappingURL=types.d.ts.map