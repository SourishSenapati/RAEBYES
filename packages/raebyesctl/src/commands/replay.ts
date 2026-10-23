import * as fs from 'fs';
import * as path from 'path';
import { AntibodyLedger, HydrophobiaEngine } from '@raebyes/daemon';

export async function runReplay(breachId?: string, workspaceDir = process.cwd()) {
  const ws = path.resolve(workspaceDir);
  const trajDir = path.join(ws, '.raebyes', 'trajectories');

  if (!fs.existsSync(trajDir)) {
    console.log('[RAEBYES REPLAY] No recorded breach trajectories found in .raebyes/trajectories/');
    return;
  }

  const files = fs.readdirSync(trajDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('[RAEBYES REPLAY] No breach trajectories found to replay.');
    return;
  }

  const targets = breachId ? [`${breachId}.json`] : files;
  const ledger = new AntibodyLedger(ws);
  const antibodies = ledger.readEntries();
  const hydrophobia = new HydrophobiaEngine();

  console.log(`\n[RAEBYES REPLAY] Replaying ${targets.length} historical breach trajectories against ${antibodies.length} active antibodies:\n`);

  for (const t of targets) {
    const full = path.join(trajDir, t);
    if (!fs.existsSync(full)) {
      console.warn(`  ! Trajectory ${t} not found.`);
      continue;
    }

    try {
      const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
      console.log(`--- [${data.id}] Trajectory Replay ---`);
      console.log(`  Timestamp: ${data.timestamp}`);
      console.log(`  Layer:     ${data.layer}`);
      console.log(`  Reason:    ${data.reason}`);

      // Re-scan any snippet or code attached to breach
      if (data.details?.snippet || data.details?.code) {
        const check = hydrophobia.scanCode(data.details.snippet || data.details.code, 'replay.ts', undefined, antibodies);
        console.log(`  Active Re-test: ${check.passed ? 'CLEAN' : 'DETERMINISTICALLY BLOCKED'}`);
      }
      console.log('');
    } catch (err) {
      console.error(`  Failed to parse ${t}: ${err}`);
    }
  }
}
