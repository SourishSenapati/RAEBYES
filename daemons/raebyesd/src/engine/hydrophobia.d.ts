import { HydrophobiaReport } from './types.js';
export declare class HydrophobiaEngine {
    private shortcutKeywords;
    /**
     * Scans a single source file (JS, TS, or text) for synthetic shortcuts and mock returns
     */
    scanCode(code: string, filename: string, originalCode?: string): HydrophobiaReport;
    /**
     * Scans a git diff text for deleted assertions or stripped validations
     */
    scanDiff(diffText: string): HydrophobiaReport;
    private detectDeletedAssertions;
}
//# sourceMappingURL=hydrophobia.d.ts.map