import * as path from 'path';
import * as child_process from 'child_process';
import { ErrorInjector } from './error-injector.js';
import {
  HydrophobiaEngine,
  VarianceGuard,
  CoreHubGraph,
  SpasmCircuitBreaker,
  AntibodyLedger,
  TruthEnforcer
} from '@raebyes/daemon';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
  error?: {
    code: number;
    message: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any;
  };
}

export class McpStdioProxy {
  private workspaceDir: string;
  private hydrophobia: HydrophobiaEngine;
  private varianceGuard: VarianceGuard;
  private coreHubGraph: CoreHubGraph;
  private breaker: SpasmCircuitBreaker;
  private ledger: AntibodyLedger;
  private truthEnforcer: TruthEnforcer;
  private childMcpProcess: child_process.ChildProcess | null = null;

  constructor(workspaceDir = process.cwd(), childCommand?: string[]) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.hydrophobia = new HydrophobiaEngine();
    this.varianceGuard = new VarianceGuard();
    this.coreHubGraph = new CoreHubGraph(this.workspaceDir);
    this.breaker = new SpasmCircuitBreaker({ workspaceDir: this.workspaceDir });
    this.ledger = new AntibodyLedger(this.workspaceDir);
    this.truthEnforcer = new TruthEnforcer(this.workspaceDir);

    const lockPath = path.join(this.workspaceDir, '.raebyes', 'graph.lock');
    this.coreHubGraph.loadLockfile(lockPath);

