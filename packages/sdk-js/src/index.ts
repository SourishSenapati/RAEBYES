import * as fs from 'fs';
import * as path from 'path';
import {
  AntibodyLedger,
  HydrophobiaEngine,
  VarianceGuard,
  SpasmCircuitBreaker,
  TruthEnforcer,
  AntibodyEntry
} from '@raebyes/daemon';

export * from './ledger.js';

export class RaebyesSpasmError extends Error {
  public readonly id?: string;
  public readonly violations: string[];
  public readonly exitCode = 137;

  constructor(message: string, violations: string[] = [], id?: string) {
    super(message);
    this.name = 'RaebyesSpasmError';
    this.id = id;
    this.violations = violations;
  }
}

export class RaebyesTamperError extends Error {
  public readonly brokenAt?: string;

  constructor(message: string, brokenAt?: string) {
    super(message);
    this.name = 'RaebyesTamperError';
    this.brokenAt = brokenAt;
  }
}

export interface RaebyesConfig {
  workspaceDir?: string;
  mode?: 'FATAL_SPASM' | 'THROW_ERROR' | 'LOG_ONLY';
  socketPath?: string;
}

export interface EnforcementInvariants<T> {
  id?: string;
  invariants?: Array<(res: T) => boolean | string>;
  minExecutionTimeMs?: number;
  minVariance?: number;
  disallowZeros?: boolean;
}

export class Raebyes {
  public readonly mode: 'FATAL_SPASM' | 'THROW_ERROR' | 'LOG_ONLY';
  public readonly workspaceDir: string;
  public readonly ledger: AntibodyLedger;
  public readonly truthEnforcer: TruthEnforcer;
  private hydrophobia: HydrophobiaEngine;
  private varianceGuard: VarianceGuard;
  private breaker: SpasmCircuitBreaker;

  constructor(config: RaebyesConfig = {}) {
    this.mode = config.mode || 'FATAL_SPASM';
    this.workspaceDir = path.resolve(config.workspaceDir || process.cwd());
    this.ledger = new AntibodyLedger(this.workspaceDir);
    this.truthEnforcer = new TruthEnforcer(this.workspaceDir);
    this.hydrophobia = new HydrophobiaEngine();
    this.varianceGuard = new VarianceGuard();
    this.breaker = new SpasmCircuitBreaker({ workspaceDir: this.workspaceDir });

    if (fs.existsSync(this.ledger.getLedgerPath())) {
      this.verifyLedger();
    }
  }

  public verifyLedger(): boolean {
    const result = this.ledger.verifyLedgerIntegrity();
    if (!result.valid) {
      const msg = `[RAEBYES TAMPER DETECTION] Immutable ledger hash chain is broken at entry ${result.brokenAt}: ${result.reason}`;
      this.breaker.recordBreach('PRE_FLIGHT', msg, { brokenAt: result.brokenAt, reason: result.reason });

      if (this.mode === 'FATAL_SPASM') {
        console.error('\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        console.error(' [RAEBYES] FATAL SPASM: GOVERNANCE LEDGER TAMPER DETECTED');
        console.error(' ' + msg);
        console.error(' WORKSPACE IS FROZEN. SEVERING AGENT PROCESS IMMEDIATELY (137).');
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n');
        process.exit(137);
      } else {
        throw new RaebyesTamperError(msg, result.brokenAt);
      }
    }
    return true;
  }

  public enforced<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => Promise<TReturn> | TReturn,
    options: EnforcementInvariants<TReturn> = {}
  ): (...args: TArgs) => Promise<TReturn> {
    const id = options.id || 'INVARIANT-BLOCK';

    return async (...args: TArgs): Promise<TReturn> => {
      this.verifyLedger();

      const startTime = Date.now();
      let result: TReturn;

      try {
        result = await fn(...args);
      } catch (err) {
        this.breaker.recordBreach('CIRCUIT_BREAKER', `Wrapped task ${id} crashed with exception`, {
          error: err instanceof Error ? err.message : String(err)
        });
        throw err;
      }

      const executionTimeMs = Date.now() - startTime;
      const violations: string[] = [];

      if (options.minExecutionTimeMs && executionTimeMs < options.minExecutionTimeMs) {
        violations.push(
          `Execution completed in ${executionTimeMs}ms (minimum required: ${options.minExecutionTimeMs}ms). Fake instant solver detected.`
        );
      }

      if (options.minVariance !== undefined || options.disallowZeros) {
        const vCheck = this.varianceGuard.verify(result, executionTimeMs, {
          minVariance: options.minVariance,
          disallowZeros: options.disallowZeros
        });
        if (!vCheck.passed) {
          violations.push(...vCheck.violations);
        }
      }

      if (options.invariants && options.invariants.length > 0) {
        const invCheck = this.varianceGuard.evaluateInvariants(result, options.invariants);
        if (!invCheck.passed) {
          violations.push(...invCheck.violations);
        }
      }

      if (violations.length > 0) {
        const record = this.breaker.recordBreach('VARIANCE', `Violations during execution of ${id}`, {
          task: id,
          executionTimeMs,
          violations
        });

        const errorMsg = `[RAEBYES SPASM] Invariant breach in task ${id} (${record.id}):\n  - ${violations.join('\n  - ')}`;

        if (this.mode === 'FATAL_SPASM') {
          console.error('\n===============================================================');
          console.error(' [RAEBYES PHARYNGEAL SPASM] INVOLUNTARY REFLEX TRIGGERED');
          console.error(' ' + errorMsg);
          console.error(' SEVERING EXECUTION IMMEDIATELY. EXIT CODE 137.');
          console.error('===============================================================\n');
          process.exit(137);
        } else if (this.mode === 'THROW_ERROR') {
          throw new RaebyesSpasmError(errorMsg, violations, record.id);
        } else {
          console.warn(`[RAEBYES WARNING] ${errorMsg}`);
        }
      }

      return result;
    };
  }

  public checkCode(code: string, filename = 'script.ts', originalCode?: string) {
    const antibodies = this.ledger.readEntries();
    return this.hydrophobia.scanCode(code, filename, originalCode, antibodies);
  }

  public checkDiff(diffText: string) {
    const antibodies = this.ledger.readEntries();
    return this.hydrophobia.scanDiff(diffText, antibodies);
  }

  public replayAntibodies(): { passed: boolean; replayed: number; failedAntibodies: AntibodyEntry[] } {
    const entries = this.ledger.readEntries();
    const failedAntibodies: AntibodyEntry[] = [];

    for (const entry of entries) {
      try {
        const predicate = new Function('workspaceDir', `return (function() { ${entry.rejection_pattern} })(workspaceDir);`);
        const passed = Boolean(predicate(this.workspaceDir));
        if (!passed) {
          failedAntibodies.push(entry);
        }
      } catch {
        failedAntibodies.push(entry);
      }
    }

    return {
      passed: failedAntibodies.length === 0,
      replayed: entries.length,
      failedAntibodies
    };
  }
}
