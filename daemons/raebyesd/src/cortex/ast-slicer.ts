import * as fs from 'fs';
import * as path from 'path';
import * as parser from '@babel/parser';
import traversePkg from '@babel/traverse';
import { AstSliceResult, AntibodyEntry } from '../types.js';
import { AntibodyLedger } from '../ledger.js';

const traverse = (traversePkg as unknown as { default?: typeof traversePkg }).default || traversePkg;

export class AstSlicer {
  private workspaceDir: string;
  private ledger: AntibodyLedger;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.ledger = new AntibodyLedger(this.workspaceDir);
  }

  /**
   * Extracts targeted symbol slice under ~350 tokens for 4B/7B models
   */
  public sliceSymbol(filePath: string, symbolName: string, lineHint?: number): AstSliceResult {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.workspaceDir, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`[AST_SLICER_ERROR] File not found: ${filePath}`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const ext = path.extname(fullPath).toLowerCase();
    const lines = content.split('\n');

    let startLine = 1;
    let endLine = lines.length;
    let symbolCode = '';
    const imports: string[] = [];

    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs') {
      const ast = parser.parse(content, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx', 'decorators-legacy'] as parser.ParserPlugin[],
        errorRecovery: true
      });

      let found = false;

      traverse(ast, {
        ImportDeclaration(astPath) {
          if (astPath.node.loc) {
            imports.push(lines.slice(astPath.node.loc.start.line - 1, astPath.node.loc.end.line).join('\n'));
          }
        },
        FunctionDeclaration(astPath) {
          if (astPath.node.id?.name === symbolName && !found) {
            if (astPath.node.loc) {
              startLine = astPath.node.loc.start.line;
              endLine = astPath.node.loc.end.line;
              symbolCode = lines.slice(startLine - 1, endLine).join('\n');
              found = true;
            }
          }
        },
        ClassDeclaration(astPath) {
          if (astPath.node.id?.name === symbolName && !found) {
            if (astPath.node.loc) {
              startLine = astPath.node.loc.start.line;
              endLine = astPath.node.loc.end.line;
              symbolCode = lines.slice(startLine - 1, endLine).join('\n');
              found = true;
            }
          }
        },
        ClassMethod(astPath) {
          const keyName = (astPath.node.key as { name?: string }).name;
          if (keyName === symbolName && !found) {
            if (astPath.node.loc) {
              startLine = astPath.node.loc.start.line;
              endLine = astPath.node.loc.end.line;
              symbolCode = lines.slice(startLine - 1, endLine).join('\n');
              found = true;
            }
          }
        },
        VariableDeclarator(astPath) {
          const idNode = astPath.node.id as { name?: string };
          if (idNode.name === symbolName && !found) {
            const parent = astPath.parentPath.node;
            if (parent && parent.loc) {
              startLine = parent.loc.start.line;
              endLine = parent.loc.end.line;
              symbolCode = lines.slice(startLine - 1, endLine).join('\n');
              found = true;
            }
          }
        }
      });

      if (!found) {
        // Fallback: lineHint or regex search
        if (lineHint && lineHint >= 1 && lineHint <= lines.length) {
          startLine = Math.max(1, lineHint - 10);
          endLine = Math.min(lines.length, lineHint + 15);
        } else {
          const idx = lines.findIndex(l => l.includes(symbolName));
          if (idx !== -1) {
            startLine = Math.max(1, idx - 5);
            endLine = Math.min(lines.length, idx + 20);
          }
        }
        symbolCode = lines.slice(startLine - 1, endLine).join('\n');
      }
    } else if (ext === '.py') {
      // Python parser: extract import statements and def/class blocks
      let targetStart = -1;
      let targetIndent = 0;
      let targetEnd = lines.length;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
          imports.push(line);
        }

        if (targetStart === -1) {
          const defMatch = line.match(/^(\s*)(def|class)\s+([a-zA-Z0-9_]+)/);
          if (defMatch && defMatch[3] === symbolName) {
            targetStart = i;
            targetIndent = defMatch[1].length;
          }
        } else {
          // Check for exit of indentation
          if (trimmed.length > 0 && !trimmed.startsWith('#')) {
            const lineIndent = (line.match(/^(\s*)/)?.[1] || '').length;
            if (lineIndent <= targetIndent && i > targetStart) {
              targetEnd = i;
              break;
            }
          }
        }
      }

      if (targetStart !== -1) {
        startLine = targetStart + 1;
        endLine = targetEnd;
        symbolCode = lines.slice(targetStart, targetEnd).join('\n');
      } else {
        startLine = 1;
        endLine = Math.min(lines.length, 30);
        symbolCode = lines.slice(0, 30).join('\n');
      }
    } else {
      // Generic fallback
      startLine = 1;
      endLine = Math.min(lines.length, 35);
      symbolCode = lines.slice(0, 35).join('\n');
    }

    // Retrieve active antibodies tied to this symbol or component
    const allAntibodies = this.ledger.readEntries();
    const componentName = path.basename(filePath, path.extname(filePath));
    const linkedAntibodies = allAntibodies.filter(
      ab => ab.component.toLowerCase() === componentName.toLowerCase() ||
            ab.component.toLowerCase() === symbolName.toLowerCase() ||
            ab.rejection_pattern.includes(symbolName)
    );

    // Build synthesized compact payload
    const tokenEstimate = Math.ceil((symbolCode.length + imports.join('\n').length) / 4);

    return {
      filePath: path.relative(this.workspaceDir, fullPath).replace(/\\/g, '/'),
      symbolName,
      startLine,
      endLine,
      imports: imports.slice(0, 8), // Cap imports to avoid noise
      code: symbolCode,
      linkedAntibodies,
      tokenEstimate
    };
  }
}
