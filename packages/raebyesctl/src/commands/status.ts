import * as fs from 'fs';
import * as path from 'path';
import { sendDaemonCommand, getDefaultSocketPath } from '@raebyes/daemon';
import { AntibodyLedger } from 'raebyes';

export async function runStatus(workspaceDir = process.cwd()) {
  const ws = path.resolve(workspaceDir);
  const raebyesDir = path.join(ws, '.raebyes');
  const socketPath = getDefaultSocketPath(ws);

  console.log('\n===============================================================');
  console.log('   RAEBYES GOVERNANCE ENGINE — SYSTEM & CIRCUIT STATUS        ');
  console.log('===============================================================');
  console.log(` Workspace:  ${ws}`);

  // Check Daemon IPC
  let daemonStatus = 'OFFLINE (Not listening on socket)';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let daemonData: any = null;
  try {
    const res = await sendDaemonCommand('STATUS', {}, socketPath, 1000);
    if (res && res.success) {
      daemonStatus = 'ACTIVE (raebyesd online)';
      daemonData = res.data;
    }
  } catch {
    // Daemon offline
  }

  console.log(` Daemon:     ${daemonStatus}`);
  if (daemonData) {
    console.log(` Provider:   State: ${daemonData.providerState} | Uptime: ${daemonData.uptimeSec.toFixed(1)}s`);
    console.log(` Halted:     ${daemonData.isHalted ? 'YES (GLOBAL STOP TRIPPED)' : 'NO (Normal Operation)'}`);
    console.log(` Turn Cost:  $${daemonData.turnCostUsd.toFixed(3)} (Elapsed: ${daemonData.elapsedTurnSec.toFixed(1)}s)`);
    if (daemonData.tools && daemonData.tools.length > 0) {
      console.log(' Monitored Tools:');
      for (const t of daemonData.tools) {
        console.log(`   - ${t.toolName}: ${t.state} (Failures: ${t.failures}, Cooldown: ${t.inCooldown})`);
      }
    }
  }

  // Check Quarantine Lock
  const lockFile = path.join(raebyesDir, 'quarantine', 'LOCK');
  const isQuarantined = fs.existsSync(lockFile);
  console.log(` Quarantine: ${isQuarantined ? 'LOCKED / FROZEN' : 'CLEAR'}`);

  // Check Antibodies
  const antibodiesFile = path.join(raebyesDir, 'antibodies.json');
  if (fs.existsSync(antibodiesFile)) {
    const ledger = new AntibodyLedger(antibodiesFile);
    const v = ledger.verify();
    console.log(` Antibodies: ${v.totalEntries} rules (Ledger: ${v.valid ? 'VALID' : 'TAMPERED'})`);
  } else {
    console.log(` Antibodies: 0 rules (uninitialized)`);
  }

  // Check Decisions
  const decisionsFile = path.join(raebyesDir, 'decisions.json');
  if (fs.existsSync(decisionsFile)) {
    try {
      const decs = JSON.parse(fs.readFileSync(decisionsFile, 'utf-8'));
      console.log(` Decisions:  ${decs.length} immutable architectural decisions`);
    } catch {
      console.log(` Decisions:  0`);
    }
  }

  // Check Core Hubs
  const graphLock = path.join(raebyesDir, 'graph.lock');
  if (fs.existsSync(graphLock)) {
    try {
      const g = JSON.parse(fs.readFileSync(graphLock, 'utf-8'));
      console.log(` Core Hubs:  ${g.hubs ? g.hubs.length : 0} locked files (Total files: ${g.totalFiles || 0})`);
    } catch {
      // Ignore
    }
  }

  // Check Trajectories / Breaches
  const trajDir = path.join(raebyesDir, 'trajectories');
  if (fs.existsSync(trajDir)) {
    const breaches = fs.readdirSync(trajDir).filter(f => f.startsWith('BREACH-') && f.endsWith('.json'));
    console.log(` Breaches:   ${breaches.length} historical containment breaches logged`);
  }

  console.log('===============================================================\n');
}
