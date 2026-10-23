import * as path from 'path';
import { TruthEnforcer, SpasmCircuitBreaker, sendDaemonCommand, getDefaultSocketPath } from '@raebyes/daemon';

export async function runVerifyTurn(workspaceDir = process.cwd()) {
  const ws = path.resolve(workspaceDir);
  const truthEnforcer = new TruthEnforcer(ws);
  const socketPath = getDefaultSocketPath(ws);

  // 1. First query daemon if online
  try {
    const res = await sendDaemonCommand('VERIFY_TURN', {}, socketPath, 1500);
    if (res && res.success && res.data) {
      if (res.data.allowed) {
        console.log(`[RAEBYES_TURN_VERIFIED] Workspace tree hash matches verified run receipt (${res.data.latestRunId}).`);
        process.exit(0);
      } else {
        emitLieBlock(res.data.reason);
        process.exit(2);
      }
    }
  } catch {
    // Daemon offline, run deterministic local verification
  }

  // 2. Local deterministic fallback verification
  const breaker = new SpasmCircuitBreaker({ workspaceDir: ws });
  const check = truthEnforcer.verifyTurn(breaker);

  if (!check.allowed) {
    emitLieBlock(check.reason);
    process.exit(2);
  }

  console.log(`[RAEBYES_TURN_VERIFIED] Working tree hash (${check.currentTreeHash.slice(0, 8)}...) matches verified run ${check.latestRunId}.`);
  process.exit(0);
}

function emitLieBlock(reason?: string) {
  console.error('\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error(' [RAEBYES_LIE_DETECTOR_BLOCK] TURN COMPLETION REFUSED (EXIT CODE 2)');
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error(` REASON: ${reason || 'Unverified code mutations detected.'}`);
  console.error('\n You attempted to finish your turn with unverified code mutations or an active breach.');
  console.error(' You are physically blocked from concluding until you execute the authentic verification');
  console.error(" command via 'raebyesctl exec -- <command>' and obtain a valid RUN-XXXX proof receipt.\n");
}
