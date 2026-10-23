import * as fs from 'fs';
import * as path from 'path';
import { SpasmCircuitBreaker } from './spasm-breaker.js';

export class VaultHealer {
  private workspaceDir: string;
  private goldenSnapshots: Map<string, string> = new Map();
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private breaker?: SpasmCircuitBreaker;
  private isHealing = false;

  constructor(workspaceDir: string, breaker?: SpasmCircuitBreaker) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.breaker = breaker;
  }

  public getProtectedRelativePaths(): string[] {
    return [
      '.raebyes/antibodies.json',
      '.raebyes/raebyes.conf',
      '.gemini/settings.json',
      '.claude/settings.json',
      '.cursor/mcp.json',
      '.agent/rules/raebyes-hydrophobia.md'
    ];
  }

  /**
   * Initializes in-memory golden snapshots and attaches real-time fs.watchers
   */
  public armVault(): void {
    const relPaths = this.getProtectedRelativePaths();

    for (const rel of relPaths) {
      const full = path.join(this.workspaceDir, rel);
      if (fs.existsSync(full)) {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          this.goldenSnapshots.set(rel, content);
          this.watchFile(rel, full);
        } catch {
          // Skip if unable to read
        }
      }
    }
  }

  /**
   * Explicitly updates golden snapshot when an authorized command runs (e.g., immunize)
   */
  public authorizeMutation(relPath: string, newContent: string): void {
    const normalized = relPath.replace(/\\/g, '/');
    this.goldenSnapshots.set(normalized, newContent);
    const full = path.join(this.workspaceDir, normalized);
    this.isHealing = true;
    try {
      const dir = path.dirname(full);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(full, newContent, 'utf-8');
    } finally {
      setTimeout(() => {
        this.isHealing = false;
      }, 50);
    }
  }

  private watchFile(relPath: string, fullPath: string): void {
    if (this.watchers.has(relPath)) return;

    try {
      const watcher = fs.watch(fullPath, (eventType) => {
        if (this.isHealing) return;

        const snapshot = this.goldenSnapshots.get(relPath);
        if (!snapshot) return;

        let needsHeal = false;
        try {
          if (!fs.existsSync(fullPath)) {
            needsHeal = true;
          } else {
            const current = fs.readFileSync(fullPath, 'utf-8');
            if (current !== snapshot) {
              needsHeal = true;
            }
          }
        } catch {
          needsHeal = true;
        }

        if (needsHeal) {
          this.isHealing = true;
          const start = Date.now();
          try {
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, snapshot, 'utf-8');
            const elapsed = Date.now() - start;

            console.error(`\n[VAULT HEALER TRIGGERED] Unauthorized modification to protected vault file: ${relPath}`);
            console.error(`Restored from in-memory golden snapshot in ${elapsed}ms.`);

            if (this.breaker) {
              this.breaker.recordBreach('GOVERNANCE_TAMPERING', `Unauthorized tampering of ${relPath}. Restored in ${elapsed}ms.`, {
                file: relPath,
                restorationTimeMs: elapsed
              });
              this.breaker.tripAll(`Tampering detected on ${relPath}`);
            }
          } catch (err) {
            console.error(`[VAULT HEALER ERROR] Failed to heal ${relPath}: ${err}`);
          } finally {
            setTimeout(() => {
              this.isHealing = false;
            }, 50);
          }
        }
      });

      this.watchers.set(relPath, watcher);
    } catch {
      // Ignore if file cannot be watched directly
    }
  }

  public disarm(): void {
    for (const [, w] of this.watchers) {
      try {
        w.close();
      } catch {
        // Ignore
      }
    }
    this.watchers.clear();
  }
}
