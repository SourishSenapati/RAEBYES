import * as parser from '@babel/parser';
import traversePkg from '@babel/traverse';
// Handle ESM / CJS interop for babel traverse
const traverse = traversePkg.default || traversePkg;
export class HydrophobiaEngine {
    shortcutKeywords = [
        /\bTODO:\s*(implement|replace with real|solver placeholder|shortcut|mock)/i,
        /\bFIXME:\s*(bypass|stub|fake)/i,
        /\bmock(Implementation|ReturnValue|ResolvedValue)\s*\(\s*(\(\)\s*=>\s*)?(true|false|42|null|\{\}|\[\])\s*\)/i,
        /\blinear\s+approximation\s+placeholder\b/i,
        /\b(dummy_solver|fake_solver|mock_solver|synthetic_data_bypass)\b/i,
        /\btest\.skip\b|\bxit\b|\bxdescribe\b/i,
        /\bpytest\.mark\.skip\b/i
    ];
    /**
     * Scans a single source file (JS, TS, or text) for synthetic shortcuts and mock returns
     */
    scanCode(code, filename, originalCode) {
        const violations = [];
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
        // 2. AST Parsing for JS/TS
        if (isJsTs) {
            try {
                const ast = parser.parse(code, {
                    sourceType: 'unambiguous',
                    plugins: ['typescript', 'jsx', 'decorators-legacy'],
                    errorRecovery: true
                });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                traverse(ast, {
                    Function: (path) => {
                        const body = path.node.body;
                        const funcName = path.node.id?.name ||
                            (path.parent?.type === 'VariableDeclarator' ? path.parent.id?.name : '<anonymous>');
                        // Ignore trivial callbacks like array filters / short arrows
                        if (path.node.type === 'ArrowFunctionExpression' && body.type !== 'BlockStatement') {
                            return;
                        }
                        if (body.type === 'BlockStatement') {
                            const statements = body.body;
                            // Empty function body
                            if (statements.length === 0 && !path.node.generator && !path.parent?.type?.includes('Interface')) {
                                if (funcName !== '<anonymous>' && !funcName.startsWith('noop')) {
                                    violations.push({
                                        file: filename,
                                        line: path.node.loc?.start.line,
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
                                    const isLiteral = arg.type === 'BooleanLiteral' ||
                                        arg.type === 'NumericLiteral' ||
                                        arg.type === 'StringLiteral' ||
                                        arg.type === 'NullLiteral' ||
                                        (arg.type === 'Identifier' && arg.name === 'undefined') ||
                                        (arg.type === 'ObjectExpression' && arg.properties.length === 0) ||
                                        (arg.type === 'ArrayExpression' && arg.elements.length === 0);
                                    // If it's a non-trivial named function returning just true, false, 42, null, {}
                                    const isSuspiciousName = !/^(is|has|can|should|get[A-Z]|default)/.test(funcName);
                                    if (isLiteral && funcName !== '<anonymous>' && isSuspiciousName) {
                                        violations.push({
                                            file: filename,
                                            line: path.node.loc?.start.line,
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
            }
            catch {
                // If Babel fails to parse, fallback to regex inspection
            }
        }
        // 3. Python Fallback Scanning
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
        // 4. Differential Test Assertion Removal Check
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
    scanDiff(diffText) {
        const violations = [];
        const lines = diffText.split('\n');
        let currentFile = 'unknown';
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('+++ b/')) {
                currentFile = line.substring(6).trim();
            }
            else if (line.startsWith('-') && !line.startsWith('---')) {
                const removedContent = line.substring(1).trim();
                // Check if a test assertion or verification was deleted
                const assertionPatterns = [
                    /\bexpect\s*\(/,
                    /\bassert(\.|\s+|\()/,
                    /\bassert_called\b/,
                    /\.to(\.equal|\.be|\.have|\.match|\.throw)/,
                    /\bshould\b/,
                    /\bself\.assert[A-Za-z]+\(/
                ];
                for (const ap of assertionPatterns) {
                    if (ap.test(removedContent)) {
                        // Verify if it was just replaced on the next line or genuinely removed
                        const nextLine = lines[i + 1];
                        const isReplacedAssertion = nextLine && nextLine.startsWith('+') && ap.test(nextLine);
                        if (!isReplacedAssertion) {
                            violations.push({
                                file: currentFile,
                                type: 'DELETED_TEST_ASSERTION',
                                message: `Agent deleted test assertion: "${removedContent}"`,
                                snippet: line,
                                severity: 'FATAL'
                            });
                        }
                    }
                }
                // Check if an agent removed exception throwing or runtime guard
                if (/\bthrow new\s+[A-Za-z]+Error\(/.test(removedContent) || /\braise\s+[A-Za-z]+Error\(/.test(removedContent)) {
                    const nextLine = lines[i + 1];
                    const isReplaced = nextLine && nextLine.startsWith('+') && (/throw/i.test(nextLine) || /raise/i.test(nextLine));
                    if (!isReplaced) {
                        violations.push({
                            file: currentFile,
                            type: 'SHORTCUT_MOCK_DETECTED',
                            message: `Agent stripped runtime exception/invariant check: "${removedContent}"`,
                            snippet: line,
                            severity: 'FATAL'
                        });
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
    detectDeletedAssertions(before, after, filename) {
        const violations = [];
        const countOccurrences = (str, reg) => (str.match(reg) || []).length;
        const assertionRegexes = [
            { name: 'expect() assertions', reg: /\bexpect\s*\(/g },
            { name: 'assert statements', reg: /\bassert(\.|\s+|\()/g },
            { name: 'python unittest asserts', reg: /\bself\.assert[A-Za-z]+\(/g }
        ];
        for (const item of assertionRegexes) {
            const beforeCount = countOccurrences(before, item.reg);
            const afterCount = countOccurrences(after, item.reg);
            if (afterCount < beforeCount) {
                violations.push({
                    file: filename,
                    type: 'DELETED_TEST_ASSERTION',
                    message: `Detected reduction in ${item.name} from ${beforeCount} to ${afterCount} (agent attempted to weaken test suite)`,
                    severity: 'FATAL'
                });
            }
        }
        return violations;
    }
}
//# sourceMappingURL=hydrophobia.js.map