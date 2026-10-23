import * as fs from 'fs';
import * as path from 'path';
import { DependencyNode, CoreHubGraphReport } from './types.js';

export class CoreHubGraph {
  private nodes: Map<string, DependencyNode> = new Map();
  private rootDir: string;
  private coreThreshold = 3;

  constructor(rootDir: string, coreThreshold = 3) {
    this.rootDir = path.resolve(rootDir);
    this.coreThreshold = coreThreshold;
  }

  /**
   * Scans workspace recursively and constructs forward & reverse dependency graph
   */
  public async buildGraph(): Promise<CoreHubGraphReport> {
    this.nodes.clear();
    const allFiles = this.collectSourceFiles(this.rootDir);

    // Initialize all file nodes
    for (const file of allFiles) {
      const relPath = path.relative(this.rootDir, file).replace(/\\/g, '/');
      this.nodes.set(relPath, {
        path: relPath,
        dependencies: [],
        dependents: [],
        isHub: false
      });
    }

    // Extract dependencies from each file
    for (const file of allFiles) {
      const relPath = path.relative(this.rootDir, file).replace(/\\/g, '/');
      const deps = this.extractDependencies(file);
      const node = this.nodes.get(relPath);
      if (node) {
        node.dependencies = deps;
        for (const dep of deps) {
          const targetNode = this.nodes.get(dep);
          if (targetNode && !targetNode.dependents.includes(relPath)) {
            targetNode.dependents.push(relPath);
          }
        }
      }
    }

    // Assign Core Hub status (HUB-0001...)
    let hubIndex = 1;
    const hubs: Array<{ hubId: string; path: string; dependentCount: number; dependents: string[] }> = [];

    for (const [, node] of this.nodes) {
      if (node.dependents.length >= this.coreThreshold) {
        node.isHub = true;
        node.hubId = `HUB-${String(hubIndex++).padStart(4, '0')}`;
        hubs.push({
          hubId: node.hubId,
          path: node.path,
          dependentCount: node.dependents.length,
          dependents: node.dependents
        });
      }
    }

    return {
      timestamp: new Date().toISOString(),
      totalFiles: this.nodes.size,
      hubs
    };
  }

  /**
   * Retrieves forward and reverse dependencies for a given relative or absolute file path
   */
  public getDependenciesFor(targetPath: string): DependencyNode {
    const rel = path.isAbsolute(targetPath)
      ? path.relative(this.rootDir, targetPath).replace(/\\/g, '/')
      : targetPath.replace(/\\/g, '/');

    return (
      this.nodes.get(rel) || {
        path: rel,
        dependencies: [],
        dependents: [],
        isHub: false
      }
    );
  }

  /**
   * Assesses risk when an agent proposes to mutate or delete a file
   */
  public assessMutationRisk(
    targetPath: string,
    action: 'DELETE' | 'PATCH' | 'TRUNCATE'
  ): { allowed: boolean; reason?: string; isHub: boolean; hubId?: string; dependentCount: number } {
    const node = this.getDependenciesFor(targetPath);

    if (node.isHub) {
      if (action === 'DELETE' || action === 'TRUNCATE') {
        return {
          allowed: false,
          isHub: true,
          hubId: node.hubId,
          dependentCount: node.dependents.length,
          reason: `CRITICAL RISK BLOCK: '${node.path}' is registered as Core Hub ${node.hubId} with ${node.dependents.length} dependent modules. Deletion/truncation is forbidden.`
        };
      }

      if (action === 'PATCH') {
        return {
          allowed: true,
          isHub: true,
          hubId: node.hubId,
          dependentCount: node.dependents.length,
          reason: `WARNING: Modifying Core Hub ${node.hubId} (${node.path}). Must pass full regression and AST assertions.`
        };
      }
    }

    return {
      allowed: true,
      isHub: false,
      dependentCount: node.dependents.length
    };
  }

  /**
   * Persists graph lock to .raebyes/graph.lock
   */
  public async saveLockfile(lockFilePath: string): Promise<void> {
    const report = await this.buildGraph();
    const dir = path.dirname(lockFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(lockFilePath, JSON.stringify(report, null, 2), 'utf-8');
  }

  /**
   * Loads existing lockfile
   */
  public loadLockfile(lockFilePath: string): boolean {
    if (!fs.existsSync(lockFilePath)) return false;
    try {
      const data: CoreHubGraphReport = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8'));
      this.nodes.clear();
      for (const hub of data.hubs) {
        this.nodes.set(hub.path, {
          path: hub.path,
          dependencies: [],
          dependents: hub.dependents,
          isHub: true,
          hubId: hub.hubId
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  private collectSourceFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === '.raebyes' ||
          entry.name === 'dist' ||
          entry.name === '__pycache__' ||
          entry.name === '.venv'
        ) {
          continue;
        }
        results.push(...this.collectSourceFiles(full));
      } else if (entry.isFile()) {
        if (/\.(ts|js|mjs|cjs|py|tsx|jsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
          results.push(full);
        }
      }
    }
    return results;
  }

  private extractDependencies(filePath: string): string[] {
    const deps: string[] = [];
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const fileDir = path.dirname(filePath);

      // JS/TS import / require extraction
      const jsImportRegex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?|export\s+(?:[\w*\s{},]*\s+from\s+)?|require\s*\(\s*)['"]([^'"]+)['"]/g;
      let match;
      while ((match = jsImportRegex.exec(content)) !== null) {
        const importSpecifier = match[1];
        if (importSpecifier.startsWith('.')) {
          const resolved = this.resolveModulePath(fileDir, importSpecifier);
          if (resolved) {
            deps.push(path.relative(this.rootDir, resolved).replace(/\\/g, '/'));
          }
        }
      }

      // Python import extraction
      const pyImportRegex = /^(?:from\s+(\.+[a-zA-Z0-9_.]*|[a-zA-Z0-9_.]+)\s+import|import\s+([a-zA-Z0-9_.]+))/gm;
      while ((match = pyImportRegex.exec(content)) !== null) {
        const mod = match[1] || match[2];
        if (mod && mod.startsWith('.')) {
          // Relative Python import
          const pyPath = path.resolve(fileDir, mod.replace(/\./g, '/') + '.py');
          if (fs.existsSync(pyPath)) {
            deps.push(path.relative(this.rootDir, pyPath).replace(/\\/g, '/'));
          }
        }
      }
    } catch {
      // Ignore read errors
    }
    return deps;
  }

  private resolveModulePath(dir: string, specifier: string): string | null {
    const direct = path.resolve(dir, specifier);
    const candidates = [
      direct,
      `${direct}.ts`,
      `${direct}.js`,
      `${direct}.tsx`,
      `${direct}.jsx`,
      path.join(direct, 'index.ts'),
      path.join(direct, 'index.js')
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        return cand;
      }
    }
    return null;
  }
}
