import * as path from 'path';
import * as fs from 'fs';
import { HydrophobiaEngine } from './engine/hydrophobia.js';
import { VarianceGuard } from './engine/variance-guard.js';
import { CoreHubGraph } from './engine/core-hub-graph.js';
import { SpasmCircuitBreaker } from './engine/spasm-breaker.js';
import { RaebyesSocketServer, getDefaultSocketPath, sendDaemonCommand } from './ipc/socket-server.js';

import * as url from 'url';

export * from './engine/types.js';
export { HydrophobiaEngine } from './engine/hydrophobia.js';
export { VarianceGuard } from './engine/variance-guard.js';
export { CoreHubGraph } from './engine/core-hub-graph.js';
export { SpasmCircuitBreaker } from './engine/spasm-breaker.js';
export { RaebyesSocketServer, getDefaultSocketPath, sendDaemonCommand } from './ipc/socket-server.js';

// CLI Execution check: only execute if invoked directly as the daemon binary
const isMain = Boolean(
  process.argv[1] &&
  (path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url)) ||
   process.argv[1].endsWith('raebyesd.js') ||
   process.argv[1].endsWith('raebyesd'))
);

if (isMain) {
  // Enforce argv[0] identification in process table
  process.title = 'raebyesd';

  const args = process.argv.slice(2);
  let workspaceDir = process.cwd();
  let customSocket: string | undefined;
  let hydrophobicMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace' && args[i + 1]) {
      workspaceDir = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--socket' && args[i + 1]) {
      customSocket = args[i + 1];
      i++;
    } else if (args[i] === '--hydrophobic') {
      hydrophobicMode = true;
    }
  }

  const socketPath = customSocket || getDefaultSocketPath(workspaceDir);
  console.log('===========================================================');
  console.log('   RAEBYES DAEMON (raebyesd) — Deterministic Watchdog      ');
  console.log('   "Prompt guardrails are polite suggestions.              ');
  console.log('    RAEBYES is an involuntary reflex."                     ');
  console.log('===========================================================');
  console.log(`[raebyesd] PID: ${process.pid}`);
  console.log(`[raebyesd] Workspace: ${workspaceDir}`);
  console.log(`[raebyesd] IPC Socket: ${socketPath}`);
  console.log(`[raebyesd] Hydrophobic Mode: ${hydrophobicMode ? 'ACTIVE (Zero-Tolerance)' : 'STANDARD'}`);

  const hydrophobia = new HydrophobiaEngine();
  const varianceGuard = new VarianceGuard();
  const coreHubGraph = new CoreHubGraph(workspaceDir);
  const breaker = new SpasmCircuitBreaker({ workspaceDir });

  // Load or build graph.lock
  const lockPath = path.join(workspaceDir, '.raebyes', 'graph.lock');
  if (fs.existsSync(lockPath)) {
    coreHubGraph.loadLockfile(lockPath);
    console.log(`[raebyesd] Loaded dependency lock from ${lockPath}`);
  } else {
    coreHubGraph.buildGraph().then(report => {
      console.log(`[raebyesd] Graph indexed: ${report.totalFiles} files, ${report.hubs.length} Core Hubs detected.`);
      if (fs.existsSync(path.join(workspaceDir, '.raebyes'))) {
        coreHubGraph.saveLockfile(lockPath);
      }
    });
  }

  const server = new RaebyesSocketServer(
    workspaceDir,
    socketPath,
    hydrophobia,
    varianceGuard,
    coreHubGraph,
    breaker
  );

  server.start().then((listeningPath) => {
    console.log(`[raebyesd] IPC Server listening at ${listeningPath}`);
    console.log('[raebyesd] Ready for incoming tool calls, diff scans, and pre-flight gates.\n');
  }).catch((err) => {
    console.error(`[raebyesd] FATAL: Failed to start IPC server: ${err.message}`);
    process.exit(1);
  });

  const cleanup = async () => {
    console.log('\n[raebyesd] Received shutdown signal. Stopping server cleanly...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  if (process.platform !== 'win32') {
    process.on('SIGHUP', async () => {
      console.log('[raebyesd] Received SIGHUP. Reloading dependency graph and configurations...');
      await coreHubGraph.buildGraph();
    });
  }
}
