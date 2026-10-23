import * as path from 'path';
import { AntibodyLedger } from '@raebyes/daemon';

export async function runImmunize(options: {
  description: string;
  type?: string;
  assertion: string;
  component?: string;
  workspaceDir?: string;
}) {
  const ws = path.resolve(options.workspaceDir || process.cwd());
  const ledger = new AntibodyLedger(ws);
  const component = options.component || 'core';

  console.log(`\n[RAEBYES IMMUNIZE] Recording new immutable failure antibody...`);
  console.log(`  Description: ${options.description}`);
  console.log(`  Component:   ${component}`);
  console.log(`  Pattern:     ${options.assertion}`);

  try {
    const entry = ledger.appendAntibody({
      component,
      false_claim: 'Agent hallucinated shortcut or deleted assertion',
      underlying_flaw: options.description,
      rejection_pattern: options.assertion
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
