import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CircuitState, BreachRecord, ToolCallLog } from '../types.js';

export interface SpasmConfig {
  workspaceDir: string;
  providerFailureThreshold?: number; // default: 3
  providerWindowSec?: number;        // default: 60s
  probeTimeoutSec?: number;          // default: 30s
  toolFailureThreshold?: number;     // default: 3
  globalFailureThreshold?: number;   // default: 5
  toolCooldownSec?: number;          // default: 60s
  identicalCallHashLimit?: number;   // default: 3
  maxTurnBudgetUsd?: number;         // default: 0.50
  wallClockTimeoutSec?: number;      // default: 90s
}

export class SpasmCircuitBreaker {
  private providerState: CircuitState = 'CLOSED';
  private providerFailures: number[] = [];
  private providerOpenedAt = 0;

  private toolStates: Map<
    string,
    {
      state: CircuitState;
      failures: number[];
      openedAt: number;
      cooldownUntil: number;
    }
  > = new Map();

  private consecutiveGlobalFailures = 0;
  private callHistory: ToolCallLog[] = [];
  private goalAttempts: Map<string, number[]> = new Map();
  private turnStartTimestamp: number = Date.now();
  private turnCostUsd = 0;
  private isHalted = false;
  private breachCounter = 1;

  public readonly config: Required<SpasmConfig>;

  constructor(config: SpasmConfig) {
    this.config = {
      workspaceDir: path.resolve(config.workspaceDir),
      providerFailureThreshold: config.providerFailureThreshold ?? 3,
      providerWindowSec: config.providerWindowSec ?? 60,
      probeTimeoutSec: config.probeTimeoutSec ?? 30,
      toolFailureThreshold: config.toolFailureThreshold ?? 3,
      globalFailureThreshold: config.globalFailureThreshold ?? 5,
      toolCooldownSec: config.toolCooldownSec ?? 60,
      identicalCallHashLimit: config.identicalCallHashLimit ?? 3,
      maxTurnBudgetUsd: config.maxTurnBudgetUsd ?? 0.5,
      wallClockTimeoutSec: config.wallClockTimeoutSec ?? 90
    };
    this.initBreachCounter();
  }

