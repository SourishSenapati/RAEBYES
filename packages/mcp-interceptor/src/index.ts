import * as readline from 'readline';
import * as url from 'url';
import * as path from 'path';
import { GrammarSanitizer } from '@raebyes/daemon';
import { McpStdioProxy, JsonRpcRequest } from './stdio-proxy.js';

export * from './freshness-lock.js';
export * from './error-injector.js';
export * from './stdio-proxy.js';

export function startMcpServer(workspaceDir = process.cwd(), childCommand?: string[]) {
  const proxy = new McpStdioProxy(workspaceDir, childCommand);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    const sanitized = GrammarSanitizer.sanitizeJson<JsonRpcRequest>(line);
    if (!sanitized.success || !sanitized.data) {
      const errRes = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: sanitized.error || 'Parse error: Malformed JSON syntax'
        }
      };
      process.stdout.write(JSON.stringify(errRes) + '\n');
      return;
    }

    try {
      const res = await proxy.processRequest(sanitized.data);
      process.stdout.write(JSON.stringify(res) + '\n');
    } catch (err) {
      const errRes = {
        jsonrpc: '2.0',
        id: sanitized.data?.id || null,
        error: {
          code: -32000,
          message: `Execution error: ${err instanceof Error ? err.message : String(err)}`
        }
      };
      process.stdout.write(JSON.stringify(errRes) + '\n');
    }
  });

  process.stderr.write('[RAEBYES MCP] Deterministic MCP Interceptor active on stdio\n');
}

const isMain = Boolean(
  process.argv[1] &&
  (path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url)) ||
   process.argv[1].endsWith('raebyes-mcp.js') ||
   process.argv[1].endsWith('raebyes-mcp'))
);

if (isMain) {
  const args = process.argv.slice(2);
  const separatorIdx = args.indexOf('--');
  const childCmd = separatorIdx !== -1 ? args.slice(separatorIdx + 1) : undefined;
  startMcpServer(process.cwd(), childCmd);
}