    if (childCommand && childCommand.length > 0) {
      this.spawnChildMcp(childCommand);
    }
  }

  private spawnChildMcp(commandArgs: string[]): void {
    const cmd = commandArgs[0];
    const args = commandArgs.slice(1);
    this.childMcpProcess = child_process.spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      shell: true,
      cwd: this.workspaceDir
    });

    this.childMcpProcess.on('error', (err) => {
      console.error(`[RAEBYES MCP] Child MCP process error: ${err.message}`);
    });
  }

  public getNativeToolDefinitions() {
    return [
      {
        name: 'raebyes_preflight_check',
        description: 'Run pre-flight validation on proposed file modification, checking freshness and Core Hub reverse-dependency locks.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Target file path relative to workspace root' },
            action: { type: 'string', enum: ['PATCH', 'DELETE', 'TRUNCATE'], description: 'Proposed mutation action' }
          },
          required: ['filePath', 'action']
        }
      },
      {
        name: 'raebyes_scan_diff',
        description: 'AST & diff scan to detect deleted test assertions, empty function bodies, static return stubs, or mock shortcuts.',
        inputSchema: {
          type: 'object',
          properties: {
            diffText: { type: 'string', description: 'Git unified diff text of proposed changes' },
            code: { type: 'string', description: 'Full source code after proposed patch' },
            filename: { type: 'string', description: 'Filename being patched' },
            originalCode: { type: 'string', description: 'Original source code before patch' }
          }
        }
      },
      {
        name: 'raebyes_verify_variance',
        description: 'Validate numerical tensor/simulation output variance and minimum execution time to reject flat or fake approximations.',
        inputSchema: {
          type: 'object',
          properties: {
            output: { description: 'Numerical array, matrix, tensor, or object to inspect' },
            executionTimeMs: { type: 'number', description: 'Measured execution time in milliseconds' },
            minVariance: { type: 'number', description: 'Minimum allowed variance' },
            minExecutionTimeMs: { type: 'number', description: 'Minimum required computation time in milliseconds' }
          },
          required: ['output']
        }
      },
      {
        name: 'raebyes_record_read',
        description: 'Register that the agent has read a script in this session to satisfy the temporal freshness lock before patching.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'File path that was read' }
          },
          required: ['filePath']
        }
      },
      {
        name: 'raebyes_record_failure',
        description: 'Append an immutable, hash-chained failure antibody (ABY-XXXX) to the governance ledger.',
        inputSchema: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Human-readable description of failure pattern' },
            pattern: { type: 'string', description: 'Regex or JS rejection pattern' },
            component: { type: 'string', default: 'core' }
          },
          required: ['description', 'pattern']
        }
      },
      {
        name: 'raebyes_verify_turn',
        description: 'Verify that current workspace state matches a passing RUN-XXXX execution receipt before concluding turn.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'raebyes_status',
        description: 'Query current RAEBYES circuit breaker status, Core Hub files, and active antibody rules.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async handleToolCall(name: string, args: any) {
    const currentTreeHash = this.truthEnforcer.computeWorkingTreeHash();

    // 1. Check Circuit Breaker loop and tool permission
    const breakerCheck = this.breaker.verifyToolInvocation(name, args || {}, currentTreeHash);
    if (!breakerCheck.allowed) {
      const breach = this.breaker.recordBreach('CIRCUIT_BREAKER', breakerCheck.violation || 'Loop tripped', { name, args });
      return this.formatSpasmBreach(breach.id, breakerCheck.violation || 'Circuit breaker tripped');
    }

    // 2. Intercept Known Read Tools to track freshness
    if (['read_file', 'get_script', 'view_file', 'read_resource'].includes(name)) {
      const target = args?.filePath || args?.path || args?.AbsolutePath || args?.TargetFile;
      if (typeof target === 'string') {
        this.hydrophobia.recordRead(target);
      }
    }

    // 3. Intercept Known Mutating Tools
    if (['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'patch', 'edit_file'].includes(name)) {
      const target = args?.TargetFile || args?.filePath || args?.path;
      if (typeof target === 'string') {
        // Freshness check
        const fresh = this.hydrophobia.checkFreshness(target, this.workspaceDir);
        if (!fresh.allowed) {
          const breach = this.breaker.recordBreach('PRE_FLIGHT', fresh.violation?.message || 'ERR_BLIND_EDIT', { target, args });
          return this.formatSpasmBreach(breach.id, fresh.violation?.message || 'ERR_BLIND_EDIT');
        }

        // Core Hub lock check
        const hubRisk = this.coreHubGraph.assessMutationRisk(target, 'PATCH');
        if (!hubRisk.allowed) {
          const breach = this.breaker.recordBreach('HUB_LOCK', hubRisk.reason || 'Core Hub lock block', { target, hubId: hubRisk.hubId });
          return this.formatSpasmBreach(breach.id, hubRisk.reason || 'Core Hub locked against mutation');
        }

        // Code / Diff shortcut scan
        const code = args?.CodeContent || args?.ReplacementContent || args?.content;
        if (typeof code === 'string') {
          const antibodies = this.ledger.readEntries();
          const scan = this.hydrophobia.scanCode(code, target, undefined, antibodies);
          if (!scan.passed) {
            const first = scan.violations[0];
            const breach = this.breaker.recordBreach('HYDROPHOBIA', first.message, { violations: scan.violations });
            return this.formatSpasmBreach(breach.id, first.message);
          }
        }
      }
    }

    // 4. Handle Native Governance Tools
    switch (name) {
      case 'raebyes_record_read': {
        this.hydrophobia.recordRead(args.filePath);
        return ErrorInjector.createSuccessResponse({
          recorded: true,
          filePath: args.filePath,
          timestamp: Date.now(),
          status: 'Freshness registered. File is eligible for modification within 120 seconds.'
        });
      }

      case 'raebyes_preflight_check': {
        const { filePath, action } = args;
        const fresh = this.hydrophobia.checkFreshness(filePath, this.workspaceDir);
        if (!fresh.allowed) {
          const breach = this.breaker.recordBreach('PRE_FLIGHT', fresh.violation?.message || 'ERR_BLIND_EDIT', { filePath, action });
          return this.formatSpasmBreach(breach.id, fresh.violation?.message || 'ERR_BLIND_EDIT');
        }

        const hubRisk = this.coreHubGraph.assessMutationRisk(filePath, action);
        if (!hubRisk.allowed) {
          const breach = this.breaker.recordBreach('HUB_LOCK', hubRisk.reason || 'Core Hub block', { filePath, action });
          return this.formatSpasmBreach(breach.id, hubRisk.reason || 'Core Hub block');
        }

        return ErrorInjector.createSuccessResponse({
          passed: true,
          filePath,
          action,
          isHub: hubRisk.isHub,
          hubId: hubRisk.hubId,
          dependentCount: hubRisk.dependentCount,
          status: 'Pre-flight passed. Action permitted.'
        });
      }

      case 'raebyes_scan_diff': {
        const { diffText, code, filename, originalCode } = args;
        const antibodies = this.ledger.readEntries();

        if (diffText) {
          const diffReport = this.hydrophobia.scanDiff(diffText, antibodies);
          if (!diffReport.passed) {
            const breach = this.breaker.recordBreach('HYDROPHOBIA', 'Diff contains shortcut patterns', {
              violations: diffReport.violations
            });
            return this.formatSpasmBreach(breach.id, diffReport.violations[0].message);
          }
        }

        if (code) {
          const codeReport = this.hydrophobia.scanCode(code, filename || 'script.ts', originalCode, antibodies);
          if (!codeReport.passed) {
            const breach = this.breaker.recordBreach('HYDROPHOBIA', 'Code contains shortcuts or static returns', {
              violations: codeReport.violations
            });
            return this.formatSpasmBreach(breach.id, codeReport.violations[0].message);
          }
        }

        return ErrorInjector.createSuccessResponse({
          passed: true,
          status: 'Hydrophobia AST scan clean. Zero shortcuts or deleted assertions detected.'
        });
      }

      case 'raebyes_verify_variance': {
        const { output, executionTimeMs, minVariance, minExecutionTimeMs } = args;
        const vResult = this.varianceGuard.verify(output, executionTimeMs, {
          minVariance,
          minExecutionTimeMs
        });

        if (!vResult.passed) {
          const breach = this.breaker.recordBreach('VARIANCE', 'Solver output failed variance invariants', {
            violations: vResult.violations
          });
          return this.formatSpasmBreach(breach.id, vResult.violations[0]);
        }

        return ErrorInjector.createSuccessResponse({
          passed: true,
          variance: vResult.variance,
          mean: vResult.mean,
          stdDev: vResult.stdDev,
          executionTimeMs: vResult.executionTimeMs,
          status: 'Variance verified.'
        });
      }

      case 'raebyes_record_failure': {
        const { description, pattern, component } = args;
        const entry = this.ledger.appendAntibody({
          component: component || 'core',
          false_claim: 'Agent hallucinated shortcut or bypassed test assertion',
          underlying_flaw: description,
          rejection_pattern: pattern
        });
        return ErrorInjector.createSuccessResponse({
          recorded: true,
          antibody: entry,
          status: `Antibody ${entry.id} committed to immutable ledger.`
        });
      }

      case 'raebyes_verify_turn': {
        const check = this.truthEnforcer.verifyTurn(this.breaker);
        if (!check.allowed) {
          const breach = this.breaker.recordBreach('LIE_DETECTOR', check.reason || 'Unverified mutations', { check });
          return this.formatSpasmBreach(breach.id, check.reason || 'Unverified mutations detected.');
        }
        return ErrorInjector.createSuccessResponse({
          allowed: true,
          treeHash: check.currentTreeHash,
          latestRunId: check.latestRunId,
          status: 'Turn verified: current working tree hash matches verified run receipt.'
        });
      }

      case 'raebyes_status': {
        const breakerStatus = this.breaker.getStatus();
        const v = this.ledger.verifyLedgerIntegrity();
        const treeHash = this.truthEnforcer.computeWorkingTreeHash();
        const latestRun = this.ledger.getLatestVerifiedReceipt();
        return ErrorInjector.createSuccessResponse({
          breaker: breakerStatus,
          antibodies: {
            totalEntries: v.totalEntries,
            valid: v.valid,
            brokenAt: v.brokenAt
          },
          currentTreeHash: treeHash,
          latestRun,
          workspaceDir: this.workspaceDir
        });
      }

      default:
        // Forward to child MCP if available
        if (this.childMcpProcess) {
          return this.forwardToChildMcp('tools/call', { name, arguments: args });
        }
        return ErrorInjector.createSpasmError('CIRCUIT_BREAKER', `Unknown tool: ${name}`);
    }
  }

  private formatSpasmBreach(breachId: string, reason: string) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `[RAEBYES_SPASM_BREACH: ${breachId}] Deterministic Circuit Breaker blocked shortcut/violation (${reason}). File write refused. You must implement the authentic solution without mocks, shortcuts, or blind edits.`
        }
      ]
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private forwardToChildMcp(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.childMcpProcess || !this.childMcpProcess.stdin) {
        return reject(new Error('Child MCP process is not running'));
      }
      const reqId = `FWD-${Date.now()}`;
      const msg: JsonRpcRequest = { jsonrpc: '2.0', id: reqId, method, params };

      const onData = (chunk: Buffer) => {
        const str = chunk.toString();
        try {
          const res: JsonRpcResponse = JSON.parse(str);
          if (res.id === reqId) {
            this.childMcpProcess?.stdout?.removeListener('data', onData);
            resolve(res.result);
          }
        } catch {
          // Streaming json
        }
      };

      this.childMcpProcess.stdout?.on('data', onData);
      this.childMcpProcess.stdin.write(JSON.stringify(msg) + '\n');
    });
  }

  public async processRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { id, method, params } = req;

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: '@raebyes/mcp',
              version: '1.0.0'
            }
          }
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.getNativeToolDefinitions()
          }
        };

      case 'tools/call': {
        const { name, arguments: toolArgs } = params || {};
        try {
          const res = await this.handleToolCall(name, toolArgs);
          return {
            jsonrpc: '2.0',
            id,
            result: res
          };
        } catch (err) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32000,
              message: err instanceof Error ? err.message : String(err)
            }
          };
        }
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        };
    }
  }
}
