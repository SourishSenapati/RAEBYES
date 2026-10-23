export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface AntibodyEntry {
  id: string; // e.g. ABY-0001
  timestamp: string; // ISO-8601
  component: string;
  false_claim: string;
  underlying_flaw: string;
  rejection_pattern: string; // Regex or JS expression string
  prev_hash: string; // 64-char hex (0000... for genesis)
  hash: string; // SHA256(id + timestamp + component + rejection_pattern + prev_hash)
}

export interface RunReceipt {
  run_id: string; // RUN-0001
  timestamp: string;
  command: string;
  tree_hash: string; // SHA256 of all tracked source files
  stdout_hash: string;
  duration_ms: number;
  proof_hmac: string; // HMAC_SHA256(run_id + tree_hash + stdout_hash)
  status: 'VERIFIED' | 'FAILED';
}

export interface BreachRecord {
  id: string; // BREACH-XXXX
  timestamp: string;
  layer: 'PRE_FLIGHT' | 'HYDROPHOBIA' | 'VARIANCE' | 'CIRCUIT_BREAKER' | 'HUB_LOCK' | 'LIE_DETECTOR' | 'GOVERNANCE_TAMPERING';
  reason: string;
  details: Record<string, unknown>;
  fatalExitCode: number; // 137
}

export interface HydrophobiaViolation {
  file: string;
  line?: number;
  type: 
    | 'DELETED_TEST_ASSERTION'
    | 'STATIC_CONSTANT_RETURN'
    | 'EMPTY_FUNCTION_BODY'
    | 'SHORTCUT_MOCK_DETECTED'
    | 'LINEAR_APPROXIMATION_STUB'
    | 'ERR_BLIND_EDIT'
    | 'ANTIBODY_VIOLATION';
  message: string;
  snippet?: string;
  severity: 'CRITICAL' | 'FATAL';
}

export interface HydrophobiaReport {
  passed: boolean;
  violations: HydrophobiaViolation[];
  scannedFiles: number;
  timestamp: string;
}

export interface VarianceCheckOptions {
  minVariance?: number;
  minExecutionTimeMs?: number;
  expectedDimensions?: number[];
  disallowZeros?: boolean;
}

export interface VarianceCheckResult {
  passed: boolean;
  mean: number;
  variance: number;
  stdDev: number;
  executionTimeMs?: number;
  violations: string[];
}

export interface DependencyNode {
  path: string;
  dependencies: string[];
  dependents: string[];
  isHub: boolean;
  hubId?: string;
}

export interface CoreHubGraphReport {
  timestamp: string;
  totalFiles: number;
  hubs: Array<{
    hubId: string;
    path: string;
    dependentCount: number;
    dependents: string[];
  }>;
}

export interface ToolCallLog {
  toolName: string;
  argsHash: string;
  timestamp: number;
  treeHash?: string;
}
