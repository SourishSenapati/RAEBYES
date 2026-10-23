import * as path from 'path';
import { AntibodyLedger } from 'raebyes';

export async function runVerify(workspaceDir = process.cwd()) {
  const ws = path.resolve(workspaceDir);
  const ledgerPath = path.join(ws, '.raebyes', 'antibodies.json');
  const ledger = new AntibodyLedger(ledgerPath);

  console.log(`\n[RAEBYES VERIFY] Validating SHA-256 hash chain of ${ledgerPath}...`);

  const result = ledger.verify();
  if (result.valid) {
    console.log(`[VERIFICATION PASSED] All ${result.totalEntries} antibody blocks are cryptographically intact.`);
    const entries = ledger.readEntries();
    if (entries.length > 0) {
      console.log('\n  Registered Antibodies:');
      for (const e of entries) {
        console.log(`  - [${e.id}] ${e.description.padEnd(40)} (hash: ${e.hash.slice(0, 10)}...)`);
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
