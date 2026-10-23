import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AntibodyEntry, RunReceipt } from './types.js';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const HMAC_SECRET = process.env.RAEBYES_SECRET || 'RAEBYES_DETERMINISTIC_PROOF_KEY_2026';

export class AntibodyLedger {
  private ledgerPath: string;
  private runsLockPath: string;

  constructor(workspaceDir: string) {
    const raebyesDir = path.join(path.resolve(workspaceDir), '.raebyes');
    this.ledgerPath = path.join(raebyesDir, 'antibodies.json');
    this.runsLockPath = path.join(raebyesDir, 'runs.lock');
  }

  public getLedgerPath(): string {
    return this.ledgerPath;
  }

  public getRunsLockPath(): string {
    return this.runsLockPath;
  }

  public static computeEntryHash(
    id: string,
    timestamp: string,
    component: string,
    false_claim: string,
    underlying_flaw: string,
    rejection_pattern: string,
    prev_hash: string
  ): string {
    const payload = `${id}${timestamp}${component}${false_claim}${underlying_flaw}${rejection_pattern}${prev_hash}`;
    return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  }

  public readEntries(): AntibodyEntry[] {
    if (!fs.existsSync(this.ledgerPath)) {
      return [];
    }
    try {
      const content = fs.readFileSync(this.ledgerPath, 'utf-8');
      const data = JSON.parse(content);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      throw new Error(`Corrupted antibodies ledger at ${this.ledgerPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public verifyLedgerIntegrity(): { valid: boolean; totalEntries: number; brokenAt?: string; reason?: string } {
    const entries = this.readEntries();
    if (entries.length === 0) {
      return { valid: true, totalEntries: 0 };
    }

    let expectedPrevHash = GENESIS_HASH;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (entry.prev_hash !== expectedPrevHash) {
        return {
          valid: false,
          totalEntries: entries.length,
          brokenAt: entry.id,
          reason: `Invalid prev_hash at entry ${entry.id}. Expected ${expectedPrevHash.slice(0, 8)}..., got ${entry.prev_hash.slice(0, 8)}...`
        };
      }

      const calculated = AntibodyLedger.computeEntryHash(
        entry.id,
        entry.timestamp,
        entry.component,
        entry.false_claim,
        entry.underlying_flaw,
        entry.rejection_pattern,
        entry.prev_hash
      );

      if (entry.hash !== calculated) {
        return {
          valid: false,
          totalEntries: entries.length,
          brokenAt: entry.id,
          reason: `Tampered hash at entry ${entry.id}. Calculated ${calculated.slice(0, 8)}..., got ${entry.hash.slice(0, 8)}...`
        };
      }

      expectedPrevHash = entry.hash;
    }

    return { valid: true, totalEntries: entries.length };
  }

  public appendAntibody(params: {
    component: string;
    false_claim: string;
    underlying_flaw: string;
    rejection_pattern: string;
  }): AntibodyEntry {
    const verification = this.verifyLedgerIntegrity();
    if (!verification.valid) {
      throw new Error(`CONTAINMENT_BREACH: Cannot append to tampered ledger broken at ${verification.brokenAt}: ${verification.reason}`);
    }

    const entries = this.readEntries();
    const lastHash = entries.length > 0 ? entries[entries.length - 1].hash : GENESIS_HASH;
    const nextIndex = entries.length + 1;
    const nextId = `ABY-${String(nextIndex).padStart(4, '0')}`;
    const timestamp = new Date().toISOString();

    const hash = AntibodyLedger.computeEntryHash(
      nextId,
      timestamp,
      params.component,
      params.false_claim,
      params.underlying_flaw,
      params.rejection_pattern,
      lastHash
    );

    const newEntry: AntibodyEntry = {
      id: nextId,
      timestamp,
      component: params.component,
      false_claim: params.false_claim,
      underlying_flaw: params.underlying_flaw,
      rejection_pattern: params.rejection_pattern,
      prev_hash: lastHash,
      hash
    };

    entries.push(newEntry);

    const dir = path.dirname(this.ledgerPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tempFile = `${this.ledgerPath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(entries, null, 2), 'utf-8');
    fs.renameSync(tempFile, this.ledgerPath);

    return newEntry;
  }

  // --- RUNS.LOCK RECEIPTS ---
  public readRunReceipts(): RunReceipt[] {
    if (!fs.existsSync(this.runsLockPath)) return [];
    try {
      const content = fs.readFileSync(this.runsLockPath, 'utf-8');
      const data = JSON.parse(content);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  public appendRunReceipt(params: {
    command: string;
    tree_hash: string;
    stdout_hash: string;
    duration_ms: number;
    status: 'VERIFIED' | 'FAILED';
  }): RunReceipt {
    const receipts = this.readRunReceipts();
    const nextIndex = receipts.length + 1;
    const runId = `RUN-${String(nextIndex).padStart(4, '0')}`;
    const timestamp = new Date().toISOString();

    // Mint HMAC_SHA256(run_id + tree_hash + stdout_hash)
    const proofHmac = crypto
      .createHmac('sha256', HMAC_SECRET)
      .update(`${runId}${params.tree_hash}${params.stdout_hash}`)
      .digest('hex');

    const receipt: RunReceipt = {
      run_id: runId,
      timestamp,
      command: params.command,
      tree_hash: params.tree_hash,
      stdout_hash: params.stdout_hash,
      duration_ms: params.duration_ms,
      proof_hmac: proofHmac,
      status: params.status
    };

    receipts.push(receipt);

    const dir = path.dirname(this.runsLockPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const temp = `${this.runsLockPath}.tmp.${Date.now()}`;
    fs.writeFileSync(temp, JSON.stringify(receipts, null, 2), 'utf-8');
    fs.renameSync(temp, this.runsLockPath);

    return receipt;
  }

  public getLatestVerifiedReceipt(): RunReceipt | null {
    const receipts = this.readRunReceipts();
    for (let i = receipts.length - 1; i >= 0; i--) {
      if (receipts[i].status === 'VERIFIED') {
        return receipts[i];
      }
    }
    return null;
  }
}
