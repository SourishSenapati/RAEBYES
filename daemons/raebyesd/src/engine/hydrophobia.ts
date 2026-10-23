import * as parser from '@babel/parser';
import traversePkg from '@babel/traverse';
import * as fs from 'fs';
import * as path from 'path';
import { HydrophobiaReport, HydrophobiaViolation, AntibodyEntry } from '../types.js';

// Handle ESM / CJS interop for babel traverse
const traverse = (traversePkg as unknown as { default?: typeof traversePkg }).default || traversePkg;

export class HydrophobiaEngine {
  private scriptReadTimes: Map<string, number> = new Map();
  private freshnessThresholdMs = 120_000; // 120 seconds

  private shortcutKeywords = [
    /\bTODO:\s*(implement|replace with real|solver placeholder|shortcut|mock|stub)/i,
    /\bFIXME:\s*(bypass|stub|fake|workaround)/i,
    /\bmock(Implementation|ReturnValue|ResolvedValue|Return)\s*\(\s*(\(\)\s*=>\s*)?(true|false|42|null|\{\}|\[\])\s*\)/i,
    /\blinear\s+approximation\s+placeholder\b/i,
    /\b(dummy_solver|fake_solver|mock_solver|synthetic_data_bypass)\b/i,
    /\btest\.skip\b|\bxit\b|\bxdescribe\b/i,
    /\bpytest\.mark\.skip\b/i
  ];

  public recordRead(filePath: string): void {
    const normalized = path.normalize(filePath).replace(/\\/g, '/');
    this.scriptReadTimes.set(normalized, Date.now());
  }

  /**
   * Freshness Lock: Validates that a file was read in the current session before permitting a patch
   */
  public checkFreshness(filePath: string, workspaceDir?: string): { allowed: boolean; violation?: HydrophobiaViolation } {
    const ws = workspaceDir ? path.resolve(workspaceDir) : process.cwd();
    const full = path.isAbsolute(filePath) ? filePath : path.join(ws, filePath);

    // If file doesn't exist on disk yet, it's a new file creation, permitted without prior read
    if (!fs.existsSync(full)) {
      return { allowed: true };
    }

    const normalized = path.normalize(filePath).replace(/\\/g, '/');
    const lastRead = this.scriptReadTimes.get(normalized);

    if (!lastRead) {
      return {
        allowed: false,
        violation: {
          file: normalized,
          type: 'ERR_BLIND_EDIT',
          message: `BLIND EDIT REJECTED: Script '${normalized}' has not been read in this session. Blind patching is strictly forbidden. You must read the file before modifying it.`,
          severity: 'FATAL'
        }
      };
    }

    const elapsed = Date.now() - lastRead;
    if (elapsed > this.freshnessThresholdMs) {
      return {
        allowed: false,
        violation: {
          file: normalized,
          type: 'ERR_BLIND_EDIT',
          message: `STALE READ REJECTED: Script '${normalized}' was read ${(elapsed / 1000).toFixed(0)}s ago (exceeds 120s freshness window). Re-read file before patching.`,
          severity: 'CRITICAL'
        }
      };
    }

    return { allowed: true };
  }

