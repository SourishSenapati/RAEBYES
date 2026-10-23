import * as fs from 'fs';
import * as path from 'path';
import { CoreHubGraph } from '@raebyes/daemon';
import { AntibodyLedger } from 'raebyes';

export async function runInit(workspaceDir = process.cwd(), options: { force?: boolean } = {}) {
  const ws = path.resolve(workspaceDir);
  console.log(`\n[RAEBYES INIT] Initializing Deterministic Governance Vault in: ${ws}`);

  const raebyesDir = path.join(ws, '.raebyes');
  const trajectoriesDir = path.join(raebyesDir, 'trajectories');
  const quarantineDir = path.join(raebyesDir, 'quarantine');
  const srcCoreDir = path.join(ws, 'src', 'core');
  const runsActiveDir = path.join(ws, 'runs', 'active');
  const runsArchiveDir = path.join(ws, 'runs', 'archive');

  // 1. Create directories
  [raebyesDir, trajectoriesDir, quarantineDir, srcCoreDir, runsActiveDir, runsArchiveDir].forEach((d) => {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  });

  // 2. Initialize .raebyes/antibodies.json
  const antibodiesFile = path.join(raebyesDir, 'antibodies.json');
  if (!fs.existsSync(antibodiesFile) || options.force) {
    fs.writeFileSync(antibodiesFile, '[]\n', 'utf-8');
    console.log(`  + Created empty append-only ledger: .raebyes/antibodies.json`);
  } else {
    // Verify existing
    const ledger = new AntibodyLedger(antibodiesFile);
    const v = ledger.verify();
    if (!v.valid) {
      console.warn(`  ! WARNING: Existing antibodies.json has broken hash chain at ${v.brokenAt}!`);
    } else {
      console.log(`  * Existing antibodies.json verified (${v.totalEntries} rules).`);
    }
  }

  // 3. Initialize .raebyes/decisions.json
  const decisionsFile = path.join(raebyesDir, 'decisions.json');
  if (!fs.existsSync(decisionsFile)) {
    fs.writeFileSync(decisionsFile, '[]\n', 'utf-8');
    console.log(`  + Created engineering decisions register: .raebyes/decisions.json`);
  }

  // 4. Initialize .raebyes/raebyes.conf
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
semantic_goal_retry_limit = 3
max_turn_budget_usd = 0.50
wall_clock_timeout_sec = 90
`;
    fs.writeFileSync(confFile, defaultConf, 'utf-8');
    console.log(`  + Created governance configuration: .raebyes/raebyes.conf`);
  }

  // 5. Build and lock Core Hub Dependency Graph (.raebyes/graph.lock)
  const graphLockFile = path.join(raebyesDir, 'graph.lock');
  const graph = new CoreHubGraph(ws);
  await graph.saveLockfile(graphLockFile);
  console.log(`  + Built reverse-dependency graph & locked Core Hubs: .raebyes/graph.lock`);

  // 6. Directory Isolation Placeholders
  const gitkeepSrc = path.join(srcCoreDir, '.gitkeep');
  if (!fs.existsSync(gitkeepSrc)) fs.writeFileSync(gitkeepSrc, '', 'utf-8');
  const gitkeepRuns = path.join(runsArchiveDir, '.gitkeep');
  if (!fs.existsSync(gitkeepRuns)) fs.writeFileSync(gitkeepRuns, '', 'utf-8');

  // 7. Inject Agent Traps and Hooks
  // Claude Code
  const claudeDir = path.join(ws, '.claude');
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
  const claudeSettings = path.join(claudeDir, 'settings.json');
  const claudeConfig = {
    mcpServers: {
      raebyes: {
        command: 'npx',
        args: ['-y', '@raebyes/mcp']
      }
    },
    hooks: {
      preExecution: 'npx raebyes verify'
    }
  };
  fs.writeFileSync(claudeSettings, JSON.stringify(claudeConfig, null, 2), 'utf-8');
  console.log(`  + Injected Anthropic Claude Code traps: .claude/settings.json`);

  // Gemini / Antigravity IDE
  const geminiDir = path.join(ws, '.gemini');
  if (!fs.existsSync(geminiDir)) fs.mkdirSync(geminiDir, { recursive: true });
  const geminiSettings = path.join(geminiDir, 'settings.json');
  const geminiConfig = {
    mcpServers: {
      raebyes: {
        command: 'npx',
        args: ['-y', '@raebyes/mcp']
      }
    },
    governance: {
      circuitBreaker: true,
      spasmInterrupter: true
    }
  };
  fs.writeFileSync(geminiSettings, JSON.stringify(geminiConfig, null, 2), 'utf-8');
  console.log(`  + Injected Google Gemini traps: .gemini/settings.json`);

  // Cursor AI Agent
  const cursorDir = path.join(ws, '.cursor');
  if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });
  const cursorMcp = path.join(cursorDir, 'mcp.json');
  const cursorConfig = {
    mcpServers: {
      raebyes: {
        command: 'npx',
        args: ['-y', '@raebyes/mcp']
      }
    }
  };
  fs.writeFileSync(cursorMcp, JSON.stringify(cursorConfig, null, 2), 'utf-8');

  const cursorRules = path.join(ws, '.cursorrules');
  const cursorRulesContent = `# RAEBYES AGENT GOVERNANCE RULES
- All solver executions and critical mutations are enforced by RAEBYES runtime circuit breakers.
- NEVER delete test assertions (expect(), assert) or replace function bodies with static return constants.
- Files registered as Core Hubs (HUB-XXXX in .raebyes/graph.lock) cannot be deleted or truncated.
- Do not edit or modify .raebyes/antibodies.json directly; the hash chain will break and lock the workspace.
`;
  if (!fs.existsSync(cursorRules)) {
    fs.writeFileSync(cursorRules, cursorRulesContent, 'utf-8');
    console.log(`  + Created Cursor agent directives: .cursorrules & .cursor/mcp.json`);
  }

  // Windsurf
  const windsurfDir = path.join(ws, '.codeium', 'windsurf');
  if (!fs.existsSync(windsurfDir)) fs.mkdirSync(windsurfDir, { recursive: true });
  const windsurfMcp = path.join(windsurfDir, 'mcp_config.json');
  fs.writeFileSync(windsurfMcp, JSON.stringify(cursorConfig, null, 2), 'utf-8');
  console.log(`  + Injected Codeium Windsurf traps: .codeium/windsurf/mcp_config.json`);

  // Git Pre-Commit Hook
  const gitHooksDir = path.join(ws, '.git', 'hooks');
  if (fs.existsSync(gitHooksDir)) {
    const preCommitHook = path.join(gitHooksDir, 'pre-commit');
    const hookScript = `#!/bin/sh
# RAEBYES Pre-Commit Verification Gate
echo "[RAEBYES] Running pre-commit antibody ledger verification..."
npx raebyes verify || {
  echo "[RAEBYES ERROR] Commit rejected: antibodies.json hash chain is broken!"
  exit 1
}
`;
    fs.writeFileSync(preCommitHook, hookScript, { encoding: 'utf-8', mode: 0o755 });
    console.log(`  + Installed Git pre-commit integrity gate: .git/hooks/pre-commit`);
  }

  console.log('\n[RAEBYES INIT COMPLETE] Workspace successfully fortified against agent shortcuts!\n');
}
