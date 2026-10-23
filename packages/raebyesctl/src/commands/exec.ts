import * as child_process from 'child_process';
import * as path from 'path';
import { AntibodyLedger, TruthEnforcer, SpasmCircuitBreaker } from '@raebyes/daemon';

export async function runExec(commandArgs: string[], workspaceDir = process.cwd()) {
  if (commandArgs.length === 0) {
    console.error('[RAEBYES EXEC ERROR] No command provided. Usage: raebyes exec -- <command>');
    process.exit(1);
  }

  const ws = path.resolve(workspaceDir);
  const ledger = new AntibodyLedger(ws);
  const truthEnforcer = new TruthEnforcer(ws);
  const breaker = new SpasmCircuitBreaker({ workspaceDir: ws });

  // 1. Verify ledger integrity
  const verif = ledger.verifyLedgerIntegrity();
  if (!verif.valid) {
    console.error(`\n[RAEBYES EXEC HALT] Failure ledger tampered at ${verif.brokenAt}: ${verif.reason}`);
    breaker.recordBreach('PRE_FLIGHT', `Ledger broken at ${verif.brokenAt}`, { verif });
    process.exit(137);
  }

  const cmd = commandArgs[0];
  const args = commandArgs.slice(1);
  const fullCmdStr = commandArgs.join(' ');

  const startTime = Date.now();
  let capturedStdout = '';

  const child = child_process.spawn(cmd, args, {
    stdio: ['inherit', 'pipe', 'inherit'],
    shell: true,
    cwd: ws
  });

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    capturedStdout += text;
    process.stdout.write(chunk);
  });

  child.on('exit', (code, signal) => {
    const durationMs = Date.now() - startTime;

    if (code === 0 && !signal) {
      // Mint cryptographic proof-of-execution
      const receipt = truthEnforcer.recordPassingRun(fullCmdStr, capturedStdout, durationMs);
      console.log(`\nRAEBYES_PROOF[${receipt.run_id}:${receipt.proof_hmac}:VERIFIED]`);
      console.log(`[RAEBYES] Cryptographic execution receipt minted in .raebyes/runs.lock (${durationMs}ms)\n`);
      process.exit(0);
    } else {
      console.error(`\n[RAEBYES EXEC FAILED] Command exited with code ${code ?? signal}`);
      process.exit(code || 1);
    }
  });

  child.on('error', (err) => {
    console.error(`[RAEBYES EXEC ERROR] Failed to start command: ${err.message}`);
    process.exit(1);
  });
}
