import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface AntibodyEntry {
  id: string; // e.g. ABY-0001
  timestamp: string;
  description: string;
  assertionType: 'PREDICATE_JS' | 'SHELL_EXIT' | 'AST_RULE' | 'VARIANCE_RULE';
  rejection_assertion: string;
  context?: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export interface LedgerVerificationResult {
  valid: boolean;
  totalEntries: number;
  brokenAt?: string;
  reason?: string;
}

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export class AntibodyLedger {
  private filePath: string;

  constructor(ledgerPath: string) {
    this.filePath = path.resolve(ledgerPath);
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public static computeEntryHash(
    id: string,
    timestamp: string,
    description: string,
    assertionType: string,
    rejection_assertion: string,
    prev_hash: string
  ): string {
    const payload = `${id}|${timestamp}|${description}|${assertionType}|${rejection_assertion}|${prev_hash}`;
    return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  }

  public readEntries(): AntibodyEntry[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(content);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      throw new Error(`Corrupted antibodies ledger at ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public verify(): LedgerVerificationResult {
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

      const calculatedHash = AntibodyLedger.computeEntryHash(
        entry.id,
        entry.timestamp,
        entry.description,
        entry.assertionType,
        entry.rejection_assertion,
        entry.prev_hash
      );

      if (entry.hash !== calculatedHash) {
        return {
          valid: false,
          totalEntries: entries.length,
          brokenAt: entry.id,
          reason: `Tampered hash at entry ${entry.id}. Calculated ${calculatedHash.slice(0, 8)}..., got ${entry.hash.slice(0, 8)}...`
        };
      }

      expectedPrevHash = entry.hash;
    }

    return {
      valid: true,
      totalEntries: entries.length
    };
  }

  public append(params: {
    description: string;
    assertionType: AntibodyEntry['assertionType'];
    rejection_assertion: string;
    context?: Record<string, unknown>;
  }): AntibodyEntry {
    const verification = this.verify();
    if (!verification.valid) {
      throw new Error(`Cannot append to tampered ledger! Hash chain is broken at ${verification.brokenAt}: ${verification.reason}`);
    }

    const entries = this.readEntries();
    const lastHash = entries.length > 0 ? entries[entries.length - 1].hash : GENESIS_HASH;
    const nextIndex = entries.length + 1;
    const nextId = `ABY-${String(nextIndex).padStart(4, '0')}`;
    const timestamp = new Date().toISOString();

    const hash = AntibodyLedger.computeEntryHash(
      nextId,
      timestamp,
      params.description,
      params.assertionType,
      params.rejection_assertion,
      lastHash
    );

    const newEntry: AntibodyEntry = {
      id: nextId,
      timestamp,
      description: params.description,
      assertionType: params.assertionType,
      rejection_assertion: params.rejection_assertion,
      context: params.context,
      prev_hash: lastHash,
      hash
    };

    entries.push(newEntry);

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Atomic write
    const tempFile = `${this.filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(entries, null, 2), 'utf-8');
    fs.renameSync(tempFile, this.filePath);

    return newEntry;
  }
}
