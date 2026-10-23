#!/usr/bin/env node
import * as url from 'url';
import * as path from 'path';
import { runInit } from './commands/init.js';
import { runSpawn } from './commands/spawn.js';
import { runExec } from './commands/exec.js';
import { runVerifyTurn } from './commands/verify-turn.js';
import { runImmunize } from './commands/immunize.js';
import { runQuarantine, runReset } from './commands/quarantine.js';
import { runReplay } from './commands/replay.js';
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

COMMANDS:
  init                     Scaffold .raebyes/ vault, binary shims, and agent Stop-hooks
  spawn                    Start detached raebyesd background watchdog daemon
                           Options: [--hydrophobic] [--foreground]
  exec -- <cmd>            Pre-flight regression gate; replays antibodies & mints RUN-XXXX proof
  verify-turn              Stop-hook lie detector: blocks turn conclusion (exit 2) if unverified
  immunize                 Append new failure antibody with SHA-256 chain (ABY-XXXX)
                           Options: --desc "<desc>" --pattern "<regex/js>" [--comp "<name>"]
  quarantine               Trip all circuit breakers immediately to OPEN & lock workspace
  reset                    Clear quarantine lock and reset breakers to CLOSED
  replay                   Re-evaluate recorded breach trajectories against active rules
  verify                   Verify cryptographic integrity of .raebyes/antibodies.json
  status                   Display circuit state, Core Hub files, and latest verified run
  auth                     Verify or activate Enterprise Pro license key

EXAMPLES:
  raebyes init
  raebyes spawn --hydrophobic
  raebyes exec -- npm test
  raebyes verify-turn
  raebyes immunize --desc "ERR-004 Untreated whistles" --pattern "untreated_whistles < 12"
  raebyes replay
  raebyes status
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

      case 'verify-turn': {
        await runVerifyTurn(process.cwd());
        break;
      }

      case 'immunize': {
        const getArg = (flag: string) => {
          const idx = args.indexOf(flag);
          return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
        };
        const desc = getArg('--desc') || getArg('-d') || 'Agent failure antibody rule';
        const pattern = getArg('--pattern') || getArg('-p') || getArg('--assert') || 'return true;';
        const comp = getArg('--comp') || 'core';
        await runImmunize({ description: desc, assertion: pattern, type: 'PREDICATE_JS' });
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

      case 'replay': {
        const breachIdx = args.indexOf('--breach');
        const breachId = breachIdx !== -1 && args[breachIdx + 1] ? args[breachIdx + 1] : undefined;
        await runReplay(breachId);
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

      case 'auth': {
        const keyIdx = args.indexOf('--key');
        const key = keyIdx !== -1 && args[keyIdx + 1] ? args[keyIdx + 1] : undefined;
        await runAuth(key);
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

      default:
        console.error(`[RAEBYES] Unknown command: '${command}'. Run 'raebyes --help' for help.`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`[RAEBYES ERROR] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// Auto-run if executed as script
const isMain = Boolean(
  process.argv[1] &&
  (path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url)) ||
   process.argv[1].endsWith('cli.js') ||
   process.argv[1].endsWith('raebyes.js') ||
   process.argv[1].endsWith('raebyesctl') ||
   process.argv[1].endsWith('raebyes'))
);

if (isMain) {
  main();
}
