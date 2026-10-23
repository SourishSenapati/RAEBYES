import * as child_process from 'child_process';
import * as path from 'path';
import { Raebyes } from 'raebyes';

export async function runExec(commandArgs: string[], workspaceDir = process.cwd()) {
  if (commandArgs.length === 0) {
    console.error('[RAEBYES EXEC ERROR] No command provided. Usage: raebyes exec -- <command>');
    process.exit(1);
  }

  const ws = path.resolve(workspaceDir);
  const guard = new Raebyes({ workspaceDir: ws, mode: 'FATAL_SPASM' });

  // 1. Verify ledger integrity
  console.log('[RAEBYES PRE-FLIGHT] Verifying immutable antibody ledger integrity...');
  guard.verifyLedger();

  // 2. Replay historical regression assertions in milliseconds
  console.log('[RAEBYES PRE-FLIGHT] Replaying historical regression assertions...');
  const start = Date.now();
  const replay = guard.replayAntibodies();
  const elapsed = Date.now() - start;

  if (!replay.passed) {
    console.error('\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error(' [RAEBYES PRE-FLIGHT BREACH] HISTORICAL REGRESSION RESURFACED');
    console.error(` Failed ${replay.failedAntibodies.length} antibody assertions (replayed in ${elapsed}ms):`);
    for (const fail of replay.failedAntibodies) {
      console.error(`   - [${fail.id}] ${fail.description}`);
      console.error(`     Assertion: ${fail.rejection_assertion}`);
    }
    console.error('\n EXECUTION SEVERED BEFORE COMPUTE WASTED. EXIT CODE 137.');
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n');
    process.exit(137);
  }

  console.log(`[RAEBYES PRE-FLIGHT] All ${replay.replayed} antibodies passed in ${elapsed}ms. Launching command...\n`);

  // 3. Execute the actual command with direct stdio pass-through
  const cmd = commandArgs[0];
  const args = commandArgs.slice(1);

  const child = child_process.spawn(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd: ws
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code || 0);
    }
  });

  child.on('error', (err) => {
    console.error(`[RAEBYES EXEC ERROR] Failed to start process: ${err.message}`);
    process.exit(1);
  });
}
