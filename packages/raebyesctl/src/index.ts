import { runInit } from './commands/init.js';
import { runSpawn } from './commands/spawn.js';
import { runExec } from './commands/exec.js';
import { runImmunize } from './commands/immunize.js';
import { runQuarantine, runReset } from './commands/quarantine.js';
import { runVerify } from './commands/verify.js';
import { runStatus } from './commands/status.js';
import { runAuth } from './commands/auth.js';
import { runDecision } from './commands/decision.js';

export function printHelp() {
  console.log(`
=============================================================================
 R.A.E.B.Y.E.S. — Rigid Agent Execution Breaker & Yield Error System
 "Prompt guardrails are polite suggestions. RAEBYES is an involuntary reflex."
=============================================================================

USAGE:
  raebyes <command> [options]
  raebyesctl <command> [options]

CORE COMMANDS:
  init                     Initialize .raebyes governance vault, agent hooks, and Core Hub locks
  spawn                    Start the raebyesd background watchdog daemon
                           Options: [--hydrophobic] [--foreground] [--workspace <dir>]
  exec -- <cmd>            Pre-flight regression gate; replays historical assertions before running cmd
  immunize                 Append new failure antibody with SHA-256 hash chaining (ABY-XXXX)
                           Options: --desc "<desc>" --assert "<assertion>" [--type PREDICATE_JS|AST_RULE]
  decision                 Record an immutable architectural constraint (DEC-XXXX)
                           Options: --title "<title>" --constraint "<rule>"
  verify                   Verify cryptographic integrity of the append-only failure ledger
  status                   Display circuit breaker status, Core Hub files, and active locks
  quarantine               Trip all circuit breakers immediately and freeze workspace
  reset                    Clear quarantine lock and reset breakers to CLOSED
  auth                     Check or activate Enterprise Pro license key

EXAMPLES:
  raebyes init
  raebyes spawn --hydrophobic
  raebyes exec -- npm test
  raebyes immunize --desc "ERR-004 Untreated whistles lock" --assert "workspaceDir => true"
  raebyes verify
  raebyes status
  raebyes quarantine --reason "Unverified SQL mutation detected"
  raebyes reset

=============================================================================
`);
}

export async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '-h' || command === '--help' || command === 'help') {
    printHelp();
    return;
  }

  if (command === '-v' || command === '--version') {
    console.log('raebyes v1.0.0');
    return;
  }

  try {
    switch (command) {
      case 'init': {
        const force = args.includes('--force');
        await runInit(process.cwd(), { force });
        break;
      }

      case 'spawn': {
        const hydrophobic = args.includes('--hydrophobic');
        const foreground = args.includes('--foreground');
        await runSpawn({ hydrophobic, foreground });
        break;
      }

      case 'exec': {
        const separatorIdx = args.indexOf('--');
        const cmdArgs = separatorIdx !== -1 ? args.slice(separatorIdx + 1) : args.slice(1);
        await runExec(cmdArgs);
        break;
      }

      case 'immunize': {
        const getArg = (flag: string) => {
          const idx = args.indexOf(flag);
          return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
        };
        const desc = getArg('--desc') || getArg('-d') || 'Agent failure antibody rule';
        const assertStr = getArg('--assert') || getArg('-a') || 'return true;';
        const type = getArg('--type') || 'PREDICATE_JS';
        await runImmunize({ description: desc, assertion: assertStr, type });
        break;
      }

      case 'decision': {
        const getArg = (flag: string) => {
          const idx = args.indexOf(flag);
          return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
        };
        const title = getArg('--title') || getArg('-t') || 'System Architecture Decision';
        const constraint = getArg('--constraint') || getArg('-c') || 'Strict invariant';
        const ctx = getArg('--context');
        await runDecision(title, constraint, ctx);
        break;
      }

      case 'verify': {
        await runVerify();
        break;
      }

      case 'status': {
        await runStatus();
        break;
      }

      case 'quarantine': {
        const reasonIdx = args.indexOf('--reason');
        const reason = reasonIdx !== -1 && args[reasonIdx + 1] ? args[reasonIdx + 1] : 'Manual quarantine';
        await runQuarantine(reason);
        break;
      }

      case 'reset': {
        await runReset();
        break;
      }

      case 'auth': {
        const keyIdx = args.indexOf('--key');
        const key = keyIdx !== -1 && args[keyIdx + 1] ? args[keyIdx + 1] : undefined;
        await runAuth(key);
        break;
      }

      default:
        console.error(`[RAEBYES] Unknown command: '${command}'. Run 'raebyes --help' for available commands.`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`[RAEBYES ERROR] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

import * as url from 'url';
import * as path from 'path';

// Auto-run if executed as script
const isMain = Boolean(
  process.argv[1] &&
  (path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url)) ||
   process.argv[1].endsWith('raebyes.js') ||
   process.argv[1].endsWith('raebyesctl') ||
   process.argv[1].endsWith('raebyes'))
);

if (isMain) {
  main();
}
