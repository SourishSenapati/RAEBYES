import { HydrophobiaEngine } from '../engine/hydrophobia.js';
import { VarianceGuard } from '../engine/variance-guard.js';
import { CoreHubGraph } from '../engine/core-hub-graph.js';
import { SpasmCircuitBreaker } from '../engine/spasm-breaker.js';
export interface IPCRequest {
    id: string;
    action: 'PING' | 'STATUS' | 'CHECK_HYDROPHOBIA' | 'CHECK_DIFF' | 'CHECK_VARIANCE' | 'ASSESS_RISK' | 'RECORD_BREACH' | 'QUARANTINE' | 'RESET';
    payload?: any;
}
export interface IPCResponse {
    id: string;
    success: boolean;
    data?: any;
    error?: string;
}
export declare function getDefaultSocketPath(workspaceDir?: string): string;
export declare class RaebyesSocketServer {
    private server;
    private socketPath;
    private hydrophobia;
    private varianceGuard;
    private coreHubGraph;
    private breaker;
    constructor(workspaceDir: string, customSocketPath?: string, hydrophobia?: HydrophobiaEngine, varianceGuard?: VarianceGuard, coreHubGraph?: CoreHubGraph, breaker?: SpasmCircuitBreaker);
    start(): Promise<string>;
    stop(): Promise<void>;
    private handleRequest;
}
/**
 * Client helper to send a command to a running raebyesd daemon
 */
export declare function sendDaemonCommand(action: IPCRequest['action'], payload?: unknown, socketPath?: string, timeoutMs?: number): Promise<IPCResponse>;
//# sourceMappingURL=socket-server.d.ts.map