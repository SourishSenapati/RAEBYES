import * as path from 'path';
import { AstSlicer } from '@raebyes/daemon';

export async function runSlice(args: string[], workspaceDir = process.cwd()): Promise<void> {
  if (args.length < 2) {
    console.error('\n[RAEBYES SLICE ERROR] Missing arguments.');
    console.error('Usage: raebyes slice <file_path> <function_or_class_name> [--line <number>]\n');
    process.exit(1);
  }

  const filePath = args[0];
  const symbolName = args[1];

  let lineHint: number | undefined;
  const lineIdx = args.indexOf('--line');
  if (lineIdx !== -1 && args[lineIdx + 1]) {
    lineHint = parseInt(args[lineIdx + 1], 10);
  }

  try {
    const slicer = new AstSlicer(workspaceDir);
    const slice = slicer.sliceSymbol(filePath, symbolName, lineHint);

    console.log('\n=============================================================================');
    console.log(` RAEBYES CORTEX AST MICRO-SLICE [${slice.filePath} -> ${slice.symbolName}]`);
    console.log(` Lines: ${slice.startLine}-${slice.endLine} | Estimated Tokens: ~${slice.tokenEstimate}`);
    console.log('=============================================================================');

    if (slice.imports.length > 0) {
      console.log('// --- RELEVANT IMPORTS ---');
      console.log(slice.imports.join('\n'));
      console.log('');
    }

    console.log(`// --- TARGET SYMBOL: ${slice.symbolName} (Lines ${slice.startLine}-${slice.endLine}) ---`);
    console.log(slice.code);
    console.log('');

    if (slice.linkedAntibodies.length > 0) {
      console.log(`// --- ACTIVE ANTIBODY CONSTRAINTS (${slice.linkedAntibodies.length}) ---`);
      for (const ab of slice.linkedAntibodies) {
        console.log(`// [${ab.id}] Rejection Rule: ${ab.rejection_pattern} (${ab.underlying_flaw})`);
      }
    } else {
      console.log('// Active Antibodies: Zero violations recorded for this component.');
    }

    console.log('=============================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error(`\n[RAEBYES SLICE FAILED] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
