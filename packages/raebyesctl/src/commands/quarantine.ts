import * as fs from 'fs';
import * as path from 'path';
import { sendDaemonCommand, getDefaultSocketPath } from '@raebyes/daemon';

export async function runQuarantine(reason = 'Operator Manual Quarantine', workspaceDir = process.cwd()) {
  const ws = path.resolve(workspaceDir);
  console.log(`\n[RAEBYES QUARANTINE] Tripping all circuit breakers and freezing workspace...`);
  console.log(`  Reason: ${reason}`);

  // 1. Touch quarantine lock file
  const qDir = path.join(ws, '.raebyes', 'quarantine');
  if (!fs.existsSync(qDir)) {
    fs.mkdirSync(qDir, { recursive: true });
  }
  const lockFile = path.join(qDir, 'LOCK');
  fs.writeFileSync(
    lockFile,
    JSON.stringify({
      quarantinedAt: new Date().toISOString(),
      reason,
      status: 'FROZEN'
    }, null, 2),
    'utf-8'
  );

  // 2. Broadcast QUARANTINE over IPC socket if daemon running
  const socketPath = getDefaultSocketPath(ws);
  try {
    const res = await sendDaemonCommand('QUARANTINE', { reason }, socketPath, 1500);
    if (res && res.success) {
      console.log(`  * Broadcast to raebyesd daemon: CIRCUITS TRIPPED (OPEN)`);
    }
  } catch {
    console.log(`  * raebyesd daemon not running locally (lockfile committed).`);
  }

  console.log(`\n[WORKSPACE QUARANTINED] All tool calls and agent executions are blocked.`);
  console.log(`To restore normal operations, run: raebyes reset\n`);
}

export async function runReset(workspaceDir = process.cwd()) {
  const ws = path.resolve(workspaceDir);
  console.log(`\n[RAEBYES RESET] Clearing quarantine and resetting circuit breakers to CLOSED...`);

  // Remove lock file
  const lockFile = path.join(ws, '.raebyes', 'quarantine', 'LOCK');
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
    console.log(`  * Removed quarantine lock: .raebyes/quarantine/LOCK`);
  }

  // Send RESET over IPC
  const socketPath = getDefaultSocketPath(ws);
  try {
    const res = await sendDaemonCommand('RESET', {}, socketPath, 1500);
    if (res && res.success) {
      console.log(`  * Broadcast to raebyesd daemon: CIRCUITS RESET (CLOSED)`);
    }
  } catch {
    // Daemon not running
  }

  console.log(`\n[CIRCUITS CLOSED] System restored to normal operational state.\n`);
}
