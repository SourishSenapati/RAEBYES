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
  VaultHealer
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
