import { StepLockState, StepLockReport } from '../types.js';

export class StepLockFSM {
  private state: StepLockState = 'REQUIRE_SLICE_READ';
  private activeFile?: string;
  private activeSymbol?: string;
  private isCortex4bMode: boolean;

  constructor(isCortex4bMode = true) {
    this.isCortex4bMode = isCortex4bMode;
  }

  public getState(): StepLockState {
    return this.state;
  }

  public getActiveContext(): { file?: string; symbol?: string } {
    return { file: this.activeFile, symbol: this.activeSymbol };
  }

  public setCortexMode(enabled: boolean): void {
    this.isCortex4bMode = enabled;
  }

  /**
   * Called when model executes `raebyes slice` or reads a micro-slice
   */
  public onSliceRead(filePath: string, symbolName: string): StepLockReport {
    this.activeFile = filePath.replace(/\\/g, '/');
    this.activeSymbol = symbolName;
    this.state = 'ALLOW_SINGLE_SYMBOL_PATCH';

    return {
      state: this.state,
      activeFile: this.activeFile,
      activeSymbol: this.activeSymbol,
      allowedAction: 'PATCH',
      message: `[STEP_LOCK_FSM] Symbol '${symbolName}' in ${filePath} armed for surgical single-function patch.`
    };
  }

  /**
   * Pre-patch gate: Blocks multi-file edits or patching without prior slice
   */
  public onPrePatch(filePath: string, modifiedSymbolsCount = 1): { allowed: boolean; reason?: string; report: StepLockReport } {
    const normalizedPath = filePath.replace(/\\/g, '/');

    if (!this.isCortex4bMode) {
      return {
        allowed: true,
        report: {
          state: this.state,
          allowedAction: 'PATCH',
          message: 'Standard mode: multi-step lock unconstrained.'
        }
      };
    }

    if (this.state === 'REQUIRE_SLICE_READ') {
      return {
        allowed: false,
        reason: 'ERR_STEP_LOCK_BLIND_PATCH: You are in Cortex-4B Exoskeleton mode. You must first call `raebyesctl slice <file> <symbol>` before editing code.',
        report: {
          state: this.state,
          allowedAction: 'SLICE',
          message: 'Patch blocked: You must slice the target symbol first.'
        }
      };
    }

    if (this.state === 'REQUIRE_EXEC_VERIFY') {
      return {
        allowed: false,
        reason: 'ERR_STEP_LOCK_VERIFY_PENDING: A patch is already pending verification. You cannot edit additional code until `raebyesctl exec` verifies the current mutation.',
        report: {
          state: this.state,
          activeFile: this.activeFile,
          activeSymbol: this.activeSymbol,
          allowedAction: 'VERIFY',
          message: 'Patch blocked: Execution verification required before next edit.'
        }
      };
    }

    if (modifiedSymbolsCount > 1) {
      return {
        allowed: false,
        reason: `ERR_SCOPE_OVERFLOW: Attempted to modify ${modifiedSymbolsCount} symbols in one turn. Cortex-4B permits modifying only 1 function at a time to prevent attention collapse.`,
        report: {
          state: this.state,
          activeFile: this.activeFile,
          activeSymbol: this.activeSymbol,
          allowedAction: 'PATCH',
          message: 'Scope overflow: Reduce edit to a single function.'
        }
      };
    }

    if (this.activeFile && normalizedPath !== this.activeFile && !normalizedPath.endsWith(this.activeFile)) {
      return {
        allowed: false,
        reason: `ERR_SCOPE_OVERFLOW: Cross-file edit refused. Active slice is in '${this.activeFile}', but patch targeted '${normalizedPath}'.`,
        report: {
          state: this.state,
          activeFile: this.activeFile,
          activeSymbol: this.activeSymbol,
          allowedAction: 'PATCH',
          message: `Cross-file patch refused. Target must match armed slice: ${this.activeFile}`
        }
      };
    }

    // Transition to verification state
    this.state = 'REQUIRE_EXEC_VERIFY';

    return {
      allowed: true,
      report: {
        state: this.state,
        activeFile: this.activeFile,
        activeSymbol: this.activeSymbol,
        allowedAction: 'VERIFY',
        message: '[STEP_LOCK_FSM] Patch accepted. Workspace now locked into REQUIRE_EXEC_VERIFY until tests or compiler pass.'
      }
    };
  }

  /**
   * Called when verification execution succeeds
   */
  public onExecVerified(): StepLockReport {
    this.state = 'REQUIRE_SLICE_READ';
    const finishedFile = this.activeFile;
    const finishedSymbol = this.activeSymbol;
    this.activeFile = undefined;
    this.activeSymbol = undefined;

    return {
      state: this.state,
      allowedAction: 'SLICE',
      message: `[STEP_LOCK_FSM] Verified passing run for ${finishedSymbol ?? 'target'} in ${finishedFile ?? 'workspace'}. Next micro-slice unlocked.`
    };
  }

  /**
   * Called when verification fails
   */
  public onExecFailed(errorMsg?: string): StepLockReport {
    // Keep in REQUIRE_EXEC_VERIFY or allow re-patch of same symbol
    this.state = 'ALLOW_SINGLE_SYMBOL_PATCH';

    return {
      state: this.state,
      activeFile: this.activeFile,
      activeSymbol: this.activeSymbol,
      allowedAction: 'PATCH',
      message: `[STEP_LOCK_FSM] Execution failed: ${errorMsg ?? 'errors detected'}. Allowed to re-patch active symbol '${this.activeSymbol}' to fix.`
    };
  }

  public reset(): void {
    this.state = 'REQUIRE_SLICE_READ';
    this.activeFile = undefined;
    this.activeSymbol = undefined;
  }
}
