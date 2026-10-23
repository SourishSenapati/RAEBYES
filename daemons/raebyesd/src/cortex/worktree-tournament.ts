import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import { TournamentCandidate, TournamentResult, InvariantCheck } from '../types.js';
import { HydrophobiaEngine } from '../engine/hydrophobia.js';
import { VarianceGuard } from '../engine/variance-guard.js';
import { TruthEnforcer } from '../engine/truth-enforcer.js';
import { AntibodyLedger } from '../ledger.js';

export interface TournamentOptions {
  workspaceDir?: string;
  minVariance?: number;
  minExecutionTimeMs?: number;
  invariants?: InvariantCheck[];
}

export class WorktreeTournament {
  private workspaceDir: string;
  private hydrophobia: HydrophobiaEngine;
  private truthEnforcer: TruthEnforcer;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.hydrophobia = new HydrophobiaEngine();
    this.truthEnforcer = new TruthEnforcer(this.workspaceDir);
  }

  /**
   * Evaluates N candidate patches in parallel isolated sandboxes
   * Applies only the best passing candidate to the main tree and mints RUN-XXXX proof
   */
  public async runTournament(
    targetFilePath: string,
    candidatePatches: string[],
    verifyCommand: string,
    options: TournamentOptions = {}
  ): Promise<TournamentResult> {
    const fullTargetPath = path.isAbsolute(targetFilePath)
      ? targetFilePath
      : path.join(this.workspaceDir, targetFilePath);

    if (!fs.existsSync(fullTargetPath)) {
      throw new Error(`[TOURNAMENT_ERROR] Target file does not exist: ${targetFilePath}`);
    }

    const originalContent = fs.readFileSync(fullTargetPath, 'utf-8');
    const relativeTarget = path.relative(this.workspaceDir, fullTargetPath);

    const evaluatedCandidates: TournamentCandidate[] = [];

    const antibodies = new AntibodyLedger(this.workspaceDir).readEntries();

    for (let i = 0; i < candidatePatches.length; i++) {
      const candidateCode = candidatePatches[i];
      const candidateId = `CANDIDATE-${i + 1}`;

      // 1. Static Hydrophobia & Antibody Check
      const hydrophobiaReport = this.hydrophobia.scanCode(
        candidateCode,
        relativeTarget,
        originalContent,
        antibodies
      );

      if (!hydrophobiaReport.passed) {
        evaluatedCandidates.push({
          id: candidateId,
          patch: candidateCode,
          passedCompilation: false,
          passedAntibodies: false,
          passedInvariants: false,
          astDiffSize: Math.abs(candidateCode.length - originalContent.length),
          score: -1,
          error: `[HYDROPHOBIA_SPASM] Blocked by antibody/shortcut rule: ${hydrophobiaReport.violations.map((v: { message: string }) => v.message).join('; ')}`
        });
        continue;
      }

      // 2. Sandbox Verification in Isolated Temp Worktree
      const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), `raebyes-tourn-${candidateId}-`));
      let passedCompilation = false;
      let passedInvariants = true;
      let stdoutOutput = '';
      let errorMsg: string | undefined;

      try {
        // Apply candidate code to target file in sandbox
        const sandboxTarget = path.join(sandboxDir, relativeTarget);
        fs.mkdirSync(path.dirname(sandboxTarget), { recursive: true });
        fs.writeFileSync(sandboxTarget, candidateCode, 'utf-8');

        // Also copy or link test files and package.json if present
        this.mirrorSandboxContext(this.workspaceDir, sandboxDir, relativeTarget);

        const startTime = Date.now();
        stdoutOutput = child_process.execSync(verifyCommand, {
          cwd: sandboxDir,
          encoding: 'utf-8',
          timeout: 45_000,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        const durationMs = Date.now() - startTime;

        passedCompilation = true;

        // Check minExecutionTimeMs if requested
        if (options.minExecutionTimeMs && durationMs < options.minExecutionTimeMs) {
          passedInvariants = false;
          errorMsg = `Execution time too fast (${durationMs}ms < ${options.minExecutionTimeMs}ms)`;
        }

        // Check custom invariants against stdout or numerical arrays
        if (options.invariants && options.invariants.length > 0) {
          for (const inv of options.invariants) {
            try {
              const res = inv(stdoutOutput);
              if (!res) {
                passedInvariants = false;
                errorMsg = 'Custom invariant check failed on execution output';
                break;
              }
            } catch (err) {
              passedInvariants = false;
              errorMsg = `Invariant threw exception: ${err instanceof Error ? err.message : String(err)}`;
              break;
            }
          }
        }
      } catch (err) {
        passedCompilation = false;
        errorMsg = err instanceof Error ? err.message : String(err);
      } finally {
        try {
          fs.rmSync(sandboxDir, { recursive: true, force: true });
        } catch {
          // Ignore temp cleanup errors
        }
      }

      const diffSize = Math.abs(candidateCode.length - originalContent.length);
      const isWinnerCapable = passedCompilation && passedInvariants;
      const score = isWinnerCapable ? (10_000 - diffSize) : -1;

      evaluatedCandidates.push({
        id: candidateId,
        patch: candidateCode,
        passedCompilation,
        passedAntibodies: true,
        passedInvariants,
        astDiffSize: diffSize,
        score,
        error: errorMsg
      });
    }

    // Select Winner: highest positive score
    const viable = evaluatedCandidates.filter(c => c.score > 0);
    viable.sort((a, b) => b.score - a.score);

    if (viable.length > 0) {
      const winner = viable[0];

      // Atomically apply winning patch to working tree
      fs.writeFileSync(fullTargetPath, winner.patch, 'utf-8');

      // Mint execution receipt in .raebyes/runs.lock
      const receipt = this.truthEnforcer.recordPassingRun(
        verifyCommand,
        `TOURNAMENT_WINNER_${winner.id}`,
        150
      );

      return {
        winner,
        candidates: evaluatedCandidates,
        runReceipt: receipt,
        status: 'WON',
        applied: true
      };
    }

    return {
      candidates: evaluatedCandidates,
      status: 'ALL_FAILED',
      applied: false
    };
  }

  private mirrorSandboxContext(srcDir: string, destDir: string, excludeRelative: string): void {
    // Copy key project files (package.json, tsconfig, etc.)
    const essentialFiles = ['package.json', 'tsconfig.json', 'tsconfig.base.json', 'pyproject.toml'];
    for (const f of essentialFiles) {
      const src = path.join(srcDir, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(destDir, f));
      }
    }

    // Copy tests directory if present
    const testsSrc = path.join(srcDir, 'tests');
    if (fs.existsSync(testsSrc)) {
      this.copyDirRecursive(testsSrc, path.join(destDir, 'tests'));
    }

    // Copy node_modules symlink or junction if on Windows/POSIX
    const nodeModulesSrc = path.join(srcDir, 'node_modules');
    const nodeModulesDest = path.join(destDir, 'node_modules');
    if (fs.existsSync(nodeModulesSrc)) {
      try {
        fs.symlinkSync(nodeModulesSrc, nodeModulesDest, 'junction');
      } catch {
        // Fallback without symlink
      }
    }
  }

  private copyDirRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
