import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  AntibodyLedger,
  HydrophobiaEngine,
  VarianceGuard,
  CoreHubGraph,
  SpasmCircuitBreaker,
  TruthEnforcer,
  VaultHealer,
  AstSlicer,
  StepLockFSM,
  WorktreeTournament,
  GrammarSanitizer,
  RepairSynthesizer
} from '../daemons/raebyesd/dist/index.js';
import { Raebyes, RaebyesSpasmError } from '../packages/sdk-js/dist/index.js';
import { McpStdioProxy } from '../packages/mcp-interceptor/dist/index.js';

test('1. AntibodyLedger: SHA-256 hash chaining and tamper rejection', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raebyes-ledger-'));
  const ledger = new AntibodyLedger(tmpDir);

  const v0 = ledger.verifyLedgerIntegrity();
  assert.strictEqual(v0.valid, true);
  assert.strictEqual(v0.totalEntries, 0);

  // Append entry 1
  const e1 = ledger.appendAntibody({
    component: 'solver',
    false_claim: 'Claimed solver converged',
    underlying_flaw: 'Synthetic approximation used',
    rejection_pattern: 'res.executionTimeMs > 2500'
  });
  assert.strictEqual(e1.id, 'ABY-0001');
  assert.strictEqual(e1.prev_hash, '0000000000000000000000000000000000000000000000000000000000000000');
  assert.strictEqual(e1.hash.length, 64);

  // Append entry 2
  const e2 = ledger.appendAntibody({
    component: 'core',
    false_claim: 'All tests passing',
    underlying_flaw: 'Deleted expect() assertion',
    rejection_pattern: 'expect\\('
  });
  assert.strictEqual(e2.id, 'ABY-0002');
  assert.strictEqual(e2.prev_hash, e1.hash);

  const v1 = ledger.verifyLedgerIntegrity();
  assert.strictEqual(v1.valid, true);
  assert.strictEqual(v1.totalEntries, 2);

  // Tamper test
  const raw = JSON.parse(fs.readFileSync(ledger.getLedgerPath(), 'utf-8'));
  raw[0].underlying_flaw = 'Tampered description';
  fs.writeFileSync(ledger.getLedgerPath(), JSON.stringify(raw, null, 2), 'utf-8');

  const vTamper = ledger.verifyLedgerIntegrity();
  assert.strictEqual(vTamper.valid, false);
  assert.strictEqual(vTamper.brokenAt, 'ABY-0001');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('2. VaultHealer: Golden snapshot watch and instant restoration', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raebyes-vault-'));
  const raebyesDir = path.join(tmpDir, '.raebyes');
  fs.mkdirSync(raebyesDir, { recursive: true });

  const confPath = path.join(raebyesDir, 'raebyes.conf');
  const originalConf = 'max_turn_budget_usd = 0.50\n';
  fs.writeFileSync(confPath, originalConf, 'utf-8');

  const breaker = new SpasmCircuitBreaker({ workspaceDir: tmpDir });
  const healer = new VaultHealer(tmpDir, breaker);
  healer.armVault();

  // Agent attempts unauthorized overwrite to escape budget limit
  fs.writeFileSync(confPath, 'max_turn_budget_usd = 9999.00\n', 'utf-8');

  // Wait 100ms for fs.watch event loop
  await new Promise((r) => setTimeout(r, 100));

  // Verify file was restored from RAM golden snapshot
  const restored = fs.readFileSync(confPath, 'utf-8');
  assert.strictEqual(restored, originalConf);

  healer.disarm();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('3. HydrophobiaEngine: Freshness lock and shortcut scanner', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raebyes-hydro-'));
  const testFile = path.join(tmpDir, 'solver.ts');
  fs.writeFileSync(testFile, 'export function run() { return 42; }');

  const engine = new HydrophobiaEngine();

  // 1. Blind edit check (file exists on disk but never read)
  const blindCheck = engine.checkFreshness('solver.ts', tmpDir);
  assert.strictEqual(blindCheck.allowed, false);
  assert.strictEqual(blindCheck.violation?.type, 'ERR_BLIND_EDIT');

  // 2. Record read -> now allowed
  engine.recordRead('solver.ts');
  const freshCheck = engine.checkFreshness('solver.ts', tmpDir);
  assert.strictEqual(freshCheck.allowed, true);

  // 3. AST Shortcut detection
  const badCode = 'export function solve() { return true; }';
  const rBad = engine.scanCode(badCode, 'solver.ts');
  assert.strictEqual(rBad.passed, false);
  assert.ok(rBad.violations.some(v => v.type === 'STATIC_CONSTANT_RETURN'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('4. SpasmBreaker: ERR_IDENTICAL_LOOP & ERR_CYCLIC_CONVERGENCE', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raebyes-breaker-'));
  const breaker = new SpasmCircuitBreaker({ workspaceDir: tmpDir });

  // 1. Identical call loop
  breaker.verifyToolInvocation('read_file', { path: 'src/core.ts' }, 'tree1');
  breaker.verifyToolInvocation('read_file', { path: 'src/core.ts' }, 'tree1');
  const thirdCall = breaker.verifyToolInvocation('read_file', { path: 'src/core.ts' }, 'tree1');
  assert.strictEqual(thirdCall.allowed, false);
  assert.ok(thirdCall.violation?.includes('ERR_IDENTICAL_LOOP'));

  // Breaker tripped to OPEN
  assert.strictEqual(breaker.getProviderState(), 'OPEN');

  breaker.resetAll();
  assert.strictEqual(breaker.getProviderState(), 'CLOSED');

  // 2. Cyclic convergence (A -> B -> A -> B without tree hash change)
  breaker.verifyToolInvocation('toolA', {}, 'hash1');
  breaker.verifyToolInvocation('toolB', {}, 'hash1');
  breaker.verifyToolInvocation('toolA', {}, 'hash1');
  const cyclic = breaker.verifyToolInvocation('toolB', {}, 'hash1');
  assert.strictEqual(cyclic.allowed, false);
  assert.ok(cyclic.violation?.includes('ERR_CYCLIC_CONVERGENCE'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('5. TruthEnforcer & Stop-Hook: RUN-XXXX proof receipts and turn verification', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raebyes-truth-'));
  const srcFile = path.join(tmpDir, 'index.ts');
  fs.writeFileSync(srcFile, 'console.log("hello");', 'utf-8');

  const enforcer = new TruthEnforcer(tmpDir);
  const breaker = new SpasmCircuitBreaker({ workspaceDir: tmpDir });

  // 1. Initial turn check: modified source file without verified run -> blocked!
  const checkInitial = enforcer.verifyTurn(breaker);
  assert.strictEqual(checkInitial.allowed, false);
  assert.ok(checkInitial.reason?.includes('NO_VERIFIED_RUNS'));

  // 2. Execute command and record verified run
  const receipt = enforcer.recordPassingRun('npm test', 'PASSED 10 TESTS', 1500);
  assert.strictEqual(receipt.run_id, 'RUN-0001');
  assert.strictEqual(receipt.status, 'VERIFIED');
  assert.ok(receipt.proof_hmac.length === 64);

  // 3. Turn check now passes!
  const checkAfterRun = enforcer.verifyTurn(breaker);
  assert.strictEqual(checkAfterRun.allowed, true);
  assert.strictEqual(checkAfterRun.latestRunId, 'RUN-0001');

  // 4. Agent mutates file without running tests -> blocked again!
  fs.writeFileSync(srcFile, 'console.log("agent mutated code without running tests");', 'utf-8');
  const checkTamperedTree = enforcer.verifyTurn(breaker);
  assert.strictEqual(checkTamperedTree.allowed, false);
  assert.ok(checkTamperedTree.reason?.includes('UNVERIFIED_MUTATIONS'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('6. Raebyes SDK: .enforced() invariant and variance gates', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raebyes-sdk-'));
  const guard = new Raebyes({ workspaceDir: tmpDir, mode: 'THROW_ERROR' });

  const validSolver = guard.enforced(
    async () => ({ values: [1, 2, 4, 8], untreated_whistles: 15 }),
    { id: 'SOLVER-OK', minVariance: 0.1, invariants: [(res) => res.untreated_whistles >= 12] }
  );
  const res = await validSolver();
  assert.strictEqual(res.untreated_whistles, 15);

  const cheatSolver = guard.enforced(
    async () => ({ values: [0, 0, 0, 0], untreated_whistles: 5 }),
    { id: 'SOLVER-CHEAT', minVariance: 0.1, invariants: [(res) => res.untreated_whistles >= 12] }
  );

  await assert.rejects(async () => {
    await cheatSolver();
  }, RaebyesSpasmError);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('7. McpStdioProxy: Tool call interception and deterministic SPASM error injection', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raebyes-mcp-'));
  const proxy = new McpStdioProxy(tmpDir);

  // Calling preflight check on unread file -> blocked with blind edit
  const targetFile = path.join(tmpDir, 'script.ts');
  fs.writeFileSync(targetFile, 'const a = 1;');

  const res = await proxy.handleToolCall('raebyes_preflight_check', {
    filePath: 'script.ts',
    action: 'PATCH'
  });

  assert.strictEqual(res.isError, true);
  assert.ok(res.content[0].text.includes('[RAEBYES_SPASM_BREACH:'));
  assert.ok(res.content[0].text.includes('BLIND EDIT REJECTED'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('8. AstSlicer: Extracts targeted function, imports, and linked antibodies under token budget', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raebyes-slice-'));
  const testFile = path.join(tmpDir, 'solver.ts');
  const code = `
import { matrixMultiply } from './math.js';
import { StateVector } from './types.js';

export function unrelatedHelper() {
  return 'noisy context that small models should not see';
}

export function solveNavierStokes(input: StateVector): StateVector {
  const step1 = matrixMultiply(input.data);
  return { data: step1, converged: true };
}

export function anotherUnrelatedLargeFunction() {
  return Array.from({ length: 1000 }, (_, i) => i);
}
`;
  fs.writeFileSync(testFile, code, 'utf-8');

  const slicer = new AstSlicer(tmpDir);
  const slice = slicer.sliceSymbol('solver.ts', 'solveNavierStokes');

  assert.strictEqual(slice.symbolName, 'solveNavierStokes');
  assert.ok(slice.code.includes('solveNavierStokes(input: StateVector)'));
  assert.ok(!slice.code.includes('anotherUnrelatedLargeFunction'));
  assert.ok(slice.imports.some((imp: string) => imp.includes('matrixMultiply')));
  assert.ok(slice.tokenEstimate < 350);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('9. StepLockFSM: Enforces 1-function state machine and blocks scope overflow', () => {
  const fsm = new StepLockFSM(true); // Cortex-4B mode enabled
  assert.strictEqual(fsm.getState(), 'REQUIRE_SLICE_READ');

  // Attempt to patch before slicing -> blocked
  const prePatchBlocked = fsm.onPrePatch('src/solver.ts', 1);
  assert.strictEqual(prePatchBlocked.allowed, false);
  assert.ok(prePatchBlocked.reason?.includes('ERR_STEP_LOCK_BLIND_PATCH'));

  // Arm with slice read
  const sliceReport = fsm.onSliceRead('src/solver.ts', 'solveNavierStokes');
  assert.strictEqual(sliceReport.state, 'ALLOW_SINGLE_SYMBOL_PATCH');
  assert.strictEqual(fsm.getState(), 'ALLOW_SINGLE_SYMBOL_PATCH');

  // Attempt multi-function edit (>1 symbol) -> blocked with ERR_SCOPE_OVERFLOW
  const multiBlocked = fsm.onPrePatch('src/solver.ts', 3);
  assert.strictEqual(multiBlocked.allowed, false);
  assert.ok(multiBlocked.reason?.includes('ERR_SCOPE_OVERFLOW'));

  // Attempt cross-file edit -> blocked
  const crossBlocked = fsm.onPrePatch('src/other.ts', 1);
  assert.strictEqual(crossBlocked.allowed, false);
  assert.ok(crossBlocked.reason?.includes('ERR_SCOPE_OVERFLOW'));

  // Valid single function patch -> allowed, transitions to REQUIRE_EXEC_VERIFY
  const validPatch = fsm.onPrePatch('src/solver.ts', 1);
  assert.strictEqual(validPatch.allowed, true);
  assert.strictEqual(fsm.getState(), 'REQUIRE_EXEC_VERIFY');

  // Attempt another patch while verify pending -> blocked
  const secondPatchBlocked = fsm.onPrePatch('src/solver.ts', 1);
  assert.strictEqual(secondPatchBlocked.allowed, false);
  assert.ok(secondPatchBlocked.reason?.includes('ERR_STEP_LOCK_VERIFY_PENDING'));

  // On successful execution verification -> returns to REQUIRE_SLICE_READ
  const verifiedReport = fsm.onExecVerified();
  assert.strictEqual(verifiedReport.state, 'REQUIRE_SLICE_READ');
});

test('10. WorktreeTournament: Best-of-N evaluator rejects shortcuts/syntax errors and selects genuine patch', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raebyes-tourn-test-'));
  const targetFile = path.join(tmpDir, 'algo.js');
  fs.writeFileSync(targetFile, 'function solve() { return 0; }\nmodule.exports = { solve };\n', 'utf-8');

  // Candidates:
  // Candidate 1: Hydrophobia shortcut (TODO: stub, mock return true)
  const candidateShortcut = 'function solve() { return true; /* TODO: stub */ }\nmodule.exports = { solve };\n';
  // Candidate 2: Syntax error
  const candidateBroken = 'function solve() { const = syntax error;\n';
  // Candidate 3: Genuine passing solution with real computation
  const candidateGenuine = `function solve(base = 40) {
  let acc = base;
  for (let i = 0; i < 2; i++) {
    acc += 1;
  }
  return acc;
}
module.exports = { solve };
`;

  const verifyCmd = 'node -e "const { solve } = require(\'./algo.js\'); if (solve() !== 42) process.exit(1);"';

  const tournament = new WorktreeTournament(tmpDir);
  const result = await tournament.runTournament(
    'algo.js',
    [candidateShortcut, candidateBroken, candidateGenuine],
    verifyCmd
  );

  assert.strictEqual(result.status, 'WON');
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.winner?.id, 'CANDIDATE-3');
  assert.strictEqual(result.winner?.passedAntibodies, true);
  assert.strictEqual(result.winner?.passedCompilation, true);

  // Candidate 1 should have failed antibodies/hydrophobia
  assert.strictEqual(result.candidates[0].passedAntibodies, false);
  // Candidate 2 should have failed compilation
  assert.strictEqual(result.candidates[1].passedCompilation, false);

  // Check that algo.js in main working tree was atomically updated to candidate 3
  const finalContent = fs.readFileSync(targetFile, 'utf-8');
  assert.ok(finalContent.includes('return acc;'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('11. GrammarSanitizer & RepairSynthesizer: Repairs malformed JSON and synthesizes 4-line repair specs', () => {
  // GrammarSanitizer tests
  const malformedInput = '```json\n{\n  method: \'tools/call\',\n  arguments: { code: "line1\\nline2", },\n}\n```';
  const sanitized = GrammarSanitizer.sanitizeJson<{ method: string; arguments: { code: string } }>(malformedInput);
  assert.strictEqual(sanitized.success, true);
  assert.strictEqual(sanitized.data?.method, 'tools/call');

  // RepairSynthesizer tests
  const rawTrace = 'AssertionError [ERR_ASSERTION]: Expected: 42 Received: true\n    at solveNavierStokes (d:/PROJECT/src/solver.ts:45:12)';
  const repair = RepairSynthesizer.synthesize(rawTrace, undefined, { file: 'src/solver.ts', symbol: 'solveNavierStokes' });

  assert.ok(repair.formattedBlock.includes('[FAULT_LOCATION]:'));
  assert.ok(repair.formattedBlock.includes('[VIOLATED_INVARIANT]:'));
  assert.ok(repair.formattedBlock.includes('[FORBIDDEN_SHORTCUT]:'));
  assert.ok(repair.formattedBlock.includes('[REQUIRED_FIX_SHAPE]:'));
  assert.ok(repair.faultLocation.includes('src/solver.ts:45 in solveNavierStokes'));
});
