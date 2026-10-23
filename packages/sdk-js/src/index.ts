import * as fs from 'fs';
import * as path from 'path';
import { AntibodyLedger, AntibodyEntry } from './ledger.js';
import { HydrophobiaEngine } from '@raebyes/daemon';
import { VarianceGuard } from '@raebyes/daemon';
import { SpasmCircuitBreaker } from '@raebyes/daemon';

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
  ledgerPath?: string;
  mode?: 'FATAL_SPASM' | 'THROW_ERROR' | 'LOG_ONLY';
  workspaceDir?: string;
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
  private hydrophobia: HydrophobiaEngine;
  private varianceGuard: VarianceGuard;
  private breaker: SpasmCircuitBreaker;

  constructor(config: RaebyesConfig = {}) {
    this.mode = config.mode || 'FATAL_SPASM';
    this.workspaceDir = path.resolve(config.workspaceDir || process.cwd());
    const ledgerFile = config.ledgerPath || path.join(this.workspaceDir, '.raebyes', 'antibodies.json');
    this.ledger = new AntibodyLedger(ledgerFile);
    this.hydrophobia = new HydrophobiaEngine();
    this.varianceGuard = new VarianceGuard();
    this.breaker = new SpasmCircuitBreaker({ workspaceDir: this.workspaceDir });

    // Validate ledger integrity on startup
    if (fs.existsSync(ledgerFile)) {
      this.verifyLedger();
    }
  }

  /**
   * Verify the immutable hash chain of the antibody ledger
   */
  public verifyLedger(): boolean {
    const result = this.ledger.verify();
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

  /**
   * Wraps an asynchronous or synchronous solver/function with deterministic runtime enforcement
   */
  public enforced<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => Promise<TReturn> | TReturn,
    options: EnforcementInvariants<TReturn> = {}
  ): (...args: TArgs) => Promise<TReturn> {
    const id = options.id || 'INVARIANT-BLOCK';

    return async (...args: TArgs): Promise<TReturn> => {
      // 1. Verify ledger hasn't been modified in-flight
      this.verifyLedger();

      const startTime = Date.now();
      let result: TReturn;

      try {
        result = await fn(...args);
      } catch (err) {
        // If underlying function failed, record failure and rethrow
        this.breaker.recordBreach('CIRCUIT_BREAKER', `Wrapped task ${id} crashed with unhandled exception`, {
          error: err instanceof Error ? err.message : String(err)
        });
        throw err;
      }

      const executionTimeMs = Date.now() - startTime;
      const violations: string[] = [];

      // 2. Check Execution Time
      if (options.minExecutionTimeMs && executionTimeMs < options.minExecutionTimeMs) {
        violations.push(
          `Execution completed in ${executionTimeMs}ms, but expected minimum solver time is ${options.minExecutionTimeMs}ms (synthetic shortcut / trivial mock detected)`
        );
      }

      // 3. Numerical Variance Check
      if (options.minVariance !== undefined || options.disallowZeros) {
        const vCheck = this.varianceGuard.verify(result, executionTimeMs, {
          minVariance: options.minVariance,
          disallowZeros: options.disallowZeros
        });
        if (!vCheck.passed) {
          violations.push(...vCheck.violations);
        }
      }

      // 4. Custom Invariants
      if (options.invariants && options.invariants.length > 0) {
        const invCheck = this.varianceGuard.evaluateInvariants(result, options.invariants);
        if (!invCheck.passed) {
          violations.push(...invCheck.violations);
        }
      }

      // 5. Handle Violations
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

  /**
   * Scans a code buffer for synthetic shortcuts, static constants, or deleted assertions
   */
  public checkCode(code: string, filename = 'script.ts', originalCode?: string) {
    return this.hydrophobia.scanCode(code, filename, originalCode);
  }

  /**
   * Scans a git diff for deleted assertions
   */
  public checkDiff(diffText: string) {
    return this.hydrophobia.scanDiff(diffText);
  }

  /**
   * Replays historical antibodies against current workspace
   */
  public replayAntibodies(): { passed: boolean; replayed: number; failedAntibodies: AntibodyEntry[] } {
    const entries = this.ledger.readEntries();
    const failedAntibodies: AntibodyEntry[] = [];

    for (const entry of entries) {
      if (entry.assertionType === 'PREDICATE_JS') {
        try {
          // Evaluate deterministic JS predicate in isolated context
          const predicate = new Function('workspaceDir', `return (function() { ${entry.rejection_assertion} })(workspaceDir);`);
          const passed = Boolean(predicate(this.workspaceDir));
          if (!passed) {
            failedAntibodies.push(entry);
          }
        } catch {
          failedAntibodies.push(entry);
        }
      }
    }

    return {
      passed: failedAntibodies.length === 0,
      replayed: entries.length,
      failedAntibodies
    };
  }
}
