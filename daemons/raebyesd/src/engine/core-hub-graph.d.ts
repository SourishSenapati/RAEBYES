import { DependencyNode, CoreHubGraphReport } from './types.js';
export declare class CoreHubGraph {
    private nodes;
    private rootDir;
    private coreThreshold;
    constructor(rootDir: string, coreThreshold?: number);
    /**
     * Scans workspace recursively and constructs forward & reverse dependency graph
     */
    buildGraph(): Promise<CoreHubGraphReport>;
    /**
     * Retrieves forward and reverse dependencies for a given relative or absolute file path
     */
    getDependenciesFor(targetPath: string): DependencyNode;
    /**
     * Assesses risk when an agent proposes to mutate or delete a file
     */
    assessMutationRisk(targetPath: string, action: 'DELETE' | 'PATCH' | 'TRUNCATE'): {
        allowed: boolean;
        reason?: string;
        isHub: boolean;
        hubId?: string;
        dependentCount: number;
    };
    /**
     * Persists graph lock to .raebyes/graph.lock
     */
    saveLockfile(lockFilePath: string): Promise<void>;
    /**
     * Loads existing lockfile
     */
    loadLockfile(lockFilePath: string): boolean;
    private collectSourceFiles;
    private extractDependencies;
    private resolveModulePath;
}
//# sourceMappingURL=core-hub-graph.d.ts.map