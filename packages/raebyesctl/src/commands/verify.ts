import * as path from 'path';
import { AntibodyLedger } from '@raebyes/daemon';

export async function runVerify(workspaceDir = process.cwd()) {
  const ws = path.resolve(workspaceDir);
  const ledger = new AntibodyLedger(ws);

  console.log(`\n[RAEBYES VERIFY] Validating SHA-256 hash chain of .raebyes/antibodies.json...`);

  const result = ledger.verifyLedgerIntegrity();
  if (result.valid) {
    console.log(`[VERIFICATION PASSED] All ${result.totalEntries} antibody blocks are cryptographically intact.`);
    const entries = ledger.readEntries();
    if (entries.length > 0) {
      console.log('\n  Registered Antibodies:');
      for (const e of entries) {
        console.log(`  - [${e.id}] ${e.underlying_flaw.padEnd(40)} (hash: ${e.hash.slice(0, 10)}...)`);
      }
    }
    console.log('');
  } else {
    console.error(`\n[TAMPER DETECTED] Immutable ledger hash chain is broken!`);
    console.error(`  Broken at: ${result.brokenAt}`);
    console.error(`  Reason:    ${result.reason}\n`);
    process.exit(137);
  }
}
