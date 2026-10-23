import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AntibodyLedger } from '../ledger.js';
import { SpasmCircuitBreaker } from './spasm-breaker.js';

export interface TurnVerificationResult {
  allowed: boolean;
  currentTreeHash: string;
  verifiedTreeHash?: string;
  latestRunId?: string;
  reason?: string;
}

export class TruthEnforcer {
  private workspaceDir: string;
  private ledger: AntibodyLedger;

  constructor(workspaceDir: string) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.ledger = new AntibodyLedger(this.workspaceDir);
  }

  /**
   * Computes deterministic SHA-256 hash of all tracked source files across the workspace
   */
  public computeWorkingTreeHash(): string {
    const files = this.collectSourceFiles(this.workspaceDir);
    // Sort paths for 100% deterministic ordering across OSes
    files.sort();

    const hasher = crypto.createHash('sha256');
    for (const file of files) {
      const relPath = path.relative(this.workspaceDir, file).replace(/\\/g, '/');
      try {
        const content = fs.readFileSync(file);
        hasher.update(`${relPath}:${content.length}:`);
        hasher.update(content);
      } catch {
        // Skip unreadable files
      }
    }

    return hasher.digest('hex');
  }

  /**
   * Verified run recorder: called when `raebyesctl exec -- <cmd>` completes with exit 0
   */
  public recordPassingRun(command: string, stdout: string, durationMs: number) {
    const treeHash = this.computeWorkingTreeHash();
    const stdoutHash = crypto.createHash('sha256').update(stdout, 'utf-8').digest('hex');

    const receipt = this.ledger.appendRunReceipt({
      command,
      tree_hash: treeHash,
      stdout_hash: stdoutHash,
      duration_ms: durationMs,
      status: 'VERIFIED'
    });

    return receipt;
  }

  /**
   * Stop-Hook Lie Detector: checks whether agent is permitted to finish its turn
   */
  public verifyTurn(breaker?: SpasmCircuitBreaker): TurnVerificationResult {
    // 1. Verify antibody ledger hash chain
    const ledgerVerif = this.ledger.verifyLedgerIntegrity();
    if (!ledgerVerif.valid) {
      return {
        allowed: false,
        currentTreeHash: '',
        reason: `CRITICAL: Failure ledger hash chain is broken at ${ledgerVerif.brokenAt}. Workspace is frozen.`
      };
    }

    // 2. Check circuit breaker state
    if (breaker && breaker.getProviderState() === 'OPEN') {
      return {
        allowed: false,
        currentTreeHash: '',
        reason: 'CRITICAL: Circuit breaker is OPEN. Active containment breach.'
      };
    }

    const currentTreeHash = this.computeWorkingTreeHash();
    const latestVerified = this.ledger.getLatestVerifiedReceipt();

    // If source files exist, we must verify that the latest run matches current tree
    if (!latestVerified) {
      // If there are files and no runs have ever completed
      const sourceFiles = this.collectSourceFiles(this.workspaceDir);
      if (sourceFiles.length > 0) {
        return {
          allowed: false,
          currentTreeHash,
          reason: 'NO_VERIFIED_RUNS: No verified runs have been recorded in .raebyes/runs.lock. You must run the tests or solver via `raebyesctl exec` before concluding.'
        };
      }
      return { allowed: true, currentTreeHash };
    }

    if (latestVerified.tree_hash !== currentTreeHash) {
      return {
        allowed: false,
        currentTreeHash,
        verifiedTreeHash: latestVerified.tree_hash,
        latestRunId: latestVerified.run_id,
        reason: `UNVERIFIED_MUTATIONS: Current working tree hash (${currentTreeHash.slice(0, 8)}...) does not match latest verified run ${latestVerified.run_id} (${latestVerified.tree_hash.slice(0, 8)}...). You modified files without running 'raebyesctl exec' to prove they pass.`
      };
    }

    return {
      allowed: true,
      currentTreeHash,
      verifiedTreeHash: latestVerified.tree_hash,
      latestRunId: latestVerified.run_id
    };
  }

  private collectSourceFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === '.raebyes' ||
          entry.name === 'dist' ||
          entry.name === '__pycache__' ||
          entry.name === '.venv'
        ) {
          continue;
        }
        results.push(...this.collectSourceFiles(full));
      } else if (entry.isFile()) {
        if (/\.(ts|js|mjs|cjs|py|tsx|jsx|json|md|ya?ml|toml)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
          results.push(full);
        }
      }
    }
    return results;
  }
}
