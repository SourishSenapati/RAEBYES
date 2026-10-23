import * as fs from 'fs';
import * as path from 'path';
import { CoreHubGraph, AntibodyLedger } from '@raebyes/daemon';

export async function runInit(workspaceDir = process.cwd(), options: { force?: boolean } = {}) {
  const ws = path.resolve(workspaceDir);
  console.log(`\n[RAEBYES INIT] Initializing Deterministic Governance Vault in: ${ws}`);

  const raebyesDir = path.join(ws, '.raebyes');
  const trajectoriesDir = path.join(raebyesDir, 'trajectories');
  const quarantineDir = path.join(raebyesDir, 'quarantine');
  const shimsDir = path.join(raebyesDir, 'shims');
  const srcCoreDir = path.join(ws, 'src', 'core');
  const runsActiveDir = path.join(ws, 'runs', 'active');
  const runsArchiveDir = path.join(ws, 'runs', 'archive');

  // 1. Create Core Directories
  [raebyesDir, trajectoriesDir, quarantineDir, shimsDir, srcCoreDir, runsActiveDir, runsArchiveDir].forEach((d) => {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  });

  // 2. Initialize .raebyes/antibodies.json
  const antibodiesFile = path.join(raebyesDir, 'antibodies.json');
  if (!fs.existsSync(antibodiesFile) || options.force) {
    fs.writeFileSync(antibodiesFile, '[]\n', 'utf-8');
    console.log(`  + Initialized append-only failure ledger: .raebyes/antibodies.json`);
  }

  // 3. Initialize .raebyes/runs.lock
  const runsLockFile = path.join(raebyesDir, 'runs.lock');
  if (!fs.existsSync(runsLockFile) || options.force) {
    fs.writeFileSync(runsLockFile, '[]\n', 'utf-8');
    console.log(`  + Initialized execution receipt vault: .raebyes/runs.lock`);
  }

  // 4. Initialize .raebyes/decisions.json
  const decisionsFile = path.join(raebyesDir, 'decisions.json');
  if (!fs.existsSync(decisionsFile)) {
    fs.writeFileSync(decisionsFile, '[]\n', 'utf-8');
    console.log(`  + Initialized architectural decisions register: .raebyes/decisions.json`);
  }

  // 5. Initialize .raebyes/raebyes.conf
  const confFile = path.join(raebyesDir, 'raebyes.conf');
  if (!fs.existsSync(confFile) || options.force) {
    const defaultConf = `# RAEBYES Runtime Governance Configuration
[preflight]
freshness_threshold_sec = 120
core_hub_dependent_limit = 3

[breaker]
tool_failure_window_limit = 3
global_consecutive_fail_halt = 5
half_open_probe_timeout_sec = 30
tool_cooldown_sec = 60

[governor]
identical_call_hash_limit = 3
cyclic_call_convergence_limit = 2
max_turn_budget_usd = 0.50
wall_clock_timeout_sec = 90
`;
    fs.writeFileSync(confFile, defaultConf, 'utf-8');
    console.log(`  + Created governance configuration: .raebyes/raebyes.conf`);
  }

  // 6. Build and lock Core Hub Dependency Graph (.raebyes/graph.lock)
  const graphLockFile = path.join(raebyesDir, 'graph.lock');
  const graph = new CoreHubGraph(ws);
  await graph.saveLockfile(graphLockFile);
  console.log(`  + Locked Core Hub reverse-dependency graph: .raebyes/graph.lock`);

  // 7. Scaffold Cross-Platform Shims (.raebyes/shims/)
  const shimTargets = ['python', 'python3', 'pytest', 'node', 'tsx', 'npm', 'pnpm'];
  for (const bin of shimTargets) {
    // POSIX shell shim
    const shPath = path.join(shimsDir, bin);
    const shContent = `#!/bin/sh\nexec raebyesctl exec -- "${bin}" "$@"\n`;
    fs.writeFileSync(shPath, shContent, { encoding: 'utf-8', mode: 0o755 });

    // Windows CMD/BAT shim
    const batPath = path.join(shimsDir, `${bin}.bat`);
    const batContent = `@echo off\nraebyesctl exec -- "${bin}" %*\n`;
    fs.writeFileSync(batPath, batContent, 'utf-8');

    // Windows CMD shim
    const cmdPath = path.join(shimsDir, `${bin}.cmd`);
    fs.writeFileSync(cmdPath, batContent, 'utf-8');
  }
  console.log(`  + Installed transparent binary shims for POSIX & Windows: .raebyes/shims/`);

  // 8. Inject Agent Rules (.agent/rules/raebyes-hydrophobia.md)
  const agentRulesDir = path.join(ws, '.agent', 'rules');
  if (!fs.existsSync(agentRulesDir)) fs.mkdirSync(agentRulesDir, { recursive: true });
  const rulesPath = path.join(agentRulesDir, 'raebyes-hydrophobia.md');
  const rulesContent = `# RAEBYES HYDROPHOBIA GOVERNANCE INVARIANTS

You are operating inside a repository under active RAEBYES deterministic governance.

CRITICAL OPERATIONAL RULES:
1. TEST ASSERTION INTEGRITY: You are strictly forbidden from deleting, weakening, or commenting out test assertions (expect(), assert).
2. NO SHORTCUTS OR STUBS: Never slip in TODOs, FIXMEs, mockReturnValues, or static constant return stubs.
3. FRESHNESS LOCK: Before modifying any file, you must read it. Blind file patches or patches to files read > 120 seconds ago are rejected with ERR_BLIND_EDIT.
4. CORE HUB LOCK: Files registered as HUB-XXXX in .raebyes/graph.lock cannot be deleted or truncated.
5. PROOF-OF-EXECUTION MANDATE: Every turn concluding code modifications MUST execute the verified command via 'raebyesctl exec' to mint a cryptographic RUN-XXXX receipt. If you attempt to conclude without a matching RUN-XXXX receipt, the Stop hook will reject your turn with code 2.
`;
  fs.writeFileSync(rulesPath, rulesContent, 'utf-8');
  console.log(`  + Injected Agent Hydrophobia rules: .agent/rules/raebyes-hydrophobia.md`);

  // 9. Inject Google Gemini / Antigravity Hooks (.gemini/settings.json)
  const geminiDir = path.join(ws, '.gemini');
  if (!fs.existsSync(geminiDir)) fs.mkdirSync(geminiDir, { recursive: true });
  const geminiSettings = path.join(geminiDir, 'settings.json');
  const geminiConfig = {
    mcpServers: {
      raebyes: {
        command: 'raebyes-mcp',
        args: []
      }
    },
    hooks: {
      preExecution: 'raebyesctl verify',
      stop: 'raebyesctl verify-turn'
    },
    governance: {
      circuitBreaker: true,
      spasmInterrupter: true,
      enforceExecutionReceipts: true
    }
  };
  fs.writeFileSync(geminiSettings, JSON.stringify(geminiConfig, null, 2), 'utf-8');
  console.log(`  + Injected Google Gemini / Antigravity IDE hooks: .gemini/settings.json`);

  // 10. Inject Anthropic Claude Code Hooks (.claude/settings.json)
  const claudeDir = path.join(ws, '.claude');
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
  const claudeSettings = path.join(claudeDir, 'settings.json');
  const claudeConfig = {
    mcpServers: {
      raebyes: {
        command: 'raebyes-mcp',
        args: []
      }
    },
    hooks: {
      preExecution: 'raebyesctl verify',
      stop: 'raebyesctl verify-turn'
    }
  };
  fs.writeFileSync(claudeSettings, JSON.stringify(claudeConfig, null, 2), 'utf-8');
  console.log(`  + Injected Anthropic Claude Code hooks: .claude/settings.json`);

  // 11. Inject Cursor AI Agent Hooks (.cursor/mcp.json)
  const cursorDir = path.join(ws, '.cursor');
  if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });
  const cursorMcp = path.join(cursorDir, 'mcp.json');
  fs.writeFileSync(cursorMcp, JSON.stringify(claudeConfig, null, 2), 'utf-8');
  console.log(`  + Injected Cursor AI Agent hooks: .cursor/mcp.json`);

  // 12. Git Pre-Commit Hook
  const gitHooksDir = path.join(ws, '.git', 'hooks');
  if (fs.existsSync(gitHooksDir)) {
    const preCommitHook = path.join(gitHooksDir, 'pre-commit');
    const hookScript = `#!/bin/sh
# RAEBYES Stop-Hook & Pre-Commit Lie Detector Gate
raebyesctl verify-turn || {
  echo "[RAEBYES ERROR] Commit rejected: unverified code mutations or broken hash chain!"
  exit 1
}
`;
    fs.writeFileSync(preCommitHook, hookScript, { encoding: 'utf-8', mode: 0o755 });
    console.log(`  + Installed Git pre-commit integrity gate: .git/hooks/pre-commit`);
  }

  console.log('\n[RAEBYES INIT COMPLETE] Workspace fortified with binary shims, golden snapshot locks, and stop-hook traps!\n');
}
