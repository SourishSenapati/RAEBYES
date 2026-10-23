import { BreakerState, BreachRecord } from './types.js';
export interface SpasmConfig {
    workspaceDir: string;
    providerFailureThreshold?: number;
    providerWindowSec?: number;
    probeTimeoutSec?: number;
    toolFailureThreshold?: number;
    globalFailureThreshold?: number;
    toolCooldownSec?: number;
    identicalCallHashLimit?: number;
    maxTurnBudgetUsd?: number;
    wallClockTimeoutSec?: number;
}
export declare class SpasmCircuitBreaker {
    private providerState;
    private providerFailures;
    private providerOpenedAt;
    private toolStates;
    private consecutiveGlobalFailures;
    private callHistory;
    private goalAttempts;
    private turnStartTimestamp;
    private turnCostUsd;
    private isHalted;
    private breachCounter;
    readonly config: Required<SpasmConfig>;
    constructor(config: SpasmConfig);
    isProviderHealthy(): boolean;
    recordProviderSuccess(): void;
    recordProviderFailure(): void;
    getProviderState(): BreakerState;
    isToolAllowed(toolName: string): {
        allowed: boolean;
        reason?: string;
    };
    recordToolSuccess(toolName: string): void;
    recordToolFailure(toolName: string, error: string): void;
    verifyToolInvocation(toolName: string, args: Record<string, unknown>): {
        allowed: boolean;
        violation?: string;
    };
    recordSemanticGoalAttempt(goal: string): {
        allowed: boolean;
        violation?: string;
    };
    addCost(usd: number): void;
    resetTurn(): void;
    tripAll(reason?: string): void;
    resetAll(): void;
    getStatus(): {
        providerState: BreakerState;
        isHalted: boolean;
        consecutiveGlobalFailures: number;
        turnCostUsd: number;
        elapsedTurnSec: number;
        tools: {
            toolName: string;
            state: BreakerState;
            failures: number;
            inCooldown: boolean;
        }[];
    };
    recordBreach(layer: BreachRecord['layer'], reason: string, details: Record<string, unknown>): BreachRecord;
    private initBreachCounter;
}
//# sourceMappingURL=spasm-breaker.d.ts.map