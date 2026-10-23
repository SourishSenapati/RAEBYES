import * as path from 'path';
import { FreshnessLock } from './freshness-lock.js';
import { ErrorInjector } from './error-injector.js';
import { HydrophobiaEngine, VarianceGuard, CoreHubGraph, SpasmCircuitBreaker } from '@raebyes/daemon';
import { AntibodyLedger } from 'raebyes';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
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
  private freshness: FreshnessLock;
  private hydrophobia: HydrophobiaEngine;
  private varianceGuard: VarianceGuard;
  private coreHubGraph: CoreHubGraph;
  private breaker: SpasmCircuitBreaker;
  private ledger: AntibodyLedger;

  constructor(workspaceDir = process.cwd()) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.freshness = new FreshnessLock();
    this.hydrophobia = new HydrophobiaEngine();
    this.varianceGuard = new VarianceGuard();
    this.coreHubGraph = new CoreHubGraph(this.workspaceDir);
    this.breaker = new SpasmCircuitBreaker({ workspaceDir: this.workspaceDir });
    this.ledger = new AntibodyLedger(path.join(this.workspaceDir, '.raebyes', 'antibodies.json'));

    const lockPath = path.join(this.workspaceDir, '.raebyes', 'graph.lock');
    this.coreHubGraph.loadLockfile(lockPath);
  }

  public getToolDefinitions() {
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
            assertion: { type: 'string', description: 'Executable JavaScript rejection assertion' },
            assertionType: { type: 'string', enum: ['PREDICATE_JS', 'AST_RULE', 'SHELL_EXIT', 'VARIANCE_RULE'], default: 'PREDICATE_JS' }
          },
          required: ['description', 'assertion']
        }
      },
      {
        name: 'raebyes_record_decision',
        description: 'Commit an immutable architectural decision constraint (DEC-XXXX) that future agents are forbidden from altering.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Decision title' },
            constraint: { type: 'string', description: 'Strict constraint or rule' },
            context: { type: 'string', description: 'Engineering context and rationale' }
          },
          required: ['title', 'constraint']
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
    // 1. Check Circuit Breaker loop and tool permission
    const breakerCheck = this.breaker.verifyToolInvocation(name, args || {});
    if (!breakerCheck.allowed) {
      const breach = this.breaker.recordBreach('CIRCUIT_BREAKER', breakerCheck.violation || 'Loop tripped', { name, args });
      return ErrorInjector.createSpasmError('CIRCUIT_BREAKER', breakerCheck.violation || 'Circuit breaker tripped', [], breach.id);
    }

    switch (name) {
      case 'raebyes_record_read': {
        this.freshness.recordRead(args.filePath);
        return ErrorInjector.createSuccessResponse({
          recorded: true,
          filePath: args.filePath,
          timestamp: Date.now(),
          status: 'Freshness registered. File is eligible for patching within 120 seconds.'
        });
      }

      case 'raebyes_preflight_check': {
        const { filePath, action } = args;

        // Freshness check
        if (action === 'PATCH') {
          const fresh = this.freshness.assessPatchRisk(filePath);
          if (!fresh.allowed) {
            const breach = this.breaker.recordBreach('PRE_FLIGHT', fresh.message || 'Stale read', { filePath, action });
            return ErrorInjector.createSpasmError('PRE_FLIGHT', fresh.message || 'Stale read', [], breach.id);
          }
        }

        // Dependency hub check
        const hubRisk = this.coreHubGraph.assessMutationRisk(filePath, action);
        if (!hubRisk.allowed) {
          const breach = this.breaker.recordBreach('HUB_LOCK', hubRisk.reason || 'Core Hub block', { filePath, action, hubId: hubRisk.hubId });
          return ErrorInjector.createSpasmError('CORE_HUB', hubRisk.reason || 'Core Hub deletion block', [], breach.id);
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

        if (diffText) {
          const diffReport = this.hydrophobia.scanDiff(diffText);
          if (!diffReport.passed) {
            const breach = this.breaker.recordBreach('HYDROPHOBIA', 'Detected shortcut / deleted assertions in diff', {
              violations: diffReport.violations
            });
            return ErrorInjector.createSpasmError(
              'HYDROPHOBIA',
              'Diff contains prohibited shortcut patterns or deleted test assertions',
              diffReport.violations.map(v => `[${v.type}] ${v.message}`),
              breach.id
            );
          }
        }

        if (code) {
          const codeReport = this.hydrophobia.scanCode(code, filename || 'script.ts', originalCode);
          if (!codeReport.passed) {
            const breach = this.breaker.recordBreach('HYDROPHOBIA', 'Detected shortcut / static returns in code', {
              violations: codeReport.violations
            });
            return ErrorInjector.createSpasmError(
              'HYDROPHOBIA',
              'Code contains prohibited shortcuts or static constant stubs',
              codeReport.violations.map(v => `[${v.type}] ${v.message}`),
              breach.id
            );
          }
        }

        return ErrorInjector.createSuccessResponse({
          passed: true,
          status: 'Hydrophobia AST scan clean. No shortcuts or deleted assertions detected.'
        });
      }

      case 'raebyes_verify_variance': {
        const { output, executionTimeMs, minVariance, minExecutionTimeMs } = args;
        const vResult = this.varianceGuard.verify(output, executionTimeMs, {
          minVariance,
          minExecutionTimeMs
        });

        if (!vResult.passed) {
          const breach = this.breaker.recordBreach('VARIANCE', 'Solver output failed variance/runtime invariants', {
            violations: vResult.violations
          });
          return ErrorInjector.createSpasmError(
            'VARIANCE',
            'Numerical output flagged as synthetic or flat approximation',
            vResult.violations,
            breach.id
          );
        }

        return ErrorInjector.createSuccessResponse({
          passed: true,
          variance: vResult.variance,
          mean: vResult.mean,
          stdDev: vResult.stdDev,
          executionTimeMs: vResult.executionTimeMs,
          status: 'Variance and execution runtime verified.'
        });
      }

      case 'raebyes_record_failure': {
        const { description, assertion, assertionType } = args;
        const entry = this.ledger.append({
          description,
          assertionType: assertionType || 'PREDICATE_JS',
          rejection_assertion: assertion
        });
        return ErrorInjector.createSuccessResponse({
          recorded: true,
          antibody: entry,
          status: `Antibody ${entry.id} committed to immutable ledger.`
        });
      }

      case 'raebyes_record_decision': {
        const { title, constraint, context } = args;
        // Dynamically import decision command logic
        const { runDecision } = await import('../../raebyesctl/dist/commands/decision.js').catch(() => {
          return {
            runDecision: async (t: string, c: string, cx?: string) => {
              // Fallback inline decision append
              const f = path.join(this.workspaceDir, '.raebyes', 'decisions.json');
              const arr = [];
              arr.push({ id: `DEC-${Date.now()}`, title: t, constraint: c, context: cx });
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              (await import('fs')).writeFileSync(f, JSON.stringify(arr, null, 2));
            }
          };
        });
        await runDecision(title, constraint, context, this.workspaceDir);
        return ErrorInjector.createSuccessResponse({
          recorded: true,
          title,
          constraint,
          status: 'Architectural constraint committed to .raebyes/decisions.json'
        });
      }

      case 'raebyes_status': {
        const breakerStatus = this.breaker.getStatus();
        const v = this.ledger.verify();
        return ErrorInjector.createSuccessResponse({
          breaker: breakerStatus,
          antibodies: {
            totalEntries: v.totalEntries,
            valid: v.valid,
            brokenAt: v.brokenAt
          },
          workspaceDir: this.workspaceDir
        });
      }

      default:
        return ErrorInjector.createSpasmError('CIRCUIT_BREAKER', `Unknown tool: ${name}`);
    }
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
            tools: this.getToolDefinitions()
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
