import * as path from 'path';

export interface FreshnessAssessment {
  allowed: boolean;
  riskLevel: 'NONE' | 'MEDIUM' | 'HIGH';
  lastReadElapsedSec?: number;
  message?: string;
}

export class FreshnessLock {
  private scriptReadTimes: Map<string, number> = new Map();
  private freshnessThresholdSec: number;

  constructor(freshnessThresholdSec = 120) {
    this.freshnessThresholdSec = freshnessThresholdSec;
  }

  public recordRead(filePath: string): void {
    const normalized = path.normalize(filePath).replace(/\\/g, '/');
    this.scriptReadTimes.set(normalized, Date.now());
  }

  public assessPatchRisk(filePath: string): FreshnessAssessment {
    const normalized = path.normalize(filePath).replace(/\\/g, '/');
    const lastRead = this.scriptReadTimes.get(normalized);

    // 1. Never read in this session
    if (!lastRead) {
      return {
        allowed: false,
        riskLevel: 'HIGH',
        message: `HIGH RISK BLOCK: Script '${normalized}' has not been read in this session. Blind file patching is strictly forbidden. Invoke read tool first.`
      };
    }

    // 2. Read time exceeded threshold (e.g. > 120s)
    const elapsedSec = (Date.now() - lastRead) / 1000;
    if (elapsedSec > this.freshnessThresholdSec) {
      return {
        allowed: false,
        riskLevel: 'MEDIUM',
        lastReadElapsedSec: elapsedSec,
        message: `MEDIUM RISK BLOCK: Script '${normalized}' was read ${elapsedSec.toFixed(0)}s ago (threshold: ${this.freshnessThresholdSec}s). Content may be stale due to external modifications. Re-read before patching.`
      };
    }

    return {
      allowed: true,
      riskLevel: 'NONE',
      lastReadElapsedSec: elapsedSec
    };
  }

  public reset(): void {
    this.scriptReadTimes.clear();
  }
}
