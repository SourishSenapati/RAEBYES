import * as readline from 'readline';
import { McpStdioProxy, JsonRpcRequest } from './stdio-proxy.js';

export * from './freshness-lock.js';
export * from './error-injector.js';
export * from './stdio-proxy.js';

export function startMcpServer(workspaceDir = process.cwd()) {
  const proxy = new McpStdioProxy(workspaceDir);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    try {
      const req: JsonRpcRequest = JSON.parse(line);
      const res = await proxy.processRequest(req);
      process.stdout.write(JSON.stringify(res) + '\n');
    } catch (err) {
      const errRes = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${err instanceof Error ? err.message : String(err)}`
        }
      };
      process.stdout.write(JSON.stringify(errRes) + '\n');
    }
  });

  process.stderr.write('[RAEBYES MCP] Deterministic MCP Interceptor active on stdio\n');
}

import * as url from 'url';
import * as path from 'path';

const isMain = Boolean(
  process.argv[1] &&
  (path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url)) ||
   process.argv[1].endsWith('raebyes-mcp.js') ||
   process.argv[1].endsWith('raebyes-mcp'))
);

if (isMain) {
  startMcpServer();
}
