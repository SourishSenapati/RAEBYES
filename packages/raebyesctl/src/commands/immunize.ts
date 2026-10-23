import * as path from 'path';
import { AntibodyLedger, AntibodyEntry } from 'raebyes';

export async function runImmunize(options: {
  description: string;
  type?: string;
  assertion: string;
  workspaceDir?: string;
}) {
  const ws = path.resolve(options.workspaceDir || process.cwd());
  const ledgerPath = path.join(ws, '.raebyes', 'antibodies.json');
  const ledger = new AntibodyLedger(ledgerPath);

  const assertionType = (options.type?.toUpperCase() || 'PREDICATE_JS') as AntibodyEntry['assertionType'];

  console.log(`\n[RAEBYES IMMUNIZE] Recording new immutable failure antibody...`);
  console.log(`  Description: ${options.description}`);
  console.log(`  Type:        ${assertionType}`);
  console.log(`  Assertion:   ${options.assertion}`);

  try {
    const entry = ledger.append({
      description: options.description,
      assertionType,
      rejection_assertion: options.assertion
    });

    console.log(`\n[IMMUNIZATION SUCCESSFUL]`);
    console.log(`  Antibody ID: ${entry.id}`);
    console.log(`  SHA-256:     ${entry.hash}`);
    console.log(`  Prev Hash:   ${entry.prev_hash}`);
    console.log(`  Stored in:   .raebyes/antibodies.json\n`);
  } catch (err) {
    console.error(`\n[IMMUNIZATION FAILED] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
