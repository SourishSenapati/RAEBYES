export class GrammarSanitizer {
  /**
   * Deterministically repairs and parses malformed JSON from 4B/7B quantized models
   */
  public static sanitizeJson<T = Record<string, unknown>>(raw: string): { success: boolean; data?: T; error?: string } {
    if (!raw || typeof raw !== 'string') {
      return { success: false, error: 'Empty or non-string input provided' };
    }

    let cleaned = raw.trim();

    // 1. Strip <think>...</think>, <thought>...</thought>, or reasoning scratchpads
    cleaned = cleaned.replace(/<(?:think|thought)>[\s\S]*?(?:<\/(?:think|thought)>|$)/gi, '').trim();

    // 2. Strip markdown fences (```json ... ``` or ``` ...)
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    // 3. Extract JSON object or array bounds if surrounded by conversational filler
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    let startIdx = -1;
    let endIdx = -1;

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      startIdx = firstBrace;
      endIdx = cleaned.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
      endIdx = cleaned.lastIndexOf(']');
    }

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      cleaned = cleaned.slice(startIdx, endIdx + 1);
    }

    // 4. Fast path: try standard JSON.parse
    try {
      const parsed = JSON.parse(cleaned);
      return { success: true, data: parsed as T };
    } catch {
      // Proceed to rule-based repairs
    }

    // 5. Repair trailing commas in objects and arrays
    cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

    // 6. Repair unquoted keys: { key: "value" } -> { "key": "value" }
    cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":');

    // 7. Repair single-quoted strings: 'value' -> "value"
    cleaned = cleaned.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"');

    // 8. Repair unescaped newlines in string values
    cleaned = cleaned.replace(/(?<=:\s*"[^"]*)\n(?=[^"]*")/g, '\\n');

    try {
      const repaired = JSON.parse(cleaned);
      return { success: true, data: repaired as T };
    } catch (err) {
      return {
        success: false,
        error: `[GRAMMAR_SANITIZER_FAILED] Unrecoverable malformed JSON syntax: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
}