  /**
   * Scans a single source file for synthetic shortcuts, static returns, and antibody violations
   */
  public scanCode(
    code: string,
    filename: string,
    originalCode?: string,
    antibodies: AntibodyEntry[] = []
  ): HydrophobiaReport {
    const violations: HydrophobiaViolation[] = [];
    const isJsTs = /\.[cm]?[jt]sx?$/.test(filename);
    const isPy = /\.py$/.test(filename);

    // 1. Keyword & Comment Pattern Analysis
    const lines = code.split('\n');
    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      for (const pattern of this.shortcutKeywords) {
        if (pattern.test(line)) {
          violations.push({
            file: filename,
            line: lineNum,
            type: 'SHORTCUT_MOCK_DETECTED',
            message: `Detected synthetic shortcut pattern: ${pattern.source}`,
            snippet: line.trim(),
            severity: 'CRITICAL'
          });
        }
      }
    });

    // 2. Active Antibody Rules Matching
    for (const antibody of antibodies) {
      try {
        const regex = new RegExp(antibody.rejection_pattern, 'i');
        if (regex.test(code)) {
          violations.push({
            file: filename,
            type: 'ANTIBODY_VIOLATION',
            message: `Antibody ${antibody.id} breached: ${antibody.underlying_flaw} (matched rule: ${antibody.rejection_pattern})`,
            severity: 'FATAL'
          });
        }
      } catch {
        // If regex fails to compile, evaluate as JS expression
        try {
          const fn = new Function('code', `return Boolean(${antibody.rejection_pattern});`);
          if (fn(code)) {
            violations.push({
              file: filename,
              type: 'ANTIBODY_VIOLATION',
              message: `Antibody ${antibody.id} breached: ${antibody.underlying_flaw}`,
              severity: 'FATAL'
            });
          }
        } catch {
          // Ignore evaluation errors
        }
      }
    }

    // 3. AST Parsing for JS/TS
    if (isJsTs) {
      try {
        const ast = parser.parse(code, {
          sourceType: 'unambiguous',
          plugins: ['typescript', 'jsx', 'decorators-legacy'],
          errorRecovery: true
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (traverse as any)(ast, {
          Function: (pathNode: any) => {
            const body = pathNode.node.body;
            const funcName = pathNode.node.id?.name || 
              (pathNode.parent?.type === 'VariableDeclarator' ? pathNode.parent.id?.name : '<anonymous>');

            if (pathNode.node.type === 'ArrowFunctionExpression' && body.type !== 'BlockStatement') {
              return;
            }

            if (body && body.type === 'BlockStatement') {
              const statements = body.body;

              // Empty function body
              if (statements.length === 0 && !pathNode.node.generator && !pathNode.parent?.type?.includes('Interface')) {
                if (funcName !== '<anonymous>' && !funcName.startsWith('noop')) {
                  violations.push({
                    file: filename,
                    line: pathNode.node.loc?.start.line,
                    type: 'EMPTY_FUNCTION_BODY',
                    message: `Function '${funcName}' has an empty body without implementation`,
                    snippet: `function ${funcName}() {}`,
                    severity: 'CRITICAL'
                  });
                }
              }

              // Single return statement returning literal constant
              if (statements.length === 1 && statements[0].type === 'ReturnStatement') {
                const arg = statements[0].argument;
                if (arg) {
                  const isLiteral = 
                    arg.type === 'BooleanLiteral' ||
                    arg.type === 'NumericLiteral' ||
                    arg.type === 'StringLiteral' ||
                    arg.type === 'NullLiteral' ||
                    (arg.type === 'Identifier' && arg.name === 'undefined') ||
                    (arg.type === 'ObjectExpression' && arg.properties.length === 0) ||
                    (arg.type === 'ArrayExpression' && arg.elements.length === 0);

                  const isSuspiciousName = !/^(is|has|can|should|get[A-Z]|default)/.test(funcName);
                  if (isLiteral && funcName !== '<anonymous>' && isSuspiciousName) {
                    violations.push({
                      file: filename,
                      line: pathNode.node.loc?.start.line,
                      type: 'STATIC_CONSTANT_RETURN',
                      message: `Function '${funcName}' was replaced with a static constant return value`,
                      snippet: `return ${arg.raw || arg.value || arg.name || '{}'}`,
                      severity: 'CRITICAL'
                    });
                  }
                }
              }
            }
          }
        });
      } catch {
        // Fallback to regex inspection
      }
    }

    // 4. Python Fallback Scanning
    if (isPy) {
      const pythonTrivialFunc = /def\s+([a-zA-Z0-9_]+)\([^)]*\):\s*(pass|\.\.\.|return True|return False|return 0|return None|return \{\}|return \[\])\s*$/;
      lines.forEach((line, idx) => {
        const match = line.match(pythonTrivialFunc);
        if (match) {
          const fnName = match[1];
          if (!fnName.startsWith('test_') && !fnName.startsWith('is_')) {
            violations.push({
              file: filename,
              line: idx + 1,
              type: 'STATIC_CONSTANT_RETURN',
              message: `Python function '${fnName}' contains trivial stub/constant return: ${match[2]}`,
              snippet: line.trim(),
              severity: 'CRITICAL'
            });
          }
        }
      });
    }

    // 5. Differential Test Assertion Removal Check
    if (originalCode) {
      const deletedAssertions = this.detectDeletedAssertions(originalCode, code, filename);
      violations.push(...deletedAssertions);
    }

    return {
      passed: violations.length === 0,
      violations,
      scannedFiles: 1,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Scans a git diff text for deleted assertions or stripped validations
   */
  public scanDiff(diffText: string, antibodies: AntibodyEntry[] = []): HydrophobiaReport {
    const violations: HydrophobiaViolation[] = [];
    const lines = diffText.split('\n');
    let currentFile = 'unknown';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('+++ b/')) {
        currentFile = line.substring(6).trim();
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        const removedContent = line.substring(1).trim();

        // Check if a test assertion, invariant, or @enforced decorator was deleted
        const assertionPatterns = [
          /\bexpect\s*\(/,
          /\bassert(\.|\s+|\()/,
          /\bassert_called\b/,
          /\.to(\.equal|\.be|\.have|\.match|\.throw)/,
          /\bshould\b/,
          /\bself\.assert[A-Za-z]+\(/,
          /@(?:raebyes\.)?enforced\b/
        ];

        for (const ap of assertionPatterns) {
          if (ap.test(removedContent)) {
            const nextLine = lines[i + 1];
            const isReplacedAssertion = nextLine && nextLine.startsWith('+') && ap.test(nextLine);

            if (!isReplacedAssertion) {
              violations.push({
                file: currentFile,
                type: 'DELETED_TEST_ASSERTION',
                message: `Agent deleted test assertion or @enforced gate: "${removedContent}"`,
                snippet: line,
                severity: 'FATAL'
              });
            }
          }
        }
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      scannedFiles: 1,
      timestamp: new Date().toISOString()
    };
  }

  private detectDeletedAssertions(before: string, after: string, filename: string): HydrophobiaViolation[] {
    const violations: HydrophobiaViolation[] = [];
    const countOccurrences = (str: string, reg: RegExp) => (str.match(reg) || []).length;

    const assertionRegexes = [
      { name: 'expect() assertions', reg: /\bexpect\s*\(/g },
      { name: 'assert statements', reg: /\bassert(\.|\s+|\()/g },
      { name: 'python unittest asserts', reg: /\bself\.assert[A-Za-z]+\(/g },
      { name: '@enforced decorators', reg: /@(?:raebyes\.)?enforced\b/g }
    ];

    for (const item of assertionRegexes) {
      const beforeCount = countOccurrences(before, item.reg);
      const afterCount = countOccurrences(after, item.reg);

      if (afterCount < beforeCount) {
        violations.push({
          file: filename,
          type: 'DELETED_TEST_ASSERTION',
          message: `Detected reduction in ${item.name} from ${beforeCount} to ${afterCount} (agent attempted to weaken assertions)`,
          severity: 'FATAL'
        });
      }
    }

    return violations;
  }
}
