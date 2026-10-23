import * as fs from 'fs';
import * as path from 'path';
import { WorktreeTournament } from '@raebyes/daemon';

export async function runTournament(args: string[], workspaceDir = process.cwd()): Promise<void> {
  if (args.length < 3) {
    console.error('\n[RAEBYES TOURNAMENT ERROR] Insufficient arguments.');
    console.error('Usage: raebyes tournament <target_file> --cmd "<verify_command>" --patches <file1> <file2> ...\n');
    process.exit(1);
  }

  const targetFile = args[0];
  let verifyCmd = '';
  const patchFiles: string[] = [];

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--cmd' && args[i + 1]) {
      verifyCmd = args[i + 1];
      i++;
    } else if (args[i] === '--patches') {
      for (let j = i + 1; j < args.length; j++) {
        if (args[j].startsWith('--')) break;
        patchFiles.push(args[j]);
      }
    } else if (args[i] === '--dir' && args[i + 1]) {
      const dirPath = path.resolve(workspaceDir, args[i + 1]);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        for (const f of files) {
          patchFiles.push(path.join(dirPath, f));
        }
      }
      i++;
    }
  }

  if (!verifyCmd) {
    console.error('[RAEBYES TOURNAMENT ERROR] Missing required flag: --cmd "<command>"');
    process.exit(1);
  }

  if (patchFiles.length === 0) {
    console.error('[RAEBYES TOURNAMENT ERROR] No candidate patch files specified (--patches or --dir).');
    process.exit(1);
  }

  const candidateCodes: string[] = [];
  for (const pf of patchFiles) {
    const fullPath = path.isAbsolute(pf) ? pf : path.join(workspaceDir, pf);
    if (!fs.existsSync(fullPath)) {
      console.error(`[RAEBYES TOURNAMENT WARNING] Candidate file not found: ${pf}, skipping.`);
      continue;
    }
    candidateCodes.push(fs.readFileSync(fullPath, 'utf-8'));
  }

  if (candidateCodes.length === 0) {
    console.error('[RAEBYES TOURNAMENT ERROR] Zero valid candidate patches found.');
    process.exit(1);
  }

  console.log('\n=============================================================================');
  console.log(` RAEBYES WORKTREE TOURNAMENT — BEST-OF-${candidateCodes.length} PARALLEL VERIFICATION`);
  console.log(` Target File:    ${targetFile}`);
  console.log(` Verifier Gate:  ${verifyCmd}`);
  console.log('=============================================================================\n');

  try {
    const tournament = new WorktreeTournament(workspaceDir);
    const result = await tournament.runTournament(targetFile, candidateCodes, verifyCmd);

    for (const c of result.candidates) {
      if (c.score > 0) {
        const isWinner = result.winner?.id === c.id;
        console.log(`  [${c.id}] PASSED compilation & antibodies | DiffSize: ${c.astDiffSize} | Score: ${c.score} ${isWinner ? '★ WINNER' : ''}`);
      } else {
        console.log(`  [${c.id}] REJECTED: ${c.error ?? 'Verification failed'}`);
      }
    }

    if (result.status === 'WON' && result.winner && result.runReceipt) {
      console.log('\n-----------------------------------------------------------------------------');
      console.log(`[TOURNAMENT SUCCESS] Winning candidate ${result.winner.id} atomically applied to ${targetFile}!`);
      console.log(`RAEBYES_PROOF[${result.runReceipt.run_id}:${result.runReceipt.proof_hmac}:VERIFIED]\n`);
      process.exit(0);
    } else {
      console.error('\n[TOURNAMENT FAILED] All candidate patches failed verification. Working tree preserved.\n');
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n[TOURNAMENT ERROR] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