  public isProviderHealthy(): boolean {
    const now = Date.now();
    if (this.providerState === 'OPEN') {
      if (now - this.providerOpenedAt > this.config.probeTimeoutSec * 1000) {
        this.providerState = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    return true;
  }

  public recordProviderSuccess(): void {
    if (this.providerState === 'HALF_OPEN') {
      this.providerState = 'CLOSED';
      this.providerFailures = [];
    }
  }

  public recordProviderFailure(): void {
    const now = Date.now();
    const windowMs = this.config.providerWindowSec * 1000;
    this.providerFailures = this.providerFailures.filter(t => now - t <= windowMs);
    this.providerFailures.push(now);

    if (this.providerFailures.length >= this.config.providerFailureThreshold) {
      this.providerState = 'OPEN';
      this.providerOpenedAt = now;
    }
  }

  public getProviderState(): CircuitState {
    this.isProviderHealthy();
    return this.providerState;
  }

  public isToolAllowed(toolName: string): { allowed: boolean; reason?: string } {
    if (this.isHalted) {
      return { allowed: false, reason: 'GLOBAL HALT: Global agent failure threshold exceeded. Paused for human review.' };
    }

    const now = Date.now();
    const tool = this.toolStates.get(toolName);
    if (!tool) return { allowed: true };

    if (tool.cooldownUntil > now) {
      const waitSec = Math.ceil((tool.cooldownUntil - now) / 1000);
      return {
        allowed: false,
        reason: `Tool '${toolName}' is in mutation cooldown. Wait ${waitSec}s.`
      };
    }

    if (tool.state === 'OPEN') {
      if (now - tool.openedAt > 300 * 1000) {
        tool.state = 'HALF_OPEN';
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Circuit for tool '${toolName}' is OPEN due to repeated failures.`
      };
    }

    return { allowed: true };
  }

  public recordToolSuccess(toolName: string): void {
    this.consecutiveGlobalFailures = 0;
    const tool = this.toolStates.get(toolName);
    if (tool && tool.state === 'HALF_OPEN') {
      tool.state = 'CLOSED';
      tool.failures = [];
    }
  }

  public recordToolFailure(toolName: string, error: string): void {
    const now = Date.now();
    this.consecutiveGlobalFailures++;

    let tool = this.toolStates.get(toolName);
    if (!tool) {
      tool = { state: 'CLOSED', failures: [], openedAt: 0, cooldownUntil: 0 };
      this.toolStates.set(toolName, tool);
    }

    tool.failures = tool.failures.filter(t => now - t <= 60 * 1000);
    tool.failures.push(now);
    tool.cooldownUntil = now + this.config.toolCooldownSec * 1000;

    if (tool.failures.length >= this.config.toolFailureThreshold) {
      tool.state = 'OPEN';
      tool.openedAt = now;
    }

    if (this.consecutiveGlobalFailures >= this.config.globalFailureThreshold) {
      this.isHalted = true;
      this.recordBreach('CIRCUIT_BREAKER', 'Global failure threshold reached (5 consecutive errors)', {
        toolName,
        error,
        consecutiveErrors: this.consecutiveGlobalFailures
      });
    }
  }

  public verifyToolInvocation(
    toolName: string,
    args: Record<string, unknown>,
    currentTreeHash?: string
  ): { allowed: boolean; violation?: string } {
    const now = Date.now();

    // Wall Clock Timeout
    const elapsedSec = (now - this.turnStartTimestamp) / 1000;
    if (elapsedSec > this.config.wallClockTimeoutSec) {
      const msg = `Wall-clock timeout breached (${elapsedSec.toFixed(1)}s > ${this.config.wallClockTimeoutSec}s)`;
      this.recordBreach('CIRCUIT_BREAKER', msg, { elapsedSec });
      return { allowed: false, violation: msg };
    }

    // Turn Budget
    if (this.turnCostUsd > this.config.maxTurnBudgetUsd) {
      const msg = `Turn budget ceiling exceeded ($${this.turnCostUsd.toFixed(2)} > $${this.config.maxTurnBudgetUsd.toFixed(2)})`;
      this.recordBreach('CIRCUIT_BREAKER', msg, { turnCostUsd: this.turnCostUsd });
      return { allowed: false, violation: msg };
    }

    // Hash toolName + canonicalized arguments
    const hash = crypto
      .createHash('sha256')
      .update(toolName + JSON.stringify(args, Object.keys(args || {}).sort()))
      .digest('hex');

    // 1. Check for 3x identical consecutive calls (ERR_IDENTICAL_LOOP)
    const recentIdentical = this.callHistory.slice(-this.config.identicalCallHashLimit + 1);
    if (
      recentIdentical.length === this.config.identicalCallHashLimit - 1 &&
      recentIdentical.every(entry => entry.argsHash === hash)
    ) {
      const msg = `ERR_IDENTICAL_LOOP: ${this.config.identicalCallHashLimit} identical invocations of '${toolName}' detected`;
      this.recordBreach('CIRCUIT_BREAKER', msg, { toolName, argsHash: hash });
      this.providerState = 'OPEN';
      this.providerOpenedAt = now;
      return { allowed: false, violation: msg };
    }

    // 2. Cyclic tool call pattern check (A -> B -> A -> B) without tree hash progression (ERR_CYCLIC_CONVERGENCE)
    if (this.callHistory.length >= 3) {
      const h = this.callHistory.map(c => c.toolName);
      const l = h.length;
      if (
        h[l - 1] === h[l - 3] &&
        h[l - 2] === toolName
      ) {
        // If git tree hash hasn't changed between cycles
        const lastTree = this.callHistory[l - 3].treeHash;
        if (!lastTree || lastTree === currentTreeHash) {
          const msg = `ERR_CYCLIC_CONVERGENCE: 2x cyclic tool pattern [${h[l - 1]} -> ${toolName}] without workspace progression`;
          this.recordBreach('CIRCUIT_BREAKER', msg, { sequence: [h[l - 1], toolName] });
          this.providerState = 'OPEN';
          this.providerOpenedAt = now;
          return { allowed: false, violation: msg };
        }
      }
    }

    this.callHistory.push({
      toolName,
      argsHash: hash,
      timestamp: now,
      treeHash: currentTreeHash
    });

    return { allowed: true };
  }

  public tripAll(reason = 'Manual Quarantine Override'): void {
    this.providerState = 'OPEN';
    this.providerOpenedAt = Date.now();
    this.isHalted = true;
    for (const [, tool] of this.toolStates) {
      tool.state = 'OPEN';
      tool.openedAt = Date.now();
    }
    this.recordBreach('CIRCUIT_BREAKER', `QUARANTINE ACTIVATED: ${reason}`, { manualTrip: true });
  }

  public resetAll(): void {
    this.providerState = 'CLOSED';
    this.providerFailures = [];
    this.isHalted = false;
    this.consecutiveGlobalFailures = 0;
    this.toolStates.clear();
    this.callHistory = [];
    this.turnStartTimestamp = Date.now();
    this.turnCostUsd = 0;
  }

  public getStatus() {
    return {
      providerState: this.providerState,
      isHalted: this.isHalted,
      consecutiveGlobalFailures: this.consecutiveGlobalFailures,
      turnCostUsd: this.turnCostUsd,
      elapsedTurnSec: (Date.now() - this.turnStartTimestamp) / 1000,
      tools: Array.from(this.toolStates.entries()).map(([name, data]) => ({
        toolName: name,
        state: data.state,
        failures: data.failures.length,
        inCooldown: data.cooldownUntil > Date.now()
      }))
    };
  }

  public recordBreach(
    layer: BreachRecord['layer'],
    reason: string,
    details: Record<string, unknown>
  ): BreachRecord {
    const breachId = `BREACH-${String(this.breachCounter++).padStart(4, '0')}`;
    const record: BreachRecord = {
      id: breachId,
      timestamp: new Date().toISOString(),
      reason,
      layer,
      details,
      fatalExitCode: 137
    };

    try {
      const trajDir = path.join(this.config.workspaceDir, '.raebyes', 'trajectories');
      if (!fs.existsSync(trajDir)) {
        fs.mkdirSync(trajDir, { recursive: true });
      }
      const breachFile = path.join(trajDir, `${breachId}.json`);
      fs.writeFileSync(breachFile, JSON.stringify(record, null, 2), 'utf-8');
    } catch {
      // Ignore write errors
    }

    return record;
  }

  private initBreachCounter(): void {
    try {
      const trajDir = path.join(this.config.workspaceDir, '.raebyes', 'trajectories');
      if (fs.existsSync(trajDir)) {
        const files = fs.readdirSync(trajDir).filter(f => f.startsWith('BREACH-') && f.endsWith('.json'));
        if (files.length > 0) {
          const numbers = files.map(f => {
            const m = f.match(/BREACH-(\d+)\.json/);
            return m ? parseInt(m[1], 10) : 0;
          });
          this.breachCounter = Math.max(...numbers) + 1;
        }
      }
    } catch {
      this.breachCounter = 1;
    }
  }
}
