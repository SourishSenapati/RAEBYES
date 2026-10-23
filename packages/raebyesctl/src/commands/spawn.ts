import * as child_process from 'child_process';
import * as path from 'path';
import * as url from 'url';
import { sendDaemonCommand, getDefaultSocketPath } from '@raebyes/daemon';

export async function runSpawn(options: {
  workspaceDir?: string;
  socketPath?: string;
  hydrophobic?: boolean;
  cortex4b?: boolean;
  foreground?: boolean;
}) {
  const ws = path.resolve(options.workspaceDir || process.cwd());
  const socketPath = options.socketPath || getDefaultSocketPath(ws);

  // Check if daemon is already running
  try {
    const ping = await sendDaemonCommand('PING', {}, socketPath, 1000);
    if (ping && ping.success) {
      console.log(`[RAEBYES SPAWN] raebyesd daemon is already active on ${socketPath}`);
      return;
    }
  } catch {
    // Daemon not active, proceed to spawn
  }

  console.log(`[RAEBYES SPAWN] Launching raebyesd daemon on socket: ${socketPath}`);
  console.log(`[RAEBYES SPAWN] Mode: ${options.hydrophobic ? 'HYDROPHOBIC (Aggressive Spasm)' : 'STANDARD'}${options.cortex4b ? ' + CORTEX-4B EXOSKELETON' : ''}`);

  // Locate raebyesd binary
  const currentDir = path.dirname(url.fileURLToPath(import.meta.url));
  const daemonPath = path.resolve(currentDir, '../../../../daemons/raebyesd/dist/index.js');

  const args = [daemonPath, '--workspace', ws, '--socket', socketPath];
  if (options.hydrophobic) {
    args.push('--hydrophobic');
  }
  if (options.cortex4b) {
    args.push('--cortex-4b');
  }

  if (options.foreground) {
    const proc = child_process.spawn(process.execPath, args, {
      stdio: 'inherit',
      cwd: ws
    });
    proc.on('exit', (code) => {
      process.exit(code || 0);
    });
  } else {
    const outLog = path.join(ws, '.raebyes', 'raebyesd.log');
    const child = child_process.spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      cwd: ws
    });
    child.unref();
    console.log(`[RAEBYES SPAWN] raebyesd daemon spawned in background (PID: ${child.pid}).`);
    console.log(`[RAEBYES SPAWN] Monitor status anytime with: raebyes status\n`);
  }
}
