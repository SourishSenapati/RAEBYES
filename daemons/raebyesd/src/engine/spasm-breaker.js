import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
export class SpasmCircuitBreaker {
    // Provider breaker state
    providerState = 'CLOSED';
    providerFailures = [];
    providerOpenedAt = 0;
    // Tool breaker state: toolName -> { state, failures, openedAt, cooldownUntil }
    toolStates = new Map();
    // Loop & resource governor
    consecutiveGlobalFailures = 0;
    callHistory = [];
    goalAttempts = new Map();
    turnStartTimestamp = Date.now();
    turnCostUsd = 0;
    isHalted = false;
    breachCounter = 1;
    config;
    constructor(config) {
        this.config = {
            workspaceDir: path.resolve(config.workspaceDir),
            providerFailureThreshold: config.providerFailureThreshold ?? 3,
            providerWindowSec: config.providerWindowSec ?? 60,
            probeTimeoutSec: config.probeTimeoutSec ?? 30,
            toolFailureThreshold: config.toolFailureThreshold ?? 3,
            globalFailureThreshold: config.globalFailureThreshold ?? 5,
            toolCooldownSec: config.toolCooldownSec ?? 60,
            identicalCallHashLimit: config.identicalCallHashLimit ?? 3,
            maxTurnBudgetUsd: config.maxTurnBudgetUsd ?? 0.5,
            wallClockTimeoutSec: config.wallClockTimeoutSec ?? 90
        };
        this.initBreachCounter();
    }
    // --- 1. PROVIDER CIRCUIT BREAKER ---
    isProviderHealthy() {
        const now = Date.now();
        if (this.providerState === 'OPEN') {
            if (now - this.providerOpenedAt > this.config.probeTimeoutSec * 1000) {
                this.providerState = 'HALF_OPEN';
                return true; // Allow 1 probe request
            }
            return false;
        }
        return true;
    }
    recordProviderSuccess() {
        if (this.providerState === 'HALF_OPEN') {
            this.providerState = 'CLOSED';
            this.providerFailures = [];
        }
    }
    recordProviderFailure() {
        const now = Date.now();
        const windowMs = this.config.providerWindowSec * 1000;
        this.providerFailures = this.providerFailures.filter(t => now - t <= windowMs);
        this.providerFailures.push(now);
        if (this.providerFailures.length >= this.config.providerFailureThreshold) {
            this.providerState = 'OPEN';
            this.providerOpenedAt = now;
        }
    }
    getProviderState() {
        this.isProviderHealthy(); // Refresh HALF_OPEN if probe timeout expired
        return this.providerState;
    }
    // --- 2. TOOL CIRCUIT BREAKER ---
    isToolAllowed(toolName) {
        if (this.isHalted) {
            return { allowed: false, reason: 'GLOBAL HALT: Global agent failure threshold exceeded. Paused for human review.' };
        }
        const now = Date.now();
        const tool = this.toolStates.get(toolName);
        if (!tool)
            return { allowed: true };
        if (tool.cooldownUntil > now) {
            const waitSec = Math.ceil((tool.cooldownUntil - now) / 1000);
            return {
                allowed: false,
                reason: `Tool '${toolName}' is in mutation cooldown. Wait ${waitSec}s.`
            };
        }
        if (tool.state === 'OPEN') {
            if (now - tool.openedAt > 300 * 1000) { // 5-minute auto-reset
                tool.state = 'HALF_OPEN';
                return { allowed: true };
            }
            return {
                allowed: false,
                reason: `Circuit for tool '${toolName}' is OPEN due to repeated failures.`
            };
        }
        return { allowed: true };
    }
    recordToolSuccess(toolName) {
        this.consecutiveGlobalFailures = 0;
        const tool = this.toolStates.get(toolName);
        if (tool && tool.state === 'HALF_OPEN') {
            tool.state = 'CLOSED';
            tool.failures = [];
        }
    }
    recordToolFailure(toolName, error) {
        const now = Date.now();
        this.consecutiveGlobalFailures++;
        let tool = this.toolStates.get(toolName);
        if (!tool) {
            tool = { state: 'CLOSED', failures: [], openedAt: 0, cooldownUntil: 0 };
            this.toolStates.set(toolName, tool);
        }
        tool.failures = tool.failures.filter(t => now - t <= 60 * 1000);
        tool.failures.push(now);
        tool.cooldownUntil = now + this.config.toolCooldownSec * 1000;
        if (tool.failures.length >= this.config.toolFailureThreshold) {
            tool.state = 'OPEN';
            tool.openedAt = now;
        }
        if (this.consecutiveGlobalFailures >= this.config.globalFailureThreshold) {
            this.isHalted = true;
            this.recordBreach('CIRCUIT_BREAKER', 'Global failure threshold reached (5 consecutive errors)', {
                toolName,
                error,
                consecutiveErrors: this.consecutiveGlobalFailures
            });
        }
    }
    // --- 3. SEMANTIC LOOP & RESOURCE GOVERNOR ---
    verifyToolInvocation(toolName, args) {
        const now = Date.now();
        // Check Wall Clock Timeout
        const elapsedSec = (now - this.turnStartTimestamp) / 1000;
        if (elapsedSec > this.config.wallClockTimeoutSec) {
            const msg = `Wall-clock timeout breached (${elapsedSec.toFixed(1)}s > ${this.config.wallClockTimeoutSec}s)`;
            this.recordBreach('CIRCUIT_BREAKER', msg, { elapsedSec });
            return { allowed: false, violation: msg };
        }
        // Check Turn Budget
        if (this.turnCostUsd > this.config.maxTurnBudgetUsd) {
            const msg = `Turn budget ceiling exceeded ($${this.turnCostUsd.toFixed(2)} > $${this.config.maxTurnBudgetUsd.toFixed(2)})`;
            this.recordBreach('CIRCUIT_BREAKER', msg, { turnCostUsd: this.turnCostUsd });
            return { allowed: false, violation: msg };
        }
        // Compute cryptographic argument hash
        const hash = crypto
            .createHash('sha256')
            .update(toolName + JSON.stringify(args, Object.keys(args).sort()))
            .digest('hex');
        // 1. Identical consecutive calls
        const recentIdentical = this.callHistory.slice(-this.config.identicalCallHashLimit + 1);
        if (recentIdentical.length === this.config.identicalCallHashLimit - 1 &&
            recentIdentical.every(entry => entry.argsHash === hash)) {
            const msg = `Agent intercepted in repetitive call loop: ${this.config.identicalCallHashLimit} identical invocations of '${toolName}'`;
            this.recordBreach('CIRCUIT_BREAKER', msg, { toolName, argsHash: hash });
            return { allowed: false, violation: msg };
        }
        // 2. Cyclic tool invocation pattern check (e.g., A -> B -> A -> B without state change)
        if (this.callHistory.length >= 4) {
            const h = this.callHistory.map(c => c.toolName);
            const l = h.length;
            if (h[l - 1] === h[l - 3] &&
                h[l - 2] === h[l - 4] &&
                h[l - 1] === toolName) {
                const msg = `Agent trapped in 2x cyclic tool sequence [${h[l - 2]} -> ${toolName}] without state change`;
                this.recordBreach('CIRCUIT_BREAKER', msg, { sequence: [h[l - 2], toolName] });
                return { allowed: false, violation: msg };
            }
        }
        this.callHistory.push({
            toolName,
            argsHash: hash,
            timestamp: now
        });
        return { allowed: true };
    }
    recordSemanticGoalAttempt(goal) {
        const now = Date.now();
        const windowMs = 5 * 60 * 1000;
        const history = (this.goalAttempts.get(goal) || []).filter(t => now - t <= windowMs);
        history.push(now);
        this.goalAttempts.set(goal, history);
        if (history.length >= 3) {
            const msg = `Semantic goal retry limit reached (3+ failed attempts in 5 minutes for '${goal}')`;
            this.recordBreach('CIRCUIT_BREAKER', msg, { goal, attempts: history.length });
            return { allowed: false, violation: msg };
        }
        return { allowed: true };
    }
    addCost(usd) {
        this.turnCostUsd += usd;
    }
    resetTurn() {
        this.turnStartTimestamp = Date.now();
        this.turnCostUsd = 0;
        this.callHistory = [];
    }
    tripAll(reason = 'Manual Quarantine Override') {
        this.providerState = 'OPEN';
        this.providerOpenedAt = Date.now();
        this.isHalted = true;
        for (const [, tool] of this.toolStates) {
            tool.state = 'OPEN';
            tool.openedAt = Date.now();
        }
        this.recordBreach('CIRCUIT_BREAKER', `QUARANTINE ACTIVATED: ${reason}`, { manualTrip: true });
    }
    resetAll() {
        this.providerState = 'CLOSED';
        this.providerFailures = [];
        this.isHalted = false;
        this.consecutiveGlobalFailures = 0;
        this.toolStates.clear();
        this.callHistory = [];
        this.resetTurn();
    }
    getStatus() {
        return {
            providerState: this.providerState,
            isHalted: this.isHalted,
            consecutiveGlobalFailures: this.consecutiveGlobalFailures,
            turnCostUsd: this.turnCostUsd,
            elapsedTurnSec: (Date.now() - this.turnStartTimestamp) / 1000,
            tools: Array.from(this.toolStates.entries()).map(([name, data]) => ({
                toolName: name,
                state: data.state,
                failures: data.failures.length,
                inCooldown: data.cooldownUntil > Date.now()
            }))
        };
    }
    // --- 4. BREACH TRAJECTORY RECORDER ---
    recordBreach(layer, reason, details) {
        const breachId = `BREACH-${String(this.breachCounter++).padStart(4, '0')}`;
        const record = {
            id: breachId,
            timestamp: new Date().toISOString(),
            reason,
            layer,
            details,
            fatalExitCode: 137
        };
        try {
            const trajDir = path.join(this.config.workspaceDir, '.raebyes', 'trajectories');
            if (!fs.existsSync(trajDir)) {
                fs.mkdirSync(trajDir, { recursive: true });
            }
            const breachFile = path.join(trajDir, `${breachId}.json`);
            fs.writeFileSync(breachFile, JSON.stringify(record, null, 2), 'utf-8');
        }
        catch {
            // Ignore write errors during fatal shutdown
        }
        return record;
    }
    initBreachCounter() {
        try {
            const trajDir = path.join(this.config.workspaceDir, '.raebyes', 'trajectories');
            if (fs.existsSync(trajDir)) {
                const files = fs.readdirSync(trajDir).filter(f => f.startsWith('BREACH-') && f.endsWith('.json'));
                if (files.length > 0) {
                    const numbers = files.map(f => {
                        const m = f.match(/BREACH-(\d+)\.json/);
                        return m ? parseInt(m[1], 10) : 0;
                    });
                    this.breachCounter = Math.max(...numbers) + 1;
                }
            }
        }
        catch {
            this.breachCounter = 1;
        }
    }
}
//# sourceMappingURL=spasm-breaker.js.map