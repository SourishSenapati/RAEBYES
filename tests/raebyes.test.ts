import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { AntibodyLedger } from '../packages/sdk-js/dist/ledger.js';
import { Raebyes, RaebyesSpasmError, RaebyesTamperError } from '../packages/sdk-js/dist/index.js';
import { HydrophobiaEngine } from '../daemons/raebyesd/dist/engine/hydrophobia.js';
import { VarianceGuard } from '../daemons/raebyesd/dist/engine/variance-guard.js';
import { CoreHubGraph } from '../daemons/raebyesd/dist/engine/core-hub-graph.js';
import { SpasmCircuitBreaker } from '../daemons/raebyesd/dist/engine/spasm-breaker.js';
import { FreshnessLock } from '../packages/mcp-interceptor/dist/freshness-lock.js';

test('1. AntibodyLedger: Hash-chaining and tamper detection', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raebyes-ledger-test-'));
  const ledgerPath = path.join(tmpDir, 'antibodies.json');
  const ledger = new AntibodyLedger(ledgerPath);

  // Initial state is empty and valid
  const v0 = ledger.verify();
  assert.strictEqual(v0.valid, true);
  assert.strictEqual(v0.totalEntries, 0);

  // Append entry 1
  const e1 = ledger.append({
    description: 'Reject instant approximations',
    assertionType: 'PREDICATE_JS',
    rejection_assertion: 'return res.executionTimeMs > 100;'
  });
  assert.strictEqual(e1.id, 'ABY-0001');
  assert.strictEqual(e1.prev_hash, '0000000000000000000000000000000000000000000000000000000000000000');
  assert.ok(e1.hash.length === 64);

  // Append entry 2
  const e2 = ledger.append({
    description: 'Reject flat zero tensors',
    assertionType: 'VARIANCE_RULE',
    rejection_assertion: 'return res.variance > 0;'
  });
  assert.strictEqual(e2.id, 'ABY-0002');
  assert.strictEqual(e2.prev_hash, e1.hash);

  // Verify chain passes
  const v1 = ledger.verify();
  assert.strictEqual(v1.valid, true);
  assert.strictEqual(v1.totalEntries, 2);

  // Tamper with entry 1: modify description without recalculating hash
  const entries = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
  entries[0].description = 'Agent tampered with this failure rule!';
  fs.writeFileSync(ledgerPath, JSON.stringify(entries, null, 2), 'utf-8');

  // Verify should detect breach at ABY-0001
  const vTamper = ledger.verify();
  assert.strictEqual(vTamper.valid, false);
  assert.strictEqual(vTamper.brokenAt, 'ABY-0001');

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('2. HydrophobiaEngine: AST shortcut and deleted assertion detection', () => {
  const engine = new HydrophobiaEngine();

  // Test static constant return in TypeScript
  const badTsCode = `
    export function solveComplexPde(matrix: number[][]): boolean {
      return true; // Agent synthetic shortcut
    }
  `;
  const r1 = engine.scanCode(badTsCode, 'solver.ts');
  assert.strictEqual(r1.passed, false);
  assert.ok(r1.violations.some(v => v.type === 'STATIC_CONSTANT_RETURN'));

  // Test empty function body
  const emptyFnCode = `
    export function runSimulation() {
    }
  `;
  const r2 = engine.scanCode(emptyFnCode, 'sim.ts');
  assert.strictEqual(r2.passed, false);
  assert.ok(r2.violations.some(v => v.type === 'EMPTY_FUNCTION_BODY'));

  // Test keyword shortcut
  const shortcutCode = `
    const mock = jest.fn().mockReturnValue(true);
    // TODO: implement real solver later
  `;
  const r3 = engine.scanCode(shortcutCode, 'test.ts');
  assert.strictEqual(r3.passed, false);
  assert.ok(r3.violations.some(v => v.type === 'SHORTCUT_MOCK_DETECTED'));

  // Test diff scanning for deleted test assertions
  const diffWithDeletedAssertion = `
--- a/test/solver.test.ts
+++ b/test/solver.test.ts
@@ -10,3 +10,1 @@
- expect(solver.run()).toBe(42);
- assert.strictEqual(result.energy, 100);
+ console.log("bypassed");
  `;
  const diffReport = engine.scanDiff(diffWithDeletedAssertion);
  assert.strictEqual(diffReport.passed, false);
  assert.ok(diffReport.violations.some(v => v.type === 'DELETED_TEST_ASSERTION'));

  // Clean code should pass
  const cleanCode = `
    export function calculate(a: number, b: number): number {
      const sum = a + b;
      return sum * 2;
    }
  `;
  const rClean = engine.scanCode(cleanCode, 'math.ts');
  assert.strictEqual(rClean.passed, true);
  assert.strictEqual(rClean.violations.length, 0);
});

test('3. VarianceGuard: Flat tensor and execution time enforcement', () => {
  const guard = new VarianceGuard();

  // Test flat array (all 0.0) -> variance is 0
  const flatArray = [0.0, 0.0, 0.0, 0.0, 0.0];
  const rFlat = guard.verify(flatArray, 1000, { minVariance: 1e-4 });
  assert.strictEqual(rFlat.passed, false);
  assert.strictEqual(rFlat.variance, 0);

  // Test array with NaN
  const nanArray = [1.0, 2.0, NaN, 4.0];
  const rNaN = guard.verify(nanArray, 1000);
  assert.strictEqual(rNaN.passed, false);
  assert.ok(rNaN.violations.some(v => v.includes('NaN')));

  // Test suspiciously instant execution time (finished in 12ms, minimum was 5000ms)
  const validNumbers = [10.5, 20.3, 15.2, 33.1, 8.4];
  const rInstant = guard.verify(validNumbers, 12, { minExecutionTimeMs: 5000 });
  assert.strictEqual(rInstant.passed, false);
  assert.ok(rInstant.violations.some(v => v.includes('suspiciously instant')));

  // Test legitimate simulation output with sufficient variance and runtime
  const rValid = guard.verify(validNumbers, 5500, { minExecutionTimeMs: 5000, minVariance: 1e-4 });
  assert.strictEqual(rValid.passed, true);
  assert.ok(rValid.variance > 0);
  assert.strictEqual(rValid.violations.length, 0);
});

test('4. CoreHubGraph: Reverse-dependency topology lock', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raebyes-graph-test-'));

  // Create core hub file: core-lib.ts
  fs.writeFileSync(path.join(tmpDir, 'core-lib.ts'), 'export const core = 42;');

  // Create 3 dependent files importing core-lib.ts
  fs.writeFileSync(path.join(tmpDir, 'mod-a.ts'), "import { core } from './core-lib';");
  fs.writeFileSync(path.join(tmpDir, 'mod-b.ts'), "import { core } from './core-lib';");
  fs.writeFileSync(path.join(tmpDir, 'mod-c.ts'), "import { core } from './core-lib';");

  const graph = new CoreHubGraph(tmpDir, 3);
  const report = await graph.buildGraph();

  assert.strictEqual(report.hubs.length, 1);
  assert.strictEqual(report.hubs[0].path, 'core-lib.ts');
  assert.strictEqual(report.hubs[0].dependentCount, 3);

  // Attempting to delete Core Hub should be forbidden
  const deleteRisk = graph.assessMutationRisk('core-lib.ts', 'DELETE');
  assert.strictEqual(deleteRisk.allowed, false);
  assert.strictEqual(deleteRisk.isHub, true);
  assert.ok(deleteRisk.reason?.includes('CRITICAL RISK BLOCK'));

  // Non-hub file deletion should be allowed
  const nonHubRisk = graph.assessMutationRisk('mod-a.ts', 'DELETE');
  assert.strictEqual(nonHubRisk.allowed, true);
  assert.strictEqual(nonHubRisk.isHub, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('5. SpasmCircuitBreaker: 3-state machine and trajectory logging', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raebyes-breaker-test-'));
  const breaker = new SpasmCircuitBreaker({
    workspaceDir: tmpDir,
    providerFailureThreshold: 2,
    providerWindowSec: 60,
    probeTimeoutSec: 1
  });

  // Initial state CLOSED
  assert.strictEqual(breaker.getProviderState(), 'CLOSED');

  // Trigger 2 failures to trip circuit
  breaker.recordProviderFailure();
  breaker.recordProviderFailure();
  assert.strictEqual(breaker.getProviderState(), 'OPEN');

  // Breaker logs trajectory breach
  const breach = breaker.recordBreach('VARIANCE', 'Test breach', { metric: 0 });
  assert.ok(breach.id.startsWith('BREACH-'));

  const breachFile = path.join(tmpDir, '.raebyes', 'trajectories', `${breach.id}.json`);
  assert.strictEqual(fs.existsSync(breachFile), true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('6. FreshnessLock: Stale read interception', () => {
  const lock = new FreshnessLock(2); // 2 second threshold for testing

  // File never read -> HIGH risk block
  const r1 = lock.assessPatchRisk('src/solver.ts');
  assert.strictEqual(r1.allowed, false);
  assert.strictEqual(r1.riskLevel, 'HIGH');

  // Record read -> allowed
  lock.recordRead('src/solver.ts');
  const r2 = lock.assessPatchRisk('src/solver.ts');
  assert.strictEqual(r2.allowed, true);
  assert.strictEqual(r2.riskLevel, 'NONE');
});

test('7. Raebyes SDK: .enforced() runtime wrapper in THROW_ERROR mode', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raebyes-sdk-test-'));
  const raebyesDir = path.join(tmpDir, '.raebyes');
  fs.mkdirSync(raebyesDir, { recursive: true });
  fs.writeFileSync(path.join(raebyesDir, 'antibodies.json'), '[]', 'utf-8');

  const guard = new Raebyes({ workspaceDir: tmpDir, mode: 'THROW_ERROR' });

  // Legitimate solver
  const validSolver = guard.enforced(
    async (x: number) => {
      return { output: [x, x * 2, x * 3], untreated_whistles: 15 };
    },
    {
      id: 'SIM-TEST-01',
      minVariance: 0.1,
      invariants: [
        (res) => res.untreated_whistles >= 12
      ]
    }
  );

  const res = await validSolver(10);
  assert.strictEqual(res.untreated_whistles, 15);

  // Invariant failure solver
  const cheatingSolver = guard.enforced(
    async () => {
      // Agent hardcoded 5 untreated whistles
      return { output: [0, 0, 0], untreated_whistles: 5 };
    },
    {
      id: 'SIM-CHEAT-01',
      minVariance: 0.1,
      invariants: [
        (res) => res.untreated_whistles >= 12
      ]
    }
  );

  await assert.rejects(
    async () => {
      await cheatingSolver();
    },
    (err: unknown) => {
      assert.ok(err instanceof RaebyesSpasmError);
      assert.ok((err as RaebyesSpasmError).violations.length >= 1);
      assert.ok((err as RaebyesSpasmError).violations.some(v => v.includes('Invariant')));
      return true;
    }
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
