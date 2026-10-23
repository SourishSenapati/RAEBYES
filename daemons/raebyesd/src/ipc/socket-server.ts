import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HydrophobiaEngine } from '../engine/hydrophobia.js';
import { VarianceGuard } from '../engine/variance-guard.js';
import { CoreHubGraph } from '../engine/core-hub-graph.js';
import { SpasmCircuitBreaker } from '../engine/spasm-breaker.js';

export interface IPCRequest {
  id: string;
  action:
    | 'PING'
    | 'STATUS'
    | 'CHECK_HYDROPHOBIA'
    | 'CHECK_DIFF'
    | 'CHECK_VARIANCE'
    | 'ASSESS_RISK'
    | 'RECORD_BREACH'
    | 'QUARANTINE'
    | 'RESET';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

export interface IPCResponse {
  id: string;
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  error?: string;
}

export function getDefaultSocketPath(workspaceDir?: string): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\raebyesd.sock';
  }
  if (workspaceDir) {
    return path.join(workspaceDir, '.raebyes', 'raebyesd.sock');
  }
  const xdg = process.env.XDG_RUNTIME_DIR || path.join(os.homedir(), '.cache', 'raebyes');
  return path.join(xdg, 'raebyesd.sock');
}

export class RaebyesSocketServer {
  private server: net.Server | null = null;
  private socketPath: string;
  private hydrophobia: HydrophobiaEngine;
  private varianceGuard: VarianceGuard;
  private coreHubGraph: CoreHubGraph;
  private breaker: SpasmCircuitBreaker;

  constructor(
    workspaceDir: string,
    customSocketPath?: string,
    hydrophobia?: HydrophobiaEngine,
    varianceGuard?: VarianceGuard,
    coreHubGraph?: CoreHubGraph,
    breaker?: SpasmCircuitBreaker
  ) {
    this.socketPath = customSocketPath || getDefaultSocketPath(workspaceDir);
    this.hydrophobia = hydrophobia || new HydrophobiaEngine();
    this.varianceGuard = varianceGuard || new VarianceGuard();
    this.coreHubGraph = coreHubGraph || new CoreHubGraph(workspaceDir);
    this.breaker = breaker || new SpasmCircuitBreaker({ workspaceDir });
  }

  public start(): Promise<string> {
    return new Promise((resolve, reject) => {
      // Clean up previous unix socket file if exists
      if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
        try {
          fs.unlinkSync(this.socketPath);
        } catch {
          // Ignore
        }
      } else if (process.platform !== 'win32') {
        const dir = path.dirname(this.socketPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
      }

      this.server = net.createServer((socket) => {
        let buffer = '';

        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const req: IPCRequest = JSON.parse(line);
              const res = this.handleRequest(req);
              socket.write(JSON.stringify(res) + '\n');
            } catch (err) {
              const errRes: IPCResponse = {
                id: 'unknown',
                success: false,
                error: `Malformed IPC JSON: ${err instanceof Error ? err.message : String(err)}`
              };
              socket.write(JSON.stringify(errRes) + '\n');
            }
          }
        });

        socket.on('error', () => {
          // Ignore connection errors
        });
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        resolve(this.socketPath);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
            try {
              fs.unlinkSync(this.socketPath);
            } catch {
              // Ignore
            }
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: IPCRequest): IPCResponse {
    try {
      switch (req.action) {
        case 'PING':
          return { id: req.id, success: true, data: { pong: true, timestamp: Date.now() } };

        case 'STATUS': {
          const status = this.breaker.getStatus();
          return {
            id: req.id,
            success: true,
            data: {
              ...status,
              socketPath: this.socketPath,
              uptimeSec: process.uptime()
            }
          };
        }

        case 'CHECK_HYDROPHOBIA': {
          const { code, filename, originalCode } = req.payload || {};
          const report = this.hydrophobia.scanCode(code || '', filename || 'temp.ts', originalCode);
          return { id: req.id, success: true, data: report };
        }

        case 'CHECK_DIFF': {
          const { diffText } = req.payload || {};
          const report = this.hydrophobia.scanDiff(diffText || '');
          return { id: req.id, success: true, data: report };
        }

        case 'CHECK_VARIANCE': {
          const { output, executionTimeMs, options } = req.payload || {};
          const report = this.varianceGuard.verify(output, executionTimeMs, options);
          return { id: req.id, success: true, data: report };
        }

        case 'ASSESS_RISK': {
          const { path: targetPath, action } = req.payload || {};
          const risk = this.coreHubGraph.assessMutationRisk(targetPath || '', action || 'PATCH');
          return { id: req.id, success: true, data: risk };
        }

        case 'RECORD_BREACH': {
          const { layer, reason, details } = req.payload || {};
          const record = this.breaker.recordBreach(layer || 'CIRCUIT_BREAKER', reason || 'Unknown violation', details || {});
          return { id: req.id, success: true, data: record };
        }

        case 'QUARANTINE': {
          const reason = req.payload?.reason || 'Manual Quarantine via raebyesctl';
          this.breaker.tripAll(reason);
          return { id: req.id, success: true, data: { status: 'TRIPPED', reason } };
        }

        case 'RESET': {
          this.breaker.resetAll();
          return { id: req.id, success: true, data: { status: 'CLOSED' } };
        }

        default:
          return { id: req.id, success: false, error: `Unknown action: ${req.action}` };
      }
    } catch (err) {
      return {
        id: req.id,
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
}

/**
 * Client helper to send a command to a running raebyesd daemon
 */
export function sendDaemonCommand(
  action: IPCRequest['action'],
  payload?: unknown,
  socketPath?: string,
  timeoutMs = 3000
): Promise<IPCResponse> {
  return new Promise((resolve, reject) => {
    const targetSocket = socketPath || getDefaultSocketPath();
    const client = net.createConnection(targetSocket);
    const reqId = `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let responseData = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        client.destroy();
        reject(new Error(`Timeout connecting to raebyesd daemon at ${targetSocket}`));
      }
    }, timeoutMs);

    client.on('connect', () => {
      const msg: IPCRequest = { id: reqId, action, payload };
      client.write(JSON.stringify(msg) + '\n');
    });

    client.on('data', (chunk) => {
      responseData += chunk.toString('utf-8');
      if (responseData.includes('\n')) {
        const line = responseData.split('\n')[0];
        try {
          const res: IPCResponse = JSON.parse(line);
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            client.end();
            resolve(res);
          }
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            client.end();
            reject(err);
          }
        }
      }
    });

    client.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}
