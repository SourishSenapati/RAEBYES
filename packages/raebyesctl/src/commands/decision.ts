import * as fs from 'fs';
import * as path from 'path';

export interface DecisionEntry {
  id: string; // DEC-XXXX
  timestamp: string;
  title: string;
  constraint: string;
  context?: string;
}

export async function runDecision(title: string, constraint: string, context?: string, workspaceDir = process.cwd()) {
  const ws = path.resolve(workspaceDir);
  const decisionsFile = path.join(ws, '.raebyes', 'decisions.json');

  let entries: DecisionEntry[] = [];
  if (fs.existsSync(decisionsFile)) {
    try {
      entries = JSON.parse(fs.readFileSync(decisionsFile, 'utf-8'));
    } catch {
      entries = [];
    }
  }

  const nextIndex = entries.length + 1;
  const decId = `DEC-${String(nextIndex).padStart(4, '0')}`;
  const timestamp = new Date().toISOString();

  const newEntry: DecisionEntry = {
    id: decId,
    timestamp,
    title,
    constraint,
    context
  };

  entries.push(newEntry);

  const dir = path.dirname(decisionsFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(decisionsFile, JSON.stringify(entries, null, 2), 'utf-8');

  console.log(`\n[ARCHITECTURAL DECISION COMMITTED]`);
  console.log(`  Decision ID: ${newEntry.id}`);
  console.log(`  Title:       ${newEntry.title}`);
  console.log(`  Constraint:  ${newEntry.constraint}`);
  console.log(`  File:        .raebyes/decisions.json`);
  console.log(`  Note: Autonomous agents are strictly forbidden from altering or reversing this constraint.\n`);
}
